const express = require('express');
const auth = require('../middleware/auth.js');
const omniSource = require('../middleware/omniSource.js');
const {
  getPhoneNumbers,
  importTwilio,
  importExotel,
  attachAgent,
  detachAgent,
  unifiedPhoneNumberWebhook,
  createPhoneNumber,
  deletePhoneNumber,
  deletePhoneNumberFromDashboard
} = require('../controllers/phoneNumbersController');

const router = express.Router();

// All routes protected with authentication
router.use(auth);

// Add omniSource middleware to identify requests from OMNIDIMENSION
router.use(omniSource);

// OMNIDIMENSION API format routes
// List phone numbers (GET /api/v1/phone_number/list)
router.get('/list', getPhoneNumbers);

// Import phone number from Twilio (POST /api/v1/phone_number/import/twilio)
router.post('/import/twilio', importTwilio);

// Import phone number from Exotel (POST /api/v1/phone_number/import/exotel)
router.post('/import/exotel', importExotel);

// Attach phone number to agent (POST /api/v1/phone_number/attach)
router.post('/attach', attachAgent);

// Detach phone number from agent (POST /api/v1/phone_number/detach)
router.post('/detach', detachAgent);

// Delete phone number from dashboard (DELETE /api/v1/phone_number/:id)
router.delete('/:id', deletePhoneNumberFromDashboard);

// Unified webhook endpoint (handles create, update, delete, attach, detach)
router.post('/webhook', unifiedPhoneNumberWebhook);

// Backward compatibility webhook routes
router.post('/create', createPhoneNumber); // Webhook: Phone number created in OMNIDIMENSION
router.post('/delete', deletePhoneNumber); // Webhook: Phone number deleted in OMNIDIMENSION

module.exports = router;
