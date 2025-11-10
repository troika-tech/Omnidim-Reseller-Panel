const express = require('express');
const auth = require('../middleware/auth.js');
const omniSource = require('../middleware/omniSource.js');
const {
  createKnowledgeBaseFile,
  deleteKnowledgeBaseFile,
  unifiedKnowledgeBaseWebhook,
  detachFilesFromAgent,
  attachFilesToAgent
} = require('../controllers/filesController');

const router = express.Router();

// All routes protected with authentication
router.use(auth);

// Add omniSource middleware to identify requests from OMNIDIMENSION
router.use(omniSource);

// Knowledge base routes matching the API format
// Unified webhook endpoint that handles both create and delete events - USE THIS ONE URL
router.post('/webhook', unifiedKnowledgeBaseWebhook); // Unified webhook: handles both create and delete from OMNIDIMENSION
router.post('/create', createKnowledgeBaseFile); // Webhook: File created in OMNIDIMENSION (backward compatibility)
router.post('/delete', deleteKnowledgeBaseFile); // Webhook: File deleted in OMNIDIMENSION (backward compatibility)
router.post('/detach', detachFilesFromAgent);
router.post('/attach', attachFilesToAgent);

// Add a route to list knowledge base files
router.get('/', (req, res) => {
  // Forward to the files controller
  require('../controllers/filesController').getFiles(req, res);
});

module.exports = router;

