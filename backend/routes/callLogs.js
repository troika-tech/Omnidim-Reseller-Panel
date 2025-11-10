const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const {
  getCallLogs,
  getCallLog,
  deleteCallLog,
  getCallStats
} = require('../controllers/callLogsController');

// All routes protected with authentication
router.use(auth);

// Get call statistics
router.get('/stats', getCallStats);

// Get all call logs with filters and pagination
// Matches: GET /api/v1/calls/logs?pageno=1&pagesize=10&agentid=123&call_status=completed
router.get('/', getCallLogs);

// Get single call log
// Matches: GET /api/v1/calls/logs/:id
router.get('/:id', getCallLog);

// Delete call log
router.delete('/:id', deleteCallLog);

module.exports = router;

