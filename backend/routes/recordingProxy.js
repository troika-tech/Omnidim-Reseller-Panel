const express = require("express");
const axios = require("axios");
const config = require("../config/env.js");
const auth = require("../middleware/auth");
const jwt = require("jsonwebtoken");

const router = express.Router();

/**
 * Handle CORS preflight requests
 */
router.options('/recording/:recordingSid', (req, res) => {
  res.set({
    'Access-Control-Allow-Origin': config.cors.allowedOrigins[0] || '*',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS'
  });
  res.status(200).end();
});

/**
 * Middleware to authenticate via header or query parameter
 */
const authFlexible = (req, res, next) => {
  // Try header auth first
  const authHeader = req.headers.authorization;
  let token = null;

  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.substring(7);
  } else if (req.query.token) {
    // Fallback to query parameter for audio elements
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      message: "Access token is required",
    });
  }

  try {
    const decoded = jwt.verify(token, config.jwt.secret);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired token",
    });
  }
};

/**
 * Proxy endpoint for Exotel recording URLs
 * This handles authentication and streams the audio file to the frontend
 */
router.get("/recording/:recordingSid", authFlexible, async (req, res) => {
  try {
    const { recordingSid } = req.params;

    if (!recordingSid) {
      return res.status(400).json({
        success: false,
        message: "Recording SID is required",
      });
    }

    // Construct Exotel recording URL
    const recordingUrl = `https://${config.exotel.subdomain}.exotel.com/v1/Accounts/${config.exotel.accountSid}/Recordings/${recordingSid}.mp3`;

    console.log(`🎵 Proxying recording request: ${recordingSid}`);
    console.log(`🔗 Recording URL: ${recordingUrl}`);

    // Make authenticated request to Exotel
    const response = await axios.get(recordingUrl, {
      auth: {
        username: config.exotel.apiKey,
        password: config.exotel.apiToken,
      },
      responseType: "stream",
      timeout: 30000,
    });

    // Set appropriate headers including CORS
    res.set({
      "Content-Type": "audio/mpeg",
      "Content-Length": response.headers["content-length"],
      "Cache-Control": "public, max-age=3600", // Cache for 1 hour
      "Accept-Ranges": "bytes",
      "Access-Control-Allow-Origin": config.cors.allowedOrigins[0] || "*",
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
    });

    // Stream the audio data
    response.data.pipe(res);

    console.log(` Recording streamed successfully: ${recordingSid}`);
  } catch (error) {
    console.error(
      `❌ Error proxying recording ${req.params.recordingSid}:`,
      error.message
    );

    if (error.response) {
      console.error(`   Status: ${error.response.status}`);
      console.error(
        `   Data: ${JSON.stringify(error.response.data).substring(0, 200)}`
      );

      // Return appropriate error based on Exotel response
      if (error.response.status === 404) {
        return res.status(404).json({
          success: false,
          message: "Recording not found",
        });
      } else if (
        error.response.status === 401 ||
        error.response.status === 403
      ) {
        return res.status(403).json({
          success: false,
          message: "Authentication failed for recording access",
        });
      }
    }

    res.status(500).json({
      success: false,
      message: "Failed to fetch recording",
    });
  }
});

module.exports = router;
