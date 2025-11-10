const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const {
  createVoiceAssistant,
  getVoiceAssistants,
  getVoiceAssistant,
  updateVoiceAssistant,
  deleteVoiceAssistant
} = require('../controllers/voiceAssistantsController');

// All routes protected with authentication
router.use(auth);

// Create a new voice assistant
router.post('/', createVoiceAssistant);

// Get all voice assistants with search and pagination
router.get('/', getVoiceAssistants);

// Get single voice assistant
router.get('/:id', getVoiceAssistant);

// Update voice assistant
router.put('/:id', updateVoiceAssistant);

// Delete voice assistant
router.delete('/:id', deleteVoiceAssistant);

module.exports = router;

