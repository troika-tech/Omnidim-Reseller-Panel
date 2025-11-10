const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const {
  getBulkCalls,
  getBulkCall,
  getBulkCallLines,
  getBulkCallLogs,
  getBulkCallAnalytics,
  fetchRecordingsForBulkCall,
  getBulkCallLineRecording,
  downloadBulkCallLineRecording,
  enhanceBulkCall,
} = require("../controllers/bulkCallsController");

// All routes protected with authentication
router.use(auth);

// Get all bulk calls with filters and pagination
// Matches: GET /api/v1/calls/bulk_call?pageno=1&pagesize=10&status=completed
router.get("/", getBulkCalls);

// IMPORTANT: More specific routes must come BEFORE the generic /:id route
// Otherwise Express will match /:id first and treat "lines", "logs", "analytics" as IDs

// Get recording: GET /api/v1/calls/bulk_call/recording/:id
router.get("/recording/:id", getBulkCallLineRecording);

// Download recording: GET /api/v1/calls/bulk_call/recording/:id/download
router.get("/recording/:id/download", downloadBulkCallLineRecording);

// Get call lines for a bulk call campaign
// Matches: GET /api/v1/calls/bulk_call/:id/lines
router.get("/:id/lines", getBulkCallLines);

// Get activity logs for a bulk call campaign
// Matches: GET /api/v1/calls/bulk_call/:id/logs
router.get("/:id/logs", getBulkCallLogs);

// Get analytics data for a bulk call campaign
// Matches: GET /api/v1/calls/bulk_call/:id/analytics
router.get("/:id/analytics", getBulkCallAnalytics);

// Fetch recordings from Exotel for a bulk call campaign
// Matches: POST /api/v1/calls/bulk_call/:id/fetch-recordings
router.post("/:id/fetch-recordings", fetchRecordingsForBulkCall);

// Trigger enhancement for a bulk call campaign
// Matches: POST /api/v1/calls/bulk_call/:id/enhance
router.post("/:id/enhance", enhanceBulkCall);

// Get single bulk call with details
// Matches: GET /api/v1/calls/bulk_call/:id
router.get("/:id", getBulkCall);

module.exports = router;
