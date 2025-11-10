const express = require('express');
const router = express.Router();
const incomingCallsController = require('../controllers/incomingCallsController');
const auth = require('../middleware/auth');

// Webhook endpoint (no auth required - Exotel calls this)
router.post('/sync-exotel', incomingCallsController.syncExotelWebhook);

// Protected routes (require authentication)
router.use(auth); // Apply auth middleware to all routes below

router.get('/', incomingCallsController.getIncomingCalls);
router.get('/stats', incomingCallsController.getIncomingCallStats);
router.post('/sync', incomingCallsController.syncIncomingCallsFromExotel);
router.get('/recording/:id', incomingCallsController.getRecording);
router.get('/recording/:id/download', incomingCallsController.downloadRecording);
router.get('/:id', incomingCallsController.getIncomingCall);
router.delete('/:id', incomingCallsController.deleteIncomingCall);

module.exports = router;

