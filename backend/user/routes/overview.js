const express = require('express');
const router = express.Router();
const auth = require('../../middleware/auth');
const {
  getOverviewStats,
  getCallLogs
} = require('../controllers/overviewController');

// All routes protected with authentication
router.use(auth);

// Get overview statistics
router.get('/stats', getOverviewStats);

// Get call logs (outgoing calls)
router.get('/call-logs', getCallLogs);

module.exports = router;
