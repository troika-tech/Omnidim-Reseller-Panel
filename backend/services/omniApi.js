const axios = require("axios");
const config = require("../config/env.js");
const { retryWithBackoff } = require("../utils/retryUtils");

// Create axios instance with default config
// Use the correct Omni API URL from environment configuration
const baseURL = config.omnidimension.baseUrl || "https://www.omnidim.io/api";
console.log(`🌐 OMNIDIMENSION API Base URL: ${baseURL}`);
console.log(
  `🔑 OMNIDIMENSION API Key: ${
    config.omnidimension.apiKey
      ? config.omnidimension.apiKey.substring(0, 20) + "..."
      : "NOT SET"
  }`
);

const omniApi = axios.create({
  baseURL: baseURL,
  headers: {
    Authorization: `Bearer ${config.omnidimension.apiKey}`,
    "Content-Type": "application/json",
    "X-Source": "my-dashboard", // Identify requests coming from our dashboard
    "X-Sync-Version": "1.0", // Version of the sync protocol
  },
  timeout: config.omnidimension.timeout || 30000, // Default 30s timeout
});

// Handle API errors
omniApi.interceptors.response.use(
  (response) => response,
  (error) => {
    console.error(
      "OMNIDIMENSION API Error:",
      error.response?.data || error.message
    );
    return Promise.reject(error);
  }
);

/**
 * Sync data to OMNIDIMENSION (POST/PUT)
 * @param {string} endpoint - API endpoint
 * @param {object} data - Data to sync
 * @param {string} method - HTTP method (POST or PUT)
 */
async function syncToOmnidimension(endpoint, data, method = "POST") {
  // Remove leading slash if present - baseURL already includes /api/v1
  const cleanEndpoint = endpoint.startsWith("/")
    ? endpoint.substring(1)
    : endpoint;
  const fullURL = `${baseURL}/${cleanEndpoint}`;

  try {
    const requestConfig = {
      method,
      url: cleanEndpoint,
      data,
    };

    console.log(`🔗 Syncing to OMNIDIMENSION: ${method} ${fullURL}`);
    // Log request data (hide file content for security)
    const logData = { ...data };
    if (logData.file) {
      logData.file = `[base64 file, ${logData.file.length} chars]`;
    }
    console.log(`📦 Request data:`, logData);
    const response = await omniApi(requestConfig);
    console.log(`✅ Successfully synced to OMNIDIMENSION: ${cleanEndpoint}`);
    console.log(`📥 API Response:`, response.data);
    return response.data;
  } catch (error) {
    // Log detailed error information
    const errorDetails = {
      status: error.response?.status,
      statusText: error.response?.statusText,
      url: error.config?.url ? `${baseURL}/${error.config.url}` : fullURL,
      data: error.response?.data,
      message: error.message,
    };
    console.error(`❌ OMNIDIMENSION API Error Details:`, errorDetails);

    // Handle specific error types
    if (error.response?.status === 404) {
      // 404 errors - might be due to endpoint changes
      console.error(
        `❌ OMNIDIMENSION API endpoint not found: ${cleanEndpoint}. Full URL: ${fullURL}`
      );
      console.error(
        `❌ Check documentation for correct endpoints. Response:`,
        error.response?.data
      );
      throw new Error(
        `API endpoint not found: ${cleanEndpoint}. Please check the Omni documentation.`
      );
    } else if (
      error.response?.data?.error_description?.includes(
        "out of range for type integer"
      )
    ) {
      // PostgreSQL integer range errors
      console.error(
        `❌ OMNIDIMENSION API integer range error: ${error.response?.data?.error_description}`
      );
      throw new Error(
        `ID value is too large for Omni API. Please use smaller IDs or contact Omni support.`
      );
    } else if (error.response?.data?.error === "server_error") {
      // Generic server errors
      console.error(
        `❌ OMNIDIMENSION API server error: ${
          error.response?.data?.error_description || "Unknown server error"
        }`
      );
      throw new Error(
        `Omni server error: ${
          error.response?.data?.error_description || "Unknown server error"
        }`
      );
    }

    console.error(
      `❌ Failed to sync to OMNIDIMENSION: ${endpoint}`,
      error.response?.status,
      error.response?.data || error.message
    );
    throw new Error(
      error.response?.data?.error_description ||
        error.response?.data?.message ||
        "Failed to sync with OMNIDIMENSION"
    );
  }
}

/**
 * Fetch data from OMNIDIMENSION (GET/DELETE)
 * @param {string} endpoint - API endpoint (can include query params)
 * @param {string} method - HTTP method (GET or DELETE)
 * @param {object} params - Optional query parameters
 */
async function fetchFromOmnidimension(endpoint, method = "GET", params = null) {
  // Remove leading slash if present - baseURL already includes /api/v1
  const cleanEndpoint = endpoint.startsWith("/")
    ? endpoint.substring(1)
    : endpoint;
  const fullURL = `${baseURL}/${cleanEndpoint}`;

  try {
    const requestConfig = {
      method,
      url: cleanEndpoint,
    };

    // Add query parameters if provided
    if (params) {
      requestConfig.params = params;
    }

    console.log(
      `🔗 Fetching from OMNIDIMENSION: ${fullURL}${
        params ? " with params: " + JSON.stringify(params) : ""
      }`
    );
    const response = await omniApi(requestConfig);
    console.log(
      `✅ Successfully fetched from OMNIDIMENSION: ${cleanEndpoint}`,
      response.data ? "Response received" : "No data"
    );
    return response.data;
  } catch (error) {
    // Log detailed error information
    const errorDetails = {
      status: error.response?.status,
      statusText: error.response?.statusText,
      url: error.config?.url ? `${baseURL}/${error.config.url}` : fullURL,
      data: error.response?.data,
      message: error.message,
    };
    console.error(`❌ OMNIDIMENSION API Error Details:`, errorDetails);

    // Handle specific error types
    if (error.response?.status === 404) {
      // 404 errors - might be due to endpoint changes
      console.error(
        `❌ OMNIDIMENSION API endpoint not found: ${cleanEndpoint}. Full URL: ${fullURL}`
      );
      console.error(
        `❌ Check documentation for correct endpoints. Response:`,
        error.response?.data
      );
      throw new Error(
        `API endpoint not found: ${cleanEndpoint}. Please check the Omni documentation.`
      );
    } else if (
      error.response?.data?.error_description?.includes(
        "out of range for type integer"
      )
    ) {
      // PostgreSQL integer range errors
      console.error(
        `❌ OMNIDIMENSION API integer range error: ${error.response?.data?.error_description}`
      );
      throw new Error(
        `ID value is too large for Omni API. Please use smaller IDs or contact Omni support.`
      );
    } else if (error.response?.data?.error === "server_error") {
      // Generic server errors
      console.error(
        `❌ OMNIDIMENSION API server error: ${
          error.response?.data?.error_description || "Unknown server error"
        }`
      );
      throw new Error(
        `Omni server error: ${
          error.response?.data?.error_description || "Unknown server error"
        }`
      );
    }

    console.error(
      `❌ Failed to fetch from OMNIDIMENSION: ${endpoint}`,
      error.response?.status,
      error.response?.data || error.message
    );
    throw new Error(
      error.response?.data?.error_description ||
        error.response?.data?.message ||
        "Failed to fetch from OMNIDIMENSION"
    );
  }
}

module.exports = {
  syncToOmnidimension,
  fetchFromOmnidimension,
  omniApi,
};
