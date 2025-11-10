const PhoneNumber = require("../models/PhoneNumber");
const VoiceAssistant = require("../models/VoiceAssistant");
const mongoose = require("mongoose");
const {
  syncToOmnidimension,
  fetchFromOmnidimension,
} = require("../services/omniApi.js");

// Helper function to extract numeric ID from omnidimensionId
function extractNumericId(id) {
  if (!id) return null;
  let stringId = id.toString();
  // Remove common prefixes if present
  if (stringId.startsWith("phone_")) {
    stringId = stringId.replace("phone_", "");
  }
  if (stringId.startsWith("pn_")) {
    stringId = stringId.replace("pn_", "");
  }
  // Always return as string to avoid PostgreSQL integer range issues
  return stringId;
}

// Helper function to sync phone numbers from OMNIDIMENSION to local database
async function syncPhoneNumbersFromOmnidimension(omniPhoneNumbers, userId) {
  let syncedCount = 0;
  let createdCount = 0;
  let updatedCount = 0;

  if (!Array.isArray(omniPhoneNumbers)) {
    return { syncedCount: 0, createdCount: 0, updatedCount: 0 };
  }

  for (const omniPhone of omniPhoneNumbers) {
    try {
      // Skip if essential fields are missing
      if (!omniPhone.id && !omniPhone.phone_number_id) {
        continue;
      }

      const omniId = (omniPhone.id || omniPhone.phone_number_id).toString();
      const phoneNumber =
        omniPhone.number || omniPhone.phone_number || omniPhone.phoneNumber;

      if (!phoneNumber) {
        continue;
      }

      // Debug: Log the full Omni API response to understand the format

      // Find existing phone number by omnidimensionId
      const existing = await PhoneNumber.findOne({
        omnidimensionId: omniId,
        userId,
      });

      // Map OMNIDIMENSION API fields to our schema
      const mappedData = {
        omnidimensionId: omniId,
        number: phoneNumber,
        label: omniPhone.label || omniPhone.name || phoneNumber,
        name: omniPhone.name || omniPhone.label || phoneNumber,
        provider: omniPhone.provider || "OTHER",
        country: omniPhone.country || "US",
        status: omniPhone.status || "Active",
        capabilities: omniPhone.capabilities || { voice: true, sms: false },
        lastSynced: new Date(),
        syncStatus: "synced",
      };

      // Handle attachedAgent from Omni API
      // Omni API uses "active_bot_id" field - can be false (no agent) or number/string (agent ID)
      let attachedAgentId = null;

      // Check active_bot_id first (this is the actual field Omni uses)
      if (omniPhone.active_bot_id && omniPhone.active_bot_id !== false) {
        attachedAgentId = omniPhone.active_bot_id.toString();
      }
      // Fallback to other possible field names from Omni API
      else if (
        omniPhone.agent_id ||
        omniPhone.attached_agent_id ||
        omniPhone.bot_id ||
        omniPhone.attached_bot_id ||
        omniPhone.agent?.id ||
        omniPhone.bot?.id ||
        omniPhone.attached_agent?.id ||
        omniPhone.attached_bot?.id
      ) {
        attachedAgentId = (
          omniPhone.agent_id ||
          omniPhone.attached_agent_id ||
          omniPhone.bot_id ||
          omniPhone.attached_bot_id ||
          omniPhone.agent?.id ||
          omniPhone.bot?.id ||
          omniPhone.attached_agent?.id ||
          omniPhone.attached_bot?.id
        ).toString();
      }

      if (attachedAgentId) {
        // Find voice assistant by omnidimensionId
        const VoiceAssistant = require("../models/VoiceAssistant");
        const agent = await VoiceAssistant.findOne({
          omnidimensionId: attachedAgentId,
          userId,
        });
        if (agent) {
          mappedData.attachedAgent = agent._id;
        } else {
          // Try to find any agent with this ID (in case userId mismatch)
          const anyAgent = await VoiceAssistant.findOne({
            omnidimensionId: attachedAgentId,
          });
          if (anyAgent) {
          }

          // Keep existing attachedAgent if agent not found yet
          mappedData.attachedAgent = existing?.attachedAgent || null;
        }
      } else {
        // No agent attached in Omni, detach locally
        mappedData.attachedAgent = null;
      }

      if (existing) {
        // Check if attachedAgent changed
        const agentChanged =
          existing.attachedAgent?.toString() !==
          mappedData.attachedAgent?.toString();

        // Update existing
        Object.assign(existing, mappedData);
        await existing.save();

        // Broadcast update if agent changed
        if (agentChanged && global.io) {
          const updatedPhoneNumber = await PhoneNumber.findById(
            existing._id
          ).populate("attachedAgent", "name description");
          global.io.emit("phone_number_updated", updatedPhoneNumber);
        }

        updatedCount++;
        syncedCount++;
      } else {
        // Create new
        const newPhoneNumber = new PhoneNumber({
          userId,
          ...mappedData,
          syncedAt: new Date(),
        });
        await newPhoneNumber.save();
        createdCount++;
        syncedCount++;

        // Broadcast to connected clients
        if (global.io) {
          const populatedPhoneNumber = await PhoneNumber.findById(
            newPhoneNumber._id
          ).populate("attachedAgent", "name description");
          global.io.emit("phone_number_created", populatedPhoneNumber);
        }
      }
    } catch (error) {}
  }

  return { syncedCount, createdCount, updatedCount };
}

// List phone numbers (GET /api/v1/phone_number/list)
// Matches: curl -X GET "https://backend.omnidim.io/api/v1/phone_number/list?pageno=1&pagesize=10"
exports.getPhoneNumbers = async (req, res) => {
  try {
    const userId = await getUserIdObjectId(req.user.id);
    const { pageno = 1, pagesize = 10 } = req.query;

    // Auto-sync from OMNIDIMENSION first (background, don't wait)
    try {
      const response = await fetchFromOmnidimension(
        "phone_number/list",
        "GET",
        {
          pageno: 1,
          pagesize: 100, // Fetch more to ensure we get all numbers
        }
      );

      // Handle different response formats
      const omniPhoneNumbers =
        response?.data || response?.phone_numbers || response || [];

      if (Array.isArray(omniPhoneNumbers) && omniPhoneNumbers.length > 0) {
        // Sync in background without blocking
        syncPhoneNumbersFromOmnidimension(omniPhoneNumbers, userId).catch(
          (err) => {}
        );
      }
    } catch (apiError) {
      // Continue even if API fails - just use local data
    }

    // Build query
    const query = { userId };

    // Calculate pagination (OMNIDIMENSION uses pageno and pagesize)
    const skip = (parseInt(pageno) - 1) * parseInt(pagesize);
    const limit = parseInt(pagesize);

    // Get phone numbers with populated agent
    const phoneNumbers = await PhoneNumber.find(query)
      .populate("attachedAgent", "name description")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    // Get total count
    const total = await PhoneNumber.countDocuments(query);

    res.json({
      success: true,
      data: phoneNumbers,
      pagination: {
        pageno: parseInt(pageno),
        pagesize: parseInt(pagesize),
        total,
        pages: Math.ceil(total / parseInt(pagesize)),
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Import phone number from Twilio (POST /api/v1/phone_number/import/twilio)
// Matches: curl -X POST "https://backend.omnidim.io/api/v1/phone_number/import/twilio"
exports.importTwilio = async (req, res) => {
  try {
    const userId = await getUserIdObjectId(req.user.id);
    const { phone_number, account_sid, account_token, name } = req.body;

    // Validate required fields
    if (!phone_number || !account_sid || !account_token) {
      return res.status(400).json({
        success: false,
        message: "phone_number, account_sid, and account_token are required",
      });
    }

    // Check if number already exists
    const existing = await PhoneNumber.findOne({
      userId,
      number: phone_number,
    });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: "Phone number already exists",
      });
    }

    // Sync to OMNIDIMENSION
    let omnidimensionResponse;
    try {
      omnidimensionResponse = await syncToOmnidimension(
        "phone_number/import/twilio",
        {
          phone_number,
          account_sid,
          account_token,
          name: name || phone_number,
        },
        "POST"
      );
    } catch (apiError) {
      return res.status(502).json({
        success: false,
        message: "Failed to sync with OMNIDIMENSION. Please try again.",
        error: apiError.message,
      });
    }

    // Extract phone number ID from response
    const omniId =
      omnidimensionResponse?.id ||
      omnidimensionResponse?.phone_number_id ||
      omnidimensionResponse?.data?.id;

    if (!omniId) {
      return res.status(502).json({
        success: false,
        message:
          "Failed to sync with OMNIDIMENSION. API did not return phone number ID.",
        error: "No phone number ID in API response",
      });
    }

    // Save to local database
    const phoneNumber = new PhoneNumber({
      userId,
      omnidimensionId: omniId.toString(),
      number: phone_number,
      label: name || phone_number,
      name: name || phone_number,
      provider: "TWILIO",
      country: phone_number.startsWith("+1") ? "US" : "OTHER",
      status: "Active",
      capabilities: {
        voice: true,
        sms: false,
      },
      syncedAt: new Date(),
      lastSynced: new Date(),
      syncStatus: "synced",
    });

    await phoneNumber.save();

    // Broadcast to all connected clients
    if (global.io) {
      global.io.emit("phone_number_created", phoneNumber);
    }

    res.status(201).json({
      success: true,
      message: "Phone number imported and synced successfully",
      data: phoneNumber,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Import phone number from Exotel (POST /api/v1/phone_number/import/exotel)
// Matches: curl -X POST "https://backend.omnidim.io/api/v1/phone_number/import/exotel"
exports.importExotel = async (req, res) => {
  try {
    const userId = await getUserIdObjectId(req.user.id);
    const {
      exotel_phone_number,
      exotel_api_key,
      exotel_api_token,
      exotel_subdomain,
      exotel_account_sid,
      exotel_app_id,
      name,
    } = req.body;

    // Validate required fields
    if (
      !exotel_phone_number ||
      !exotel_api_key ||
      !exotel_api_token ||
      !exotel_subdomain ||
      !exotel_account_sid ||
      !exotel_app_id
    ) {
      return res.status(400).json({
        success: false,
        message: "All Exotel credentials are required",
      });
    }

    // Check if number already exists
    const existing = await PhoneNumber.findOne({
      userId,
      number: exotel_phone_number,
    });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: "Phone number already exists",
      });
    }

    // Sync to OMNIDIMENSION
    let omnidimensionResponse;
    try {
      omnidimensionResponse = await syncToOmnidimension(
        "phone_number/import/exotel",
        {
          exotel_phone_number,
          exotel_api_key,
          exotel_api_token,
          exotel_subdomain,
          exotel_account_sid,
          exotel_app_id,
          name: name || exotel_phone_number,
        },
        "POST"
      );
    } catch (apiError) {
      return res.status(502).json({
        success: false,
        message: "Failed to sync with OMNIDIMENSION. Please try again.",
        error: apiError.message,
      });
    }

    // Extract phone number ID from response
    const omniId =
      omnidimensionResponse?.id ||
      omnidimensionResponse?.phone_number_id ||
      omnidimensionResponse?.data?.id;

    if (!omniId) {
      return res.status(502).json({
        success: false,
        message:
          "Failed to sync with OMNIDIMENSION. API did not return phone number ID.",
        error: "No phone number ID in API response",
      });
    }

    // Save to local database
    const phoneNumber = new PhoneNumber({
      userId,
      omnidimensionId: omniId.toString(),
      number: exotel_phone_number,
      label: name || exotel_phone_number,
      name: name || exotel_phone_number,
      provider: "EXOTEL",
      country: "IN", // Exotel is primarily for India
      status: "Active",
      capabilities: {
        voice: true,
        sms: false,
      },
      syncedAt: new Date(),
      lastSynced: new Date(),
      syncStatus: "synced",
    });

    await phoneNumber.save();

    // Broadcast to all connected clients
    if (global.io) {
      global.io.emit("phone_number_created", phoneNumber);
    }

    res.status(201).json({
      success: true,
      message: "Phone number imported and synced successfully",
      data: phoneNumber,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Attach phone number to agent (POST /api/v1/phone_number/attach)
// Matches: curl -X POST "https://backend.omnidim.io/api/v1/phone_number/attach"
exports.attachAgent = async (req, res) => {
  try {
    // Get userId - may not exist if webhook doesn't have auth middleware
    let userId = req.user?.id;
    if (!userId) {
      userId = await getUserIdFromWebhook(req);
      req.user = req.user || { id: userId };
    } else {
      userId = await getUserIdObjectId(userId);
    }

    // Handle different webhook formats from Omni
    const phone_number_id =
      req.body.phone_number_id || req.body.phone_number?.id;
    const agent_id =
      req.body.agent_id || req.body.agent?.id || req.body.attached_agent_id;

    if (!phone_number_id || !agent_id) {
      return res.status(400).json({
        success: false,
        message: "phone_number_id and agent_id are required",
      });
    }

    // Find phone number - prioritize omnidimensionId since phone_number_id is usually a number from OMNIDIMENSION
    // Only check _id if phone_number_id looks like a MongoDB ObjectId (24 hex chars)
    const phoneNumberIdStr = phone_number_id.toString();
    const isObjectId = /^[0-9a-fA-F]{24}$/.test(phoneNumberIdStr);

    const phoneNumber = await PhoneNumber.findOne({
      $or: isObjectId
        ? [{ omnidimensionId: phoneNumberIdStr }, { _id: phone_number_id }]
        : [{ omnidimensionId: phoneNumberIdStr }],
      userId,
    });

    if (!phoneNumber) {
      return res.status(404).json({
        success: false,
        message: "Phone number not found",
      });
    }

    // Verify agent exists and belongs to user - prioritize omnidimensionId
    // Only check _id if agent_id looks like a MongoDB ObjectId (24 hex chars)
    const agentIdStr = agent_id.toString();
    const isAgentObjectId = /^[0-9a-fA-F]{24}$/.test(agentIdStr);

    const agent = await VoiceAssistant.findOne({
      $or: isAgentObjectId
        ? [{ omnidimensionId: agentIdStr }, { _id: agent_id }]
        : [{ omnidimensionId: agentIdStr }],
      userId,
    });

    if (!agent) {
      return res.status(404).json({
        success: false,
        message: "Voice assistant not found",
      });
    }

    // Attach to OMNIDIMENSION only if request didn't come from Omni
    // This prevents infinite sync loops
    if (req.headers["x-source"] !== "omnidimension") {
      // Get omnidimension IDs for API call (extract numeric IDs and convert to numbers)
      const maxInt = 2147483647;
      const phoneOmniIdStr = extractNumericId(
        phoneNumber.omnidimensionId || phoneNumber._id
      );
      const phoneOmniId = parseInt(phoneOmniIdStr, 10);

      const agentOmniIdStr = extractNumericId(
        agent.omnidimensionId || agent._id
      );
      const agentOmniId = parseInt(agentOmniIdStr, 10);

      if (isNaN(phoneOmniId) || phoneOmniId > maxInt) {
        console.error(
          `⚠️  Phone number ID too large or invalid: ${phoneOmniIdStr}`
        );
      } else if (isNaN(agentOmniId) || agentOmniId > maxInt) {
        console.error(`⚠️  Agent ID too large or invalid: ${agentOmniIdStr}`);
      } else {
        try {
          console.log(
            `📎 Attempting to attach phone number to agent in OMNIDIMENSION: phone_number_id=${phoneOmniId}, agent_id=${agentOmniId}`
          );
          // Use the correct endpoint from Omni documentation
          await syncToOmnidimension(
            "phone_number/attach",
            {
              phone_number_id: phoneOmniId, // Send as number
              agent_id: agentOmniId, // Send as number
            },
            "POST"
          );
          console.log(
            `✅ Successfully attached phone number to agent in OMNIDIMENSION: phone_number_id=${phoneOmniId}`
          );
        } catch (apiError) {
          console.error(
            `❌ Failed to attach phone number to agent in OMNIDIMENSION: phone_number_id=${phoneOmniId}`,
            apiError.response?.status,
            apiError.response?.data || apiError.message
          );
          // Continue with local update even if API fails
        }
      }
    } else {
      console.log(
        `🔄 Skipping Omni API call as request came from Omni: phone_number_id=${phone_number_id}`
      );
    }

    // Update local database
    phoneNumber.attachedAgent = agent._id;
    phoneNumber.lastSynced = new Date();
    phoneNumber.syncStatus = "synced";
    await phoneNumber.save();

    const updatedPhoneNumber = await PhoneNumber.findById(
      phoneNumber._id
    ).populate("attachedAgent", "name description");

    // Broadcast to all connected clients
    if (global.io) {
      global.io.emit("phone_number_updated", updatedPhoneNumber);
      console.log("📡 Broadcasted: phone_number_updated");
    }

    res.json({
      success: true,
      message: "Agent attached successfully",
      data: updatedPhoneNumber,
    });
  } catch (error) {
    console.error("Attach Agent Error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Detach phone number from agent (POST /api/v1/phone_number/detach)
// Matches: curl -X POST "https://backend.omnidim.io/api/v1/phone_number/detach"
exports.detachAgent = async (req, res) => {
  try {
    // Get userId - may not exist if webhook doesn't have auth middleware
    let userId = req.user?.id;
    if (!userId) {
      userId = await getUserIdFromWebhook(req);
      req.user = req.user || { id: userId };
    } else {
      userId = await getUserIdObjectId(userId);
    }

    // Handle different webhook formats from Omni
    const phone_number_id =
      req.body.phone_number_id || req.body.phone_number?.id;

    if (!phone_number_id) {
      return res.status(400).json({
        success: false,
        message: "phone_number_id is required",
      });
    }

    // Find phone number - prioritize omnidimensionId since phone_number_id is usually a number from OMNIDIMENSION
    // Only check _id if phone_number_id looks like a MongoDB ObjectId (24 hex chars)
    const phoneNumberIdStr = phone_number_id.toString();
    const isObjectId = /^[0-9a-fA-F]{24}$/.test(phoneNumberIdStr);

    const phoneNumber = await PhoneNumber.findOne({
      $or: isObjectId
        ? [{ omnidimensionId: phoneNumberIdStr }, { _id: phone_number_id }]
        : [{ omnidimensionId: phoneNumberIdStr }],
      userId,
    });

    if (!phoneNumber) {
      return res.status(404).json({
        success: false,
        message: "Phone number not found",
      });
    }

    // Detach from OMNIDIMENSION only if request didn't come from Omni
    // This prevents infinite sync loops
    if (req.headers["x-source"] !== "omnidimension") {
      // Get omnidimension ID for API call (extract numeric ID and convert to number)
      const maxInt = 2147483647;
      const phoneOmniIdStr = extractNumericId(
        phoneNumber.omnidimensionId || phoneNumber._id
      );
      const phoneOmniId = parseInt(phoneOmniIdStr, 10);

      if (isNaN(phoneOmniId) || phoneOmniId > maxInt) {
        console.error(
          `⚠️  Phone number ID too large or invalid: ${phoneOmniIdStr}`
        );
      } else {
        try {
          console.log(
            `📎 Attempting to detach phone number from agent in OMNIDIMENSION: phone_number_id=${phoneOmniId}`
          );
          // Use the correct endpoint from Omni documentation
          await syncToOmnidimension(
            "phone_number/detach",
            {
              phone_number_id: phoneOmniId, // Send as number
            },
            "POST"
          );
          console.log(
            `✅ Successfully detached phone number from agent in OMNIDIMENSION: phone_number_id=${phoneOmniId}`
          );
        } catch (apiError) {
          console.error(
            `❌ Failed to detach phone number from agent in OMNIDIMENSION: phone_number_id=${phoneOmniId}`,
            apiError.response?.status,
            apiError.response?.data || apiError.message
          );
          // Continue with local update even if API fails
        }
      }
    } else {
      console.log(
        `🔄 Skipping Omni API call as request came from Omni: phone_number_id=${phone_number_id}`
      );
    }

    // Update local database
    phoneNumber.attachedAgent = null;
    phoneNumber.lastSynced = new Date();
    phoneNumber.syncStatus = "synced";
    await phoneNumber.save();

    // Broadcast to all connected clients
    if (global.io) {
      global.io.emit("phone_number_updated", phoneNumber);
      console.log("📡 Broadcasted: phone_number_updated");
    }

    res.json({
      success: true,
      message: "Agent detached successfully",
      data: phoneNumber,
    });
  } catch (error) {
    console.error("Detach Agent Error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// ============================================================================
// WEBHOOK HANDLERS (for bidirectional sync from OMNIDIMENSION)
// ============================================================================

// Helper function to convert userId string to ObjectId
function toObjectId(userId) {
  if (!userId) return null;
  // If already ObjectId, return as is
  if (userId instanceof mongoose.Types.ObjectId) {
    return userId;
  }
  // If valid ObjectId string, convert
  if (mongoose.Types.ObjectId.isValid(userId)) {
    return new mongoose.Types.ObjectId(userId);
  }
  // If not valid, return null (caller should use getUserIdObjectId() for admin fallback)
  return null;
}

// Helper function to ensure we have a valid userId ObjectId
async function getUserIdObjectId(userId) {
  if (!userId) {
    // Try to get default admin user or create one
    const User = require("../models/User");
    let adminUser = await User.findOne({ role: "admin" });
    if (!adminUser) {
      // Create default admin user if doesn't exist
      adminUser = await User.create({
        email: "admin@example.com",
        role: "admin",
      });
    }
    return adminUser._id;
  }
  return toObjectId(userId);
}

// Helper function to get userId from webhook request
async function getUserIdFromWebhook(req) {
  // If req.user exists (from auth middleware), use it
  if (req.user && req.user.id) {
    return await getUserIdObjectId(req.user.id);
  }

  // Try to find userId from existing phone number by omnidimensionId
  const body = req.body;
  const phoneNumberId =
    body.phone_number_id || body.phone_number?.id || body.id;

  if (phoneNumberId) {
    const existing = await PhoneNumber.findOne({
      omnidimensionId: phoneNumberId.toString(),
    }).select("userId");

    if (existing && existing.userId) {
      return existing.userId;
    }
  }

  // Fallback: get or create default admin user
  return await getUserIdObjectId();
}

// Unified phone number webhook (handles create, update, delete, attach, detach)
exports.unifiedPhoneNumberWebhook = async (req, res) => {
  try {
    const body = req.body;

    console.log(
      `📥 Unified phone number webhook received:`,
      JSON.stringify(body, null, 2)
    );

    // Check for attach events - Omni might send:
    // - { phone_number_id, agent_id } (standard format)
    // - { phone_number: { id: ... }, agent: { id: ... } }
    // - { phone_number_id, agent_id, event: 'attach' }
    const hasPhoneNumberId = body.phone_number_id || body.phone_number?.id;
    const hasAgentId =
      body.agent_id || body.agent?.id || body.attached_agent_id;
    const eventType = body.event || body.action || body.type;

    if (hasPhoneNumberId && hasAgentId && eventType !== "detach") {
      // Attach event
      console.log(
        `📥 Unified webhook: Detected ATTACH event for phone_number_id=${hasPhoneNumberId}, agent_id=${hasAgentId}`
      );
      return await exports.attachAgent(req, res);
    }

    // Check for detach events - Omni might send:
    // - { phone_number_id, action: 'detach' }
    // - { phone_number_id, event: 'detach' }
    // - { phone_number_id } without agent_id (when detaching)
    if (
      hasPhoneNumberId &&
      (eventType === "detach" || (!hasAgentId && eventType !== "attach"))
    ) {
      // Detach event - but double-check it's not a delete
      if (
        !body.phone_number &&
        !body.phone_number?.id &&
        eventType !== "delete"
      ) {
        console.log(
          `📥 Unified webhook: Detected DETACH event for phone_number_id=${hasPhoneNumberId}`
        );
        return await exports.detachAgent(req, res);
      }
    }

    // Check if this is a delete event
    if (body.phone_number_id && (!body.phone_number || !body.phone_number.id)) {
      console.log(
        `📥 Unified webhook: Detected DELETE event for phone_number_id=${body.phone_number_id}`
      );
      return await exports.deletePhoneNumber(req, res);
    }

    // Otherwise, treat as create/update event
    console.log(
      `📥 Unified webhook: Detected CREATE/UPDATE event for phone number`
    );
    return await exports.createPhoneNumber(req, res);
  } catch (error) {
    console.error("Unified Phone Number Webhook Error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Create phone number webhook (receives webhooks from OMNIDIMENSION when a phone number is created)
exports.createPhoneNumber = async (req, res) => {
  try {
    // Get userId - may not exist if webhook doesn't have auth middleware
    let userId = req.user?.id;
    if (!userId) {
      userId = await getUserIdFromWebhook(req);
      req.user = req.user || { id: userId };
    } else {
      userId = await getUserIdObjectId(userId);
    }
    // OMNIDIMENSION sends the phone number data in the request body
    const omniPhoneNumber = req.body.phone_number || req.body;

    if (!omniPhoneNumber.id && !omniPhoneNumber.phone_number_id) {
      return res.status(400).json({
        success: false,
        message: "phone_number.id or phone_number_id is required",
      });
    }

    const phoneNumberId = omniPhoneNumber.id || omniPhoneNumber.phone_number_id;

    console.log(
      `📥 Received phone number creation webhook from OMNIDIMENSION: phone_number_id=${phoneNumberId}`
    );

    // Check if phone number already exists in local database
    const existing = await PhoneNumber.findOne({
      omnidimensionId: phoneNumberId.toString(),
      userId,
    });

    if (existing) {
      // Update existing phone number
      existing.number =
        omniPhoneNumber.number ||
        omniPhoneNumber.phone_number ||
        existing.number;
      existing.label =
        omniPhoneNumber.label || omniPhoneNumber.name || existing.label;
      existing.name = omniPhoneNumber.name || existing.name;
      existing.provider = omniPhoneNumber.provider || existing.provider;
      existing.country = omniPhoneNumber.country || existing.country;
      existing.status = omniPhoneNumber.status || existing.status;
      existing.lastSynced = new Date();
      existing.syncStatus = "synced";
      await existing.save();

      console.log(
        `✅ Updated existing phone number from OMNIDIMENSION webhook: ${existing.number}`
      );

      // Broadcast update to connected clients
      if (global.io) {
        global.io.emit("phone_number_updated", existing);
        console.log(
          "📡 Broadcasted: phone_number_updated (from OMNIDIMENSION webhook)"
        );
      }
    } else {
      // Create new phone number from OMNIDIMENSION webhook
      const phoneNumber = new PhoneNumber({
        userId,
        omnidimensionId: phoneNumberId.toString(),
        number:
          omniPhoneNumber.number ||
          omniPhoneNumber.phone_number ||
          `Unknown ${phoneNumberId}`,
        label: omniPhoneNumber.label || omniPhoneNumber.name || "Personal",
        name: omniPhoneNumber.name || omniPhoneNumber.label || "Personal",
        provider: omniPhoneNumber.provider || "OTHER",
        country: omniPhoneNumber.country || "US",
        status: omniPhoneNumber.status || "Active",
        capabilities: omniPhoneNumber.capabilities || {
          voice: true,
          sms: false,
        },
        syncedAt: new Date(),
        lastSynced: new Date(),
        syncStatus: "synced",
        attachedAgent: null,
      });
      await phoneNumber.save();

      console.log(
        `✅ Created new phone number from OMNIDIMENSION webhook: ${phoneNumber.number}`
      );

      // Broadcast creation to connected clients
      if (global.io) {
        global.io.emit("phone_number_created", phoneNumber);
        console.log(
          "📡 Broadcasted: phone_number_created (from OMNIDIMENSION webhook)"
        );
      }
    }

    // Return success - don't call back to OMNIDIMENSION (prevents infinite loop)
    res.json({
      success: true,
      message: "Phone number creation webhook processed successfully",
    });
  } catch (error) {
    console.error("Create Phone Number Webhook Error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Delete phone number from dashboard (DELETE /api/v1/phone_number/:id)
// This handles deletions initiated from the dashboard - syncs to Omni and deletes from MongoDB
exports.deletePhoneNumberFromDashboard = async (req, res) => {
  try {
    const userId = await getUserIdObjectId(req.user.id);
    const { id } = req.params; // This can be MongoDB _id or omnidimensionId

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "phone_number_id is required",
      });
    }

    console.log(`🗑️  Deleting phone number from dashboard: id=${id}`);

    // Find phone number - check both omnidimensionId and _id
    const phoneNumberIdStr = id.toString();
    const isObjectId = /^[0-9a-fA-F]{24}$/.test(phoneNumberIdStr);

    const phoneNumber = await PhoneNumber.findOne({
      $or: isObjectId
        ? [{ omnidimensionId: phoneNumberIdStr }, { _id: id }]
        : [{ omnidimensionId: phoneNumberIdStr }],
      userId,
    });

    if (!phoneNumber) {
      return res.status(404).json({
        success: false,
        message: "Phone number not found",
      });
    }

    // Delete from OMNIDIMENSION only if request didn't come from Omni
    // This prevents infinite sync loops
    if (req.headers["x-source"] !== "omnidimension") {
      // Get omnidimension ID for API call (extract numeric ID)
      const maxInt = 2147483647;
      const phoneOmniIdStr = extractNumericId(
        phoneNumber.omnidimensionId || phoneNumber._id
      );
      const phoneOmniId = parseInt(phoneOmniIdStr, 10);

      if (isNaN(phoneOmniId) || phoneOmniId > maxInt) {
        console.error(
          `⚠️  Phone number ID too large or invalid: ${phoneOmniIdStr}`
        );
      } else {
        try {
          console.log(
            `🗑️  Attempting to delete phone number from OMNIDIMENSION: phone_number_id=${phoneOmniId}`
          );

          // Delete endpoint format from Omni dashboard:
          // DELETE https://www.omnidim.io/api/phone-numbers/{id}
          // Note: Uses 'phone-numbers' (hyphen), www.omnidim.io domain, and /api/ (not /api/v1/)

          // Make direct call to the exact endpoint format used by Omni dashboard
          const axios = require("axios");
          const config = require("../config/env.js");

          // Try the exact Omni dashboard format: www.omnidim.io/api/phone-numbers/{id}
          // Note: Dashboard uses cookie-based auth, but we'll try with API key in various formats
          let dashboardSuccess = false;

          // Try 1: With Bearer token (standard format)
          try {
            const dashboardURL = `https://www.omnidim.io/api/phone-numbers/${phoneOmniId}`;
            console.log(
              `🔄 Trying: DELETE ${dashboardURL} (with Bearer token)`
            );

            const response = await axios.delete(dashboardURL, {
              headers: {
                Authorization: `Bearer ${config.omnidimension.apiKey}`,
                "Content-Type": "application/json",
                Origin: "https://www.omnidim.io",
                Referer: "https://www.omnidim.io/phone-numbers",
              },
              timeout: 30000,
            });

            console.log(
              `✅ Successfully deleted phone number from OMNIDIMENSION using DELETE ${dashboardURL}: phone_number_id=${phoneOmniId}`
            );
            dashboardSuccess = true;
          } catch (dashboardError1) {
            // Try 2: API key as query parameter
            try {
              const dashboardURL = `https://www.omnidim.io/api/phone-numbers/${phoneOmniId}?api_key=${config.omnidimension.apiKey}`;
              console.log(
                `🔄 Trying: DELETE ${dashboardURL} (with API key as query param)`
              );

              const response = await axios.delete(dashboardURL, {
                headers: {
                  "Content-Type": "application/json",
                  Origin: "https://www.omnidim.io",
                  Referer: "https://www.omnidim.io/phone-numbers",
                },
                timeout: 30000,
              });

              console.log(
                `✅ Successfully deleted phone number from OMNIDIMENSION using DELETE with query param: phone_number_id=${phoneOmniId}`
              );
              dashboardSuccess = true;
            } catch (dashboardError2) {
              // Try 3: API key in X-API-Key header
              try {
                const dashboardURL = `https://www.omnidim.io/api/phone-numbers/${phoneOmniId}`;
                console.log(
                  `🔄 Trying: DELETE ${dashboardURL} (with X-API-Key header)`
                );

                const response = await axios.delete(dashboardURL, {
                  headers: {
                    "X-API-Key": config.omnidimension.apiKey,
                    "Content-Type": "application/json",
                    Origin: "https://www.omnidim.io",
                    Referer: "https://www.omnidim.io/phone-numbers",
                  },
                  timeout: 30000,
                });

                console.log(
                  `✅ Successfully deleted phone number from OMNIDIMENSION using DELETE with X-API-Key: phone_number_id=${phoneOmniId}`
                );
                dashboardSuccess = true;
              } catch (dashboardError3) {
                console.log(
                  `⚠️  All www.omnidim.io/api/phone-numbers/${phoneOmniId} attempts failed. Dashboard uses cookie auth which we can't replicate. Trying backend.omnidim.io...`
                );
              }
            }
          }

          if (!dashboardSuccess) {
            // Fallback to backend API if dashboard endpoint doesn't work
            try {
              // Try backend.omnidim.io/api/v1/phone-numbers/{id}
              console.log(
                `⚠️  DELETE www.omnidim.io/api/phone-numbers/${phoneOmniId} failed, trying backend.omnidim.io...`
              );
              try {
                await fetchFromOmnidimension(
                  `phone-numbers/${phoneOmniId}`, // Use hyphen format
                  "DELETE"
                );
                console.log(
                  `✅ Successfully deleted phone number from OMNIDIMENSION using DELETE /api/v1/phone-numbers/${phoneOmniId}: phone_number_id=${phoneOmniId}`
                );
              } catch (backendError) {
                // Try phone_number format as fallback
                console.log(
                  `⚠️  DELETE backend.omnidim.io/api/v1/phone-numbers/${phoneOmniId} failed (${backendError.response?.status}), trying phone_number format...`
                );
                try {
                  await fetchFromOmnidimension(
                    `phone_number/${phoneOmniId}`,
                    "DELETE"
                  );
                  console.log(
                    `✅ Successfully deleted phone number from OMNIDIMENSION using DELETE /api/v1/phone_number/${phoneOmniId}: phone_number_id=${phoneOmniId}`
                  );
                } catch (underscoreError) {
                  // If all fail, log detailed error but continue with local deletion
                  console.warn(
                    `⚠️  Delete endpoint formats failed for phone_number_id=${phoneOmniId}. Attempted endpoints:`,
                    `\n  1. DELETE www.omnidim.io/api/phone-numbers/${phoneOmniId} (failed - cookie auth required) - Dashboard format`,
                    `\n  2. DELETE backend.omnidim.io/api/v1/phone-numbers/${phoneOmniId} (${
                      backendError.response?.status || "error"
                    }) - Backend API with hyphen`,
                    `\n  3. DELETE backend.omnidim.io/api/v1/phone_number/${phoneOmniId} (${
                      underscoreError.response?.status || "error"
                    }) - Backend API with underscore`,
                    `\n  Continuing with local MongoDB deletion only...`
                  );
                  // Continue with local deletion - this is acceptable behavior
                }
              }
            } catch (apiError) {
              console.error(
                `❌ Unexpected error during delete attempt: phone_number_id=${phoneOmniId}`,
                apiError.response?.status,
                apiError.response?.data || apiError.message
              );
              // Continue with local deletion even if API fails
            }
          }
        } catch (outerApiError) {
          console.error(
            `❌ Outer error during delete attempt: phone_number_id=${phoneOmniId}`,
            outerApiError.response?.status,
            outerApiError.response?.data || outerApiError.message
          );
          // Continue with local deletion even if API fails
        }
      }
    } else {
      console.log(
        `🔄 Skipping Omni API call as request came from Omni: id=${id}`
      );
    }

    // Delete from local database
    // Store the IDs before deletion for broadcasting
    const phoneNumberId = phoneNumber._id;
    const phoneNumberOmniId = phoneNumber.omnidimensionId;

    const deleteResult = await PhoneNumber.deleteOne({
      _id: phoneNumberId,
      userId,
    });

    if (deleteResult.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Phone number not found in database",
      });
    }

    console.log(
      `✅ Successfully deleted phone number from MongoDB: id=${phoneNumberId}, deletedCount=${deleteResult.deletedCount}`
    );

    // Log a note about Omni API deletion status
    if (req.headers["x-source"] !== "omnidimension") {
      console.log(
        `ℹ️  Note: Omni API delete endpoint may not be available. Phone number deleted from local database.`
      );
    }

    // Broadcast deletion to all connected clients
    if (global.io) {
      global.io.emit("phone_number_deleted", {
        id: phoneNumberId,
        omnidimensionId: phoneNumberOmniId,
      });
      console.log("📡 Broadcasted: phone_number_deleted");
    }

    res.json({
      success: true,
      message: "Phone number deleted successfully",
      data: {
        id: phoneNumberId,
        omnidimensionId: phoneNumberOmniId,
      },
      note: "Deleted from local database. Omni API delete endpoint may not be available yet.",
    });
  } catch (error) {
    console.error("Delete Phone Number From Dashboard Error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Delete phone number webhook (receives webhooks from OMNIDIMENSION when a phone number is deleted)
exports.deletePhoneNumber = async (req, res) => {
  try {
    // Get userId - may not exist if webhook doesn't have auth middleware
    let userId = req.user?.id;
    if (!userId) {
      userId = await getUserIdFromWebhook(req);
      req.user = req.user || { id: userId };
    } else {
      userId = await getUserIdObjectId(userId);
    }
    const { phone_number_id } = req.body;

    if (!phone_number_id) {
      return res.status(400).json({
        success: false,
        message: "phone_number_id is required",
      });
    }

    console.log(
      `📥 Received phone number deletion webhook from OMNIDIMENSION: phone_number_id=${phone_number_id}`
    );

    // Find and delete from local database
    const phoneNumber = await PhoneNumber.findOneAndDelete({
      omnidimensionId: phone_number_id.toString(),
      userId,
    });

    if (!phoneNumber) {
      // If not found, try by _id
      const phoneNumberById = await PhoneNumber.findOneAndDelete({
        _id: phone_number_id,
        userId,
      });

      if (!phoneNumberById) {
        console.log(
          `⚠️  Phone number not found in local database: phone_number_id=${phone_number_id}`
        );
        // Still return success to prevent retries
        return res.json({
          success: true,
          message:
            "Phone number deletion webhook processed (not found locally)",
        });
      }

      // Broadcast deletion
      if (global.io) {
        global.io.emit("phone_number_deleted", {
          id: phoneNumberById._id,
          omnidimensionId: phone_number_id,
        });
        console.log(
          "📡 Broadcasted: phone_number_deleted (from OMNIDIMENSION webhook)"
        );
      }
    } else {
      // Broadcast deletion
      if (global.io) {
        global.io.emit("phone_number_deleted", {
          id: phoneNumber._id,
          omnidimensionId: phone_number_id,
        });
        console.log(
          "📡 Broadcasted: phone_number_deleted (from OMNIDIMENSION webhook)"
        );
      }
    }

    console.log(
      `✅ Deleted phone number from local database: phone_number_id=${phone_number_id}`
    );

    // Return success - don't call back to OMNIDIMENSION (prevents infinite loop)
    res.json({
      success: true,
      message: "Phone number deletion webhook processed successfully",
    });
  } catch (error) {
    console.error("Delete Phone Number Webhook Error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};
