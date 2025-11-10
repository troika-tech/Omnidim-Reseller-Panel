const express = require("express");
const router = express.Router();
const auth = require("../../middleware/auth");
const {
  getUserCallLogs,
  getUserCallLog,
  getUserCallLogStats,
  getUserCallLogRecording,
} = require("../controllers/callLogsController");

// All routes require authentication
// Routes are mounted at /api/user/calls/logs, so we don't need /logs prefix here
router.get("/", auth, getUserCallLogs);
router.get("/stats", auth, getUserCallLogStats);
router.get("/:id", auth, getUserCallLog);
router.get("/:id/recording", auth, getUserCallLogRecording);

module.exports = router;
