const express = require('express');
const omniSource = require('../middleware/omniSource.js');

// Import module-specific webhook handlers
const {
  unifiedKnowledgeBaseWebhook, // Module 2: Files
} = require('../controllers/filesController');
const {
  unifiedPhoneNumberWebhook, // Module 3: Phone Numbers
} = require('../controllers/phoneNumbersController');

// TODO: Import handlers for other modules when implemented
// const { unifiedVoiceAssistantWebhook } = require('../controllers/voiceAssistantsController');
// const { unifiedCallLogWebhook } = require('../controllers/callLogsController');
// const { unifiedBulkCallWebhook } = require('../controllers/bulkCallsController');

const router = express.Router();

// Add omniSource middleware to identify requests from OMNIDIMENSION
router.use(omniSource);

// Root-level unified webhook endpoint
// This is the ONE webhook URL to configure in OMNIDIMENSION
// It detects resource type from request body and routes to appropriate module handler
router.post('/', async (req, res) => {
  try {
    const body = req.body;
    
    console.log('📥 Unified Webhook received:', {
      hasFile: !!(body.file || body.file_id),
      hasAgent: !!(body.agent || body.agent_id),
      hasPhoneNumber: !!(body.phone_number || body.phone_number_id),
      hasCallLog: !!(body.call_log || body.call_id),
      hasBulkCall: !!(body.bulk_call || body.campaign_id),
      event: body.event || body.action,
    });

    // Module 2: Files - Check for file-related fields
    if (body.file || body.file_id || body.files || body.file_ids) {
      console.log('📁 Routing to Files module (knowledge base)');
      return await unifiedKnowledgeBaseWebhook(req, res);
    }

    // Module 1: Voice Assistants (Agents) - Check for agent-related fields
    if (body.agent || body.agent_id) {
      console.log('🤖 Routing to Voice Assistants module');
      // TODO: Implement when module is ready
      // return await unifiedVoiceAssistantWebhook(req, res);
      return res.status(501).json({
        success: false,
        message: 'Voice Assistants webhook handler not yet implemented',
        detectedResource: 'agent',
      });
    }

    // Module 3: Phone Numbers - Check for phone number-related fields
    if (body.phone_number || body.phone_number_id || body.phone) {
      console.log('📞 Routing to Phone Numbers module');
      return await unifiedPhoneNumberWebhook(req, res);
    }

    // Module 4: Call Logs - Check for call log-related fields
    if (body.call_log || body.call_id || body.call) {
      console.log('📋 Routing to Call Logs module');
      // TODO: Implement when module is ready
      // return await unifiedCallLogWebhook(req, res);
      return res.status(501).json({
        success: false,
        message: 'Call Logs webhook handler not yet implemented',
        detectedResource: 'call_log',
      });
    }

    // Module 5: Bulk Calls - Check for bulk call/campaign-related fields
    if (body.bulk_call || body.campaign_id || body.campaign || body.bulk_call_id) {
      console.log('📢 Routing to Bulk Calls module');
      // TODO: Implement when module is ready
      // return await unifiedBulkCallWebhook(req, res);
      return res.status(501).json({
        success: false,
        message: 'Bulk Calls webhook handler not yet implemented',
        detectedResource: 'bulk_call',
      });
    }

    // If no resource type detected, log and return error
    console.error('❌ Unified Webhook: Unable to detect resource type from request body');
    console.error('Request body:', JSON.stringify(body, null, 2));
    
    return res.status(400).json({
      success: false,
      message: 'Unable to detect resource type from webhook payload',
      hint: 'Expected one of: file/file_id, agent/agent_id, phone_number/phone_number_id, call_log/call_id, bulk_call/campaign_id',
      receivedBody: body,
    });

  } catch (error) {
    console.error('❌ Unified Webhook Error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error processing webhook',
      error: error.message,
    });
  }
});

module.exports = router;

