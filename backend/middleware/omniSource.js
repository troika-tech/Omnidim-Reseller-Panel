/**
 * Middleware to handle requests from OMNIDIMENSION API
 * This middleware checks for a special header that indicates the request is coming from Omni
 * It's used to prevent infinite sync loops when bidirectional sync is enabled
 */

const config = require('../config/env');

module.exports = (req, res, next) => {
  // Check if the request has the Omni API key in headers
  const authHeader = req.headers.authorization || '';
  const apiKey = authHeader.replace('Bearer ', '');
  
  // If the API key matches the Omni API key, mark the request as coming from Omni
  if (apiKey === config.omnidimension.apiKey) {
    req.headers['x-source'] = 'omnidimension';
    console.log('🔄 Webhook request from OMNIDIMENSION API');
    console.log('   Path:', req.path || req.url);
    console.log('   Method:', req.method);
    // Don't log the API key for security reasons
  }
  // Silently skip logging for non-Omni requests (normal frontend requests with JWT tokens)
  
  next();
};
