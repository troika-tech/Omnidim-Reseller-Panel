const express = require("express");
const router = express.Router();
const auth = require("../../middleware/auth");
const {
  getUserBulkCalls,
  getUserBulkCall,
  getUserBulkCallLines,
  getUserBulkCallLogs,
  getUserBulkCallAnalytics,
  getUserBulkCallStats,
  getUserBulkCallLineRecording,
  downloadUserBulkCallLineRecording,
  getUserPhoneNumbers,
  createCampaign,
  pauseCampaign,
  resumeCampaign,
  rescheduleCampaign,
  cancelCampaign,
  syncCampaigns,
} = require("../controllers/bulkCallsController");

/**
 * User Bulk Calls Routes
 * All routes are protected with authentication middleware
 * All routes filter by userId to ensure users only see their own campaigns
 */

// Create new campaign
// POST /api/user/calls/bulk_call/create
router.post("/create", auth, createCampaign);

// Manual sync campaigns from Omnidimension
// POST /api/user/calls/bulk_call/sync
router.post("/sync", auth, syncCampaigns);

// Get user's bulk call campaigns
// GET /api/user/calls/bulk_call?pageno=1&pagesize=10&status=active
router.get("/", auth, getUserBulkCalls);

// IMPORTANT: More specific routes must come BEFORE the generic /:id route
// Otherwise Express will match /:id first and treat "lines", "logs", "stats", "recording" as IDs

// Get recording for a bulk call line
// GET /api/user/calls/bulk_call/recording/:id
router.get("/recording/:id", auth, getUserBulkCallLineRecording);

// Download recording for a bulk call line
// GET /api/user/calls/bulk_call/recording/:id/download
router.get("/recording/:id/download", auth, downloadUserBulkCallLineRecording);

// Get campaign call lines
// GET /api/user/calls/bulk_call/:id/lines?pageno=1&pagesize=50&call_status=completed
router.get("/:id/lines", auth, getUserBulkCallLines);

// Get campaign activity logs
// GET /api/user/calls/bulk_call/:id/logs?pageno=1&pagesize=20
router.get("/:id/logs", auth, getUserBulkCallLogs);

// Get campaign analytics
// GET /api/user/calls/bulk_call/:id/analytics
router.get("/:id/analytics", auth, getUserBulkCallAnalytics);

// Get campaign statistics
// GET /api/user/calls/bulk_call/:id/stats
router.get("/:id/stats", auth, getUserBulkCallStats);

// Pause campaign
// PUT /api/user/calls/bulk_call/:id/pause
router.put("/:id/pause", auth, pauseCampaign);

// Resume campaign
// PUT /api/user/calls/bulk_call/:id/resume
router.put("/:id/resume", auth, resumeCampaign);

// Reschedule campaign
// PUT /api/user/calls/bulk_call/:id/reschedule
router.put("/:id/reschedule", auth, rescheduleCampaign);

// Cancel campaign
// DELETE /api/user/calls/bulk_call/:id
router.delete("/:id", auth, cancelCampaign);

// Get single campaign details
// GET /api/user/calls/bulk_call/:id
router.get("/:id", auth, getUserBulkCall);

module.exports = router;
