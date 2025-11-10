const BulkCall = require("../models/BulkCall");
const BulkCallLine = require("../models/BulkCallLine");
const BulkCallActivityLog = require("../models/BulkCallActivityLog");
const VoiceAssistant = require("../models/VoiceAssistant");
const PhoneNumber = require("../models/PhoneNumber");
const CallLog = require("../models/CallLog");
const User = require("../models/User");
const mongoose = require("mongoose");
const { fetchFromOmnidimension } = require("../services/omniApi");
const { getCallRecording } = require("../services/exotelApi");
const { syncBulkCallLinesFromLogs } = require("../services/bulkCallLineSync");

const ADMIN_CACHE_EXCLUDED_STATUSES = ["active"];

// Helper function to convert userId to ObjectId
function toObjectId(userId) {
  if (!userId) return null;
  if (userId instanceof mongoose.Types.ObjectId) return userId;
  if (typeof userId === "string" && mongoose.Types.ObjectId.isValid(userId)) {
    return new mongoose.Types.ObjectId(userId);
  }
  // If not valid, try to use default admin user
  return new mongoose.Types.ObjectId("507f1f77bcf86cd799439011");
}

// Helper function to ensure we have a valid userId ObjectId
async function getUserIdObjectId(userId) {
  if (!userId) {
    // Try to get default admin user or create one
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

// Helper function to sync bulk calls from OMNIDIMENSION to local database
async function syncBulkCallsFromOmnidimension(omniBulkCalls, userId) {
  let syncedCount = 0;
  let createdCount = 0;
  let updatedCount = 0;

  if (!Array.isArray(omniBulkCalls)) {
    return { syncedCount: 0, createdCount: 0, updatedCount: 0 };
  }

  for (const omniBulkCall of omniBulkCalls) {
    try {
      // Handle response.details format (for single call detail endpoint)
      const bulkCallData = omniBulkCall.details || omniBulkCall;

      // Skip if essential fields are missing
      if (
        !bulkCallData.id &&
        !bulkCallData.bulk_call_id &&
        !bulkCallData.campaign_id
      ) {
        continue;
      }

      const omniId = (
        bulkCallData.id ||
        bulkCallData.bulk_call_id ||
        bulkCallData.campaign_id
      ).toString();
      const existing = await BulkCall.findOne({
        omnidimensionId: omniId,
      });

      // Map OMNIDIMENSION API fields to our schema
      // Omni API fields: twilio_number, bot_id, bot_name, user_name, create_date, total_calls_to_dispatch, total_call_cost, etc.
      const totalCalls =
        bulkCallData.total_calls_to_dispatch ||
        bulkCallData.total_calls ||
        bulkCallData.total_count ||
        0;
      const totalCallsMade =
        bulkCallData.total_calls_made ||
        bulkCallData.total_calls ||
        bulkCallData.calls_made ||
        bulkCallData.total_dialed_calls ||
        0;
      const completedCalls =
        bulkCallData.completed_calls || bulkCallData.calls_picked_up || 0;

      const statusValue =
        bulkCallData.status || bulkCallData.campaign_status || "pending";
      const statusLower = statusValue ? statusValue.toLowerCase() : "";
      const shouldCache =
        statusLower && !ADMIN_CACHE_EXCLUDED_STATUSES.includes(statusLower);
      const cachedTimestamp = shouldCache ? new Date() : undefined;

      // Skip database operations for active status unless it's a paused campaign that resumed
      const isPausedResumed =
        existing &&
        existing.status &&
        existing.status.toLowerCase() === "paused" &&
        statusLower !== "paused" &&
        statusLower !== "active";

      // Only proceed with database operations if shouldCache is true OR it's a paused campaign that resumed
      if (!shouldCache && !isPausedResumed) {
  
        continue;
      }

      const mappedData = {
        omnidimensionId: omniId,
        name:
          bulkCallData.name ||
          bulkCallData.campaign_name ||
          `Campaign ${omniId}`,
        status: statusValue,
        fromNumber:
          bulkCallData.twilio_number ||
          bulkCallData.from_number ||
          bulkCallData.phone_number ||
          bulkCallData.number,
        totalCalls: totalCalls,
        totalCallsMade: totalCallsMade,
        completedCalls: completedCalls,
        callsPickedUp: bulkCallData.calls_picked_up || completedCalls || 0,
        highEngagementCalls: bulkCallData.high_engagement_calls || bulkCallData.high_interaction_calls || 0,
        pendingCalls:
          bulkCallData.total_pending_calls ||
          bulkCallData.pending_calls ||
          bulkCallData.pending_count ||
          0,
        failedCalls:
          bulkCallData.failed_calls || bulkCallData.failed_count || 0,
        notReachableCalls:
          bulkCallData.total_not_reachable_calls ||
          bulkCallData.not_reachable_calls ||
          0,
        noAnswerCalls: bulkCallData.no_answer_calls || 0,
        busyCalls: bulkCallData.busy_calls || 0,
        transferCalls:
          bulkCallData.total_call_transfer_count ||
          bulkCallData.transfer_calls ||
          bulkCallData.transfers ||
          0,
        noLowInteractionCalls:
          bulkCallData.no_low_interaction_calls ||
          bulkCallData.low_interaction_calls ||
          bulkCallData.low_interaction ||
          0,
        concurrentCalls:
          bulkCallData.concurrent_call_limit ||
          bulkCallData.concurrent_calls ||
          bulkCallData.concurrent_limit ||
          1,
        progress: {
          total: totalCalls,
          completed: completedCalls,
          percentage:
            totalCalls > 0 ? ((completedCalls || 0) / totalCalls) * 100 : 0,
        },
        totalCost:
          bulkCallData.total_call_cost ||
          bulkCallData.total_cost ||
          bulkCallData.cost ||
          0,
        createdBy:
          bulkCallData.user_name ||
          bulkCallData.created_by ||
          bulkCallData.creator ||
          "System",
        updatedAt: new Date(),
        lastSynced: new Date(),
        syncStatus: "synced",
      };

      // Handle phoneNumbers array if available in API response
      if (bulkCallData.phone_numbers && Array.isArray(bulkCallData.phone_numbers)) {
        mappedData.phoneNumbers = bulkCallData.phone_numbers;
      } else if (bulkCallData.contact_list && Array.isArray(bulkCallData.contact_list)) {
        // Extract phone numbers from contact list
        const phoneNumbers = bulkCallData.contact_list
          .map(contact => contact.to_number || contact.phone_number || contact.number)
          .filter(num => num && typeof num === 'string')
          .map(num => num.startsWith('+') ? num : `+91${num}`); // Normalize format
        if (phoneNumbers.length > 0) {
          mappedData.phoneNumbers = [...new Set(phoneNumbers)]; // Remove duplicates
        }
      }

      if (shouldCache) {
        mappedData.cachedAt = cachedTimestamp;
      } else if (existing && typeof existing.cachedAt !== "undefined") {
        mappedData.cachedAt = undefined;
      }

      // Handle bot/agent
      if (
        bulkCallData.bot_id ||
        bulkCallData.agent_id ||
        bulkCallData.bot_name
      ) {
        const botId = bulkCallData.bot_id || bulkCallData.agent_id;
        const botIdStr = botId ? botId.toString() : null;
        const botName = bulkCallData.bot_name || bulkCallData.agent_name;

        if (botIdStr) {
          const agent = await VoiceAssistant.findOne({
            omnidimensionId: botIdStr,
            userId,
          });
          if (agent) {
            mappedData.bot = agent._id;
            mappedData.botName = agent.name;
          } else if (botName) {
            mappedData.botName = botName;
          }
        } else if (botName) {
          mappedData.botName = botName;
        }
      }

      // Handle phone number
      if (mappedData.fromNumber) {
        const phoneNumber = await PhoneNumber.findOne({
          number: mappedData.fromNumber,
          userId,
        });
        if (phoneNumber) {
          mappedData.phoneNumberId = phoneNumber._id;
        }
      }

      // Handle dates
      // Omni API uses create_date in format "11/01/2025 02:05:29"
      if (bulkCallData.create_date) {
        // Parse MM/DD/YYYY HH:MM:SS format
        const dateParts = bulkCallData.create_date.split(" ");
        if (dateParts.length === 2) {
          const datePart = dateParts[0].split("/");
          const timePart = dateParts[1].split(":");
          if (datePart.length === 3 && timePart.length === 3) {
            // Month, Day, Year format
            const year = parseInt(datePart[2]);
            const month = parseInt(datePart[0]) - 1; // JavaScript months are 0-indexed
            const day = parseInt(datePart[1]);
            const hours = parseInt(timePart[0]);
            const minutes = parseInt(timePart[1]);
            const seconds = parseInt(timePart[2]);
            mappedData.createdAt = new Date(
              year,
              month,
              day,
              hours,
              minutes,
              seconds
            );
          }
        }
      } else if (bulkCallData.created_at || bulkCallData.createdAt) {
        mappedData.createdAt = new Date(
          bulkCallData.created_at || bulkCallData.createdAt
        );
      }

      if (existing) {
        // Update existing record
        const wasCompleted = existing.status === "completed";
        const previousStatusLower = existing.status
          ? existing.status.toLowerCase()
          : "";

        // Use upsert-like behavior: update all fields
        Object.assign(existing, mappedData);

        // Mark nested objects and arrays as modified for proper upsert
        existing.markModified("progress");
        existing.markModified("cachedAt");
        if (mappedData.phoneNumbers) {
          existing.markModified("phoneNumbers");
        }
        if (mappedData.metadata) {
          existing.markModified("metadata");
        }

        if (shouldCache) {
          existing.cachedAt = cachedTimestamp;
        } else {
          existing.cachedAt = undefined;
        }

        // Special handling for paused campaigns that resumed
        if (isPausedResumed) {
          existing.lastSynced = new Date();
          existing.syncStatus = "synced";
          existing.updatedAt = new Date();
   
        } else if (
          previousStatusLower === "paused" &&
          statusLower &&
          statusLower !== "paused"
        ) {
          existing.lastSynced = new Date();
          existing.syncStatus = "synced";
          existing.updatedAt = new Date();
        }

        await existing.save();

        // Create activity log for status change to completed
        if (!wasCompleted && existing.status === "completed") {
          await createActivityLogsForBulkCall(existing, userId);
        }

        updatedCount++;
        syncedCount++;
      } else {
        // Create new record only if shouldCache is true
        if (shouldCache) {
          const newBulkCall = new BulkCall({
            userId,
            ...mappedData,
            syncedAt: new Date(),
          });
          await newBulkCall.save();
          createdCount++;
          syncedCount++;

          // Create initial activity log
          await createActivityLogsForBulkCall(newBulkCall, userId);

          // Broadcast to connected clients
          if (global.io) {
            const populatedBulkCall = await BulkCall.findById(newBulkCall._id)
              .populate("bot", "name description")
              .populate("phoneNumberId", "number label");
            global.io.emit("bulk_call_created", populatedBulkCall);
          }
        } else {
       
        }
      }
    } catch (error) {
      const bulkCallData = omniBulkCall.details || omniBulkCall;
    }
  }

  return { syncedCount, createdCount, updatedCount };
}

// Helper function to sync call lines from contact_list
async function syncCallLinesFromOmnidimension(contactList, bulkCallId, userId) {
  if (!Array.isArray(contactList)) {
    return { syncedCount: 0 };
  }

  // Get bulk call once to get fromNumber (optimization)
  const bulkCall = await BulkCall.findById(bulkCallId);
  const fromNumber = bulkCall?.fromNumber;
  const existingPhoneNumbers = Array.isArray(bulkCall?.phoneNumbers)
    ? bulkCall.phoneNumbers
    : [];
  const phoneNumbersSet = new Set(existingPhoneNumbers);

  let syncedCount = 0;


  for (const contact of contactList) {
    try {
      const toNumber =
        contact.to_number || contact.phone_number || contact.number;
      if (!toNumber) {
        continue;
      }

      // Try to find matching call log
      const callLog = await CallLog.findOne({
        phoneNumber: toNumber,
        userId,
      }).sort({ createdAt: -1 });

      const existing = await BulkCallLine.findOne({
        bulkCallId,
        toNumber,
      });

      // Parse call date - try multiple sources and formats
      let callDate = new Date();
      if (callLog?.createdAt) {
        callDate = callLog.createdAt;
      } else if (contact.call_date) {
        const parsedDate = new Date(contact.call_date);
        // Check if date is valid
        if (!isNaN(parsedDate.getTime())) {
          callDate = parsedDate;
        }
      } else if (contact.created_at) {
        const parsedDate = new Date(contact.created_at);
        if (!isNaN(parsedDate.getTime())) {
          callDate = parsedDate;
        }
      }

      // Check if recording URL exists
      let recordingUrl = callLog?.recordingUrl || contact.recording_url;
      let recordingAvailable = !!recordingUrl;

      // If no recording URL, try to fetch from Exotel
      if (!recordingUrl && toNumber) {
        try {
          // Fetch recording from Exotel
          const exotelRecordingUrl = await getCallRecording(
            toNumber,
            fromNumber,
            callDate
          );
          if (exotelRecordingUrl) {
            recordingUrl = exotelRecordingUrl;
            recordingAvailable = true;
          }
        } catch (exotelError) {
          // Continue without recording if Exotel fetch fails
        }
      }

      const lineData = {
        toNumber,
        callDate: callDate,
        callStatus: callLog?.status || contact.call_status || "pending",
        interaction: callLog
          ? callLog.transcript
            ? "completed"
            : "low_interaction"
          : contact.interaction || "no_interaction",
        duration: callLog?.duration || contact.duration || 0,
        recording: {
          available: recordingAvailable,
          url: recordingUrl || undefined,
        },
        metadata: {
          p50Latency: contact.p50_latency || 0,
          p99Latency: contact.p99_latency || 0,
          cqsScore: callLog?.cqsScore || contact.cqs_score || 0,
        },
        lastSynced: new Date(),
        syncStatus: "synced",
      };

      if (existing) {
        Object.assign(existing, lineData);
        await existing.save();
      } else {
        const newLine = new BulkCallLine({
          bulkCallId,
          ...lineData,
          syncedAt: new Date(),
        });
        await newLine.save();
      }
      syncedCount++;
      phoneNumbersSet.add(toNumber);
  
    } catch (error) {
    }
  }
  const updatedPhoneNumbers = Array.from(phoneNumbersSet);
  if (bulkCall && updatedPhoneNumbers.length > 0) {
    const numbersChanged =
      updatedPhoneNumbers.length !== existingPhoneNumbers.length ||
      updatedPhoneNumbers.some((num) => !existingPhoneNumbers.includes(num));

    if (numbersChanged) {
      try {
        // Update the phoneNumbers array directly
        await BulkCall.updateOne(
          { _id: bulkCall._id },
          {
            $set: {
              phoneNumbers: updatedPhoneNumbers,
            },
          }
        );

      } catch (updateError) {
      }
    } else {
   
    }
  } else {
  }
  return { syncedCount };
}

// Helper function to create activity logs from bulk call data
async function createActivityLogsForBulkCall(bulkCall, userId) {
  try {
    // Create "Created" log if not exists
    const existingCreated = await BulkCallActivityLog.findOne({
      bulkCallId: bulkCall._id,
      activityType: "created",
    });

    if (!existingCreated && bulkCall.createdAt) {
      await BulkCallActivityLog.create({
        bulkCallId: bulkCall._id,
        activityType: "created",
        initiatedBy: {
          type:
            bulkCall.createdBy && bulkCall.createdBy !== "System"
              ? "user"
              : "system",
          userName: bulkCall.createdBy || "System",
        },
        description: `Bulk call "${bulkCall.name}" created with ${
          bulkCall.totalCalls || 0
        } contacts`,
      });
    }

    // Create "Completed" log if status is completed and not exists
    if (bulkCall.status === "completed") {
      const existingCompleted = await BulkCallActivityLog.findOne({
        bulkCallId: bulkCall._id,
        activityType: "completed",
      });

      if (!existingCompleted) {
        await BulkCallActivityLog.create({
          bulkCallId: bulkCall._id,
          activityType: "completed",
          initiatedBy: {
            type: "system",
            userName: "System",
          },
          description: `Bulk call "${bulkCall.name}" completed`,
        });
      }
    }
  } catch (error) {
  }
}

// Get all bulk calls with filters and pagination
// GET /api/v1/calls/bulk_call?pageno=1&pagesize=10&status=completed
exports.getBulkCalls = async (req, res) => {
  try {
    const userId = await getUserIdObjectId(req.user.id);
    const { pageno = 1, pagesize = 10, status } = req.query;

    const requestedStatusLower = (status || "").toLowerCase();
    let needLiveSync = true;

    if (requestedStatusLower) {
      if (
        requestedStatusLower === "paused" ||
        requestedStatusLower === "pause" ||
        !ADMIN_CACHE_EXCLUDED_STATUSES.includes(requestedStatusLower)
      ) {
        needLiveSync = false;
      }
    } else {
      // No status filter – only hit OMNIDIM if we have any live (active) campaigns locally
      const hasActiveCampaigns = await BulkCall.exists({
        status: "active",
      });
      needLiveSync = !!hasActiveCampaigns;
    }

    // Auto-sync from OMNIDIMENSION first (background, don't wait)
    if (!needLiveSync) {
    } else {
      try {
        const syncParams = {
          pageno: 1,
          pagesize: 100, // Fetch more to ensure we get all campaigns
        };

        // Add filters to sync if provided
        if (status) syncParams.status = status;

        const response = await fetchFromOmnidimension(
          "calls/bulk_call",
          "GET",
          syncParams
        );

        // Handle different response formats
        // Omni API returns: { status: "success", records: [...] }
        let omniBulkCalls = [];
        if (Array.isArray(response)) {
          omniBulkCalls = response;
        } else if (response?.records && Array.isArray(response.records)) {
          // Omni API actual format - { status: "success", records: [...] }
          omniBulkCalls = response.records;
        } else if (response?.data && Array.isArray(response.data)) {
          omniBulkCalls = response.data;
        } else if (response?.bulk_calls && Array.isArray(response.bulk_calls)) {
          omniBulkCalls = response.bulk_calls;
        } else if (response?.campaigns && Array.isArray(response.campaigns)) {
          omniBulkCalls = response.campaigns;
        } else if (response?.results && Array.isArray(response.results)) {
          omniBulkCalls = response.results;
        } else {
        }

        if (omniBulkCalls.length > 0) {
          // Sync in background without blocking
          syncBulkCallsFromOmnidimension(omniBulkCalls, userId).catch((err) => {
          });
        }
      } catch (apiError) {
        // Continue even if API fails - just use local data
      }
    }

    // Build query
    const query = {};

    // Allow optional filtering by userId via query params
    if (req.query.userId) {
      try {
        query.userId = await getUserIdObjectId(req.query.userId);
      } catch (parseError) {
      }
    }

    // Add filters
    if (status) {
      query.status = status;
    }

    const skip = (parseInt(pageno) - 1) * parseInt(pagesize);
    const limit = parseInt(pagesize);

    // Get bulk calls with populated bot and phone number
    const bulkCalls = await BulkCall.find(query)
      .populate("bot", "name description")
      .populate("phoneNumberId", "number label")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const fromNumbers = bulkCalls
      .map((call) => call.fromNumber)
      .filter((num) => typeof num === "string" && num.trim().length > 0);

    const numberToName = {};
    if (fromNumbers.length > 0) {
      const users = await User.find({
        exotelNumbers: { $in: fromNumbers },
      }).select("name exotelNumbers");

      users.forEach((user) => {
        (user.exotelNumbers || []).forEach((number) => {
          if (number) {
            numberToName[number] = user.name;
          }
        });
      });
    }

    const enhancedBulkCalls = bulkCalls.map((call) => ({
      ...call,
      createdByName: numberToName[call.fromNumber] || null,
    }));

    const total = await BulkCall.countDocuments(query);

    res.json({
      success: true,
      data: enhancedBulkCalls,
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

// Get single bulk call with details
// GET /api/v1/calls/bulk_call/:id
exports.getBulkCall = async (req, res) => {
  try {
    const adminUserId = await getUserIdObjectId(req.user.id);
    const { id } = req.params;

    // Determine the owning user if we already have the campaign locally
    let existingLocal = await BulkCall.findOne({
      omnidimensionId: id.toString(),
    });
    const ownerUserId = existingLocal?.userId || adminUserId;

    // Try to fetch from Omni API first for latest data
    try {
      const response = await fetchFromOmnidimension(
        `calls/bulk_call/${id}`,
        "GET"
      );

      if (response) {
        // Omni API returns { status: 'success', details: {...}, contact_list: [...] } for single call
        // Or it might return the object directly
        const omniBulkCall = response.details || response;
        const omniBulkCalls = Array.isArray(omniBulkCall)
          ? omniBulkCall
          : [omniBulkCall];
        const syncedCampaign = await syncBulkCallsFromOmnidimension(
          omniBulkCalls,
          ownerUserId
        );

        // Sync call lines from contact_list if available
        if (response.contact_list && Array.isArray(response.contact_list)) {
          const bulkCall = await BulkCall.findOne({
            omnidimensionId: id.toString(),
          });
          if (bulkCall) {
            // Skip call line sync for cached statuses (non-active campaigns)
            const statusLower = bulkCall.status
              ? bulkCall.status.toLowerCase()
              : "";
            const shouldSkipCallLineSync =
              statusLower &&
              !ADMIN_CACHE_EXCLUDED_STATUSES.includes(statusLower);

            if (shouldSkipCallLineSync) {
         
            } else {
              await syncCallLinesFromOmnidimension(
                response.contact_list,
                bulkCall._id,
                bulkCall.userId
              ).catch((err) => {
              });
            }
          }
        }
      }
    } catch (apiError) {
    }

    // Get from local database
    // Note: id param from URL is Omni API ID (e.g., "1028"), not MongoDB ObjectId
    // So we only query by omnidimensionId, not _id
    const bulkCall = await BulkCall.findOne({
      omnidimensionId: id.toString(),
    })
      .populate("bot", "name description")
      .populate("phoneNumberId", "number label")
      .lean();

    if (bulkCall && bulkCall.fromNumber) {
      const creator = await User.findOne({
        exotelNumbers: bulkCall.fromNumber,
      }).select("name");
      bulkCall.createdByName = creator?.name || null;
    }

    if (!bulkCall) {
      return res.status(404).json({
        success: false,
        message: "Bulk call campaign not found",
      });
    }

    // Ensure activity logs exist
    await createActivityLogsForBulkCall(bulkCall, bulkCall.userId);

    res.json({
      success: true,
      data: bulkCall,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Get call lines for a bulk call campaign
// GET /api/v1/calls/bulk_call/:id/lines
exports.getBulkCallLines = async (req, res) => {
  try {
    const adminUserId = await getUserIdObjectId(req.user.id);
    const { id } = req.params;
    const { pageno = 1, pagesize = 50, call_status, interaction } = req.query;

    const currentPage = parseInt(pageno, 10) || 1;
    const pageSizeNumber = parseInt(pagesize, 10) || 50;

    // Find bulk call
    const bulkCall = await BulkCall.findOne({
      omnidimensionId: id.toString(),
    });

    if (!bulkCall) {
      return res.status(404).json({
        success: false,
        message: "Bulk call campaign not found",
      });
    }

    const ownerUserId = bulkCall.userId || adminUserId;

    if (currentPage === 1) {
      try {
        const syncSummary = await syncBulkCallLinesFromLogs({
          campaignId: id,
          bulkCall,
          pageSize: pageSizeNumber,
          maxPages: currentPage
        });

        if (syncSummary?.matched) {
          console.log(
            `🔄 Synced ${syncSummary.upserted} new / ${syncSummary.updated} updated call lines for campaign ${id} from logs.`
          );
        }
      } catch (syncError) {
        console.error(
          `⚠️  Failed to sync call lines from logs for campaign ${id}:`,
          syncError.message
        );
      }
    }

    // Build query
    const query = { bulkCallId: bulkCall._id };

    if (call_status) {
      query.callStatus = call_status;
    }

    if (interaction) {
      query.interaction = interaction;
    }

    const skip = (currentPage - 1) * pageSizeNumber;
    const limit = pageSizeNumber;

    const callLines = await BulkCallLine.find(query)
      .sort({ callDate: -1 })
      .skip(skip)
      .limit(limit);

    const total = await BulkCallLine.countDocuments(query);

    res.json({
      success: true,
      data: callLines,
      pagination: {
        pageno: currentPage,
        pagesize: pageSizeNumber,
        total,
        pages: Math.ceil(total / pageSizeNumber),
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

// Get activity logs for a bulk call campaign
// GET /api/v1/calls/bulk_call/:id/logs
exports.getBulkCallLogs = async (req, res) => {
  try {
    const userId = await getUserIdObjectId(req.user.id);
    const { id } = req.params;

    // Find bulk call
    const bulkCall = await BulkCall.findOne({
      omnidimensionId: id.toString(),
      userId,
    });

    if (!bulkCall) {
      return res.status(404).json({
        success: false,
        message: "Bulk call campaign not found",
      });
    }

    // Ensure logs exist
    await createActivityLogsForBulkCall(bulkCall, userId);

    // Get activity logs
    const logs = await BulkCallActivityLog.find({
      bulkCallId: bulkCall._id,
    }).sort({ createdAt: -1 });

    res.json({
      success: true,
      data: logs,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Get analytics data for a bulk call campaign
// GET /api/v1/calls/bulk_call/:id/analytics
exports.getBulkCallAnalytics = async (req, res) => {
  try {
    const adminUserId = await getUserIdObjectId(req.user.id);
    const { id } = req.params;

    // Find bulk call
    const bulkCall = await BulkCall.findOne({
      omnidimensionId: id.toString(),
    });

    if (!bulkCall) {
      return res.status(404).json({
        success: false,
        message: "Bulk call campaign not found",
      });
    }

    const ownerUserId = bulkCall.userId || adminUserId;

    // Get call lines for analytics
    const callLines = await BulkCallLine.find({
      bulkCallId: bulkCall._id,
    });

    // Helper to clean undefined keys
    const cleanDistribution = (distribution = {}) => {
      return Object.entries(distribution).reduce((acc, [key, value]) => {
        if (!key || value === undefined || value === null) {
          return acc;
        }
        acc[key] = value;
        return acc;
      }, {});
    };

    // Calculate call status distribution
    let statusDistribution = {};
    callLines.forEach((line) => {
      const statusKey = line.callStatus || "pending";
      statusDistribution[statusKey] = (statusDistribution[statusKey] || 0) + 1;
    });
    statusDistribution = cleanDistribution(statusDistribution);

    // Calculate interaction distribution
    let interactionDistribution = {};
    callLines.forEach((line) => {
      const interactionKey = line.interaction || "no_interaction";
      interactionDistribution[interactionKey] =
        (interactionDistribution[interactionKey] || 0) + 1;
    });
    interactionDistribution = cleanDistribution(interactionDistribution);

    // Fallback distributions from bulk call summary if call lines are missing
    const fallbackTotal =
      bulkCall.totalCalls || bulkCall.progress?.total || callLines.length || 0;
    const fallbackCompleted =
      bulkCall.completedCalls || bulkCall.progress?.completed || 0;
    const fallbackFailed = bulkCall.failedCalls || 0;
    const fallbackBusy = bulkCall.busyCalls || 0;
    const fallbackNoAnswer = bulkCall.noAnswerCalls || 0;
    const fallbackCancelled =
      bulkCall.status === "cancelled" ? fallbackTotal : 0;
    const fallbackPending = Math.max(
      0,
      fallbackTotal -
        (fallbackCompleted +
          fallbackFailed +
          fallbackBusy +
          fallbackNoAnswer +
          fallbackCancelled)
    );

    if (Object.keys(statusDistribution).length === 0) {
      statusDistribution = cleanDistribution({
        completed: fallbackCompleted,
        failed: fallbackFailed,
        busy: fallbackBusy,
        "no-answer": fallbackNoAnswer,
        cancelled: fallbackCancelled,
        pending: fallbackPending,
      });
    }

    if (Object.keys(interactionDistribution).length === 0) {
      interactionDistribution = cleanDistribution({
        completed: fallbackCompleted,
        no_interaction: bulkCall.noLowInteractionCalls || fallbackPending,
        transfer: bulkCall.transferCalls || 0,
        low_interaction: Math.max(
          0,
          (bulkCall.noLowInteractionCalls || 0) - (bulkCall.transferCalls || 0)
        ),
      });
    }

    // Calculate response time percentiles (p50, p99)
    const p50Latencies = callLines
      .map((line) => line.metadata?.p50Latency || 0)
      .filter((lat) => lat > 0)
      .sort((a, b) => a - b);

    const p99Latencies = callLines
      .map((line) => line.metadata?.p99Latency || 0)
      .filter((lat) => lat > 0)
      .sort((a, b) => a - b);

    const getPercentile = (arr, percentile) => {
      if (arr.length === 0) return 0;
      const index = Math.ceil((percentile / 100) * arr.length) - 1;
      return arr[Math.max(0, index)] || 0;
    };

    // Aggregate counters for frontend KPIs
    const getCount = (distribution, key) => {
      if (!distribution) return 0;
      if (distribution[key] === undefined || distribution[key] === null) {
        return 0;
      }
      return distribution[key];
    };

    const derivedCompleted =
      getCount(statusDistribution, "completed") ?? fallbackCompleted;
    const derivedPending =
      getCount(statusDistribution, "pending") ?? fallbackPending;
    const derivedFailed =
      getCount(statusDistribution, "failed") +
      getCount(statusDistribution, "cancelled") +
      getCount(statusDistribution, "no-answer") +
      getCount(statusDistribution, "busy");
    const totalCalls =
      callLines.length > 0
        ? callLines.length
        : fallbackTotal ||
          derivedCompleted + derivedPending + derivedFailed ||
          0;
    const pickupRate =
      totalCalls > 0 ? (derivedCompleted / totalCalls) * 100 : 0;

    const averageDuration =
      callLines.length > 0
        ? callLines.reduce((sum, line) => sum + (line.duration || 0), 0) /
          callLines.length
        : bulkCall.progress?.averageDuration || 0;

    const derivedP50Percentile = getPercentile(p50Latencies, 50);
    const fallbackP50 =
      derivedP50Percentile ||
      (averageDuration > 0 ? averageDuration * 1000 : 0); // convert seconds to ms
    const p50Values =
      p50Latencies.length > 0
        ? p50Latencies
        : fallbackP50 > 0
        ? [fallbackP50]
        : [];

    const derivedP99Percentile = getPercentile(p99Latencies, 99);
    const fallbackP99 =
      derivedP99Percentile ||
      (averageDuration > 0 ? averageDuration * 1000 : 0); // convert seconds to ms
    const p99Values =
      p99Latencies.length > 0
        ? p99Latencies
        : fallbackP99 > 0
        ? [fallbackP99]
        : [];

    res.json({
      success: true,
      data: {
        statusDistribution,
        interactionDistribution,
        p50Distribution: {
          values: p50Values,
          percentile: fallbackP50 || derivedP50Percentile,
        },
        p99Distribution: {
          values: p99Values,
          percentile: fallbackP99 || derivedP99Percentile,
        },
        totalCalls,
        completedCalls: derivedCompleted,
        pendingCalls: derivedPending,
        failedCalls: derivedFailed,
        averageDuration,
        pickupRate,
        totalCost: bulkCall.totalCost || 0,
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

// Enhance bulk call campaign data by fetching the latest details and call lines
exports.enhanceBulkCall = async (req, res) => {
  try {
    const adminUserId = await getUserIdObjectId(req.user.id);
    const { id } = req.params;

    const bulkCall = await BulkCall.findOne({
      omnidimensionId: id.toString(),
    });

    if (!bulkCall) {
      return res.status(404).json({
        success: false,
        message: "Bulk call campaign not found",
      });
    }

    const ownerUserId = bulkCall.userId || adminUserId;

    let contactList = [];
    try {
      const response = await fetchFromOmnidimension(
        `calls/bulk_call/${id}`,
        "GET"
      );

      const omniBulkCall = response?.details || response;
      const omniBulkCalls = Array.isArray(omniBulkCall)
        ? omniBulkCall
        : omniBulkCall
        ? [omniBulkCall]
        : [];

      if (omniBulkCalls.length > 0) {
        await syncBulkCallsFromOmnidimension(omniBulkCalls, ownerUserId);
      }

      const extractedContactList =
        response?.contact_list || omniBulkCall?.contact_list || [];
      if (Array.isArray(extractedContactList)) {
        contactList = extractedContactList;
      }
    } catch (syncError) {
    }

    let syncedLines = 0;
    if (Array.isArray(contactList) && contactList.length > 0) {
      // Skip call line sync for cached statuses (non-active campaigns)
      const statusLower = bulkCall.status ? bulkCall.status.toLowerCase() : "";
      const shouldSkipCallLineSync =
        statusLower && !ADMIN_CACHE_EXCLUDED_STATUSES.includes(statusLower);

      if (shouldSkipCallLineSync) {
     
   
      } else {
        try {
          const result = await syncCallLinesFromOmnidimension(
            contactList,
            bulkCall._id,
            ownerUserId
          );
          syncedLines = result.syncedCount;
        } catch (lineError) {
        }
      }
    }

    res.json({
      success: true,
      message: "Bulk call enhancement triggered",
      totalLines: Array.isArray(contactList) ? contactList.length : 0,
      syncedLines,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Fetch recordings from Exotel for a bulk call campaign
// POST /api/v1/calls/bulk_call/:id/fetch-recordings
exports.fetchRecordingsForBulkCall = async (req, res) => {
  try {
    const userId = await getUserIdObjectId(req.user.id);
    const { id } = req.params;
    const { force_refresh = false } = req.body;

    // Find bulk call
    const bulkCall = await BulkCall.findOne({
      omnidimensionId: id.toString(),
      userId,
    });

    if (!bulkCall) {
      return res.status(404).json({
        success: false,
        message: "Bulk call campaign not found",
      });
    }

    // Get all call lines for this bulk call
    const query = { bulkCallId: bulkCall._id };
    if (!force_refresh) {
      // Only fetch recordings for lines without recordings
      query.$or = [
        { "recording.available": { $ne: true } },
        { "recording.url": { $exists: false } },
        { "recording.url": null },
        { "recording.url": "" },
      ];
    }

    const callLines = await BulkCallLine.find(query);

    let fetched = 0;
    let failed = 0;
    let alreadyAvailable = 0;

    // Fetch recordings in batches to avoid rate limiting
    const batchSize = 5;
    for (let i = 0; i < callLines.length; i += batchSize) {
      const batch = callLines.slice(i, i + batchSize);

      await Promise.all(
        batch.map(async (line) => {
          try {
            // Skip if recording already available (unless force_refresh)
            if (
              !force_refresh &&
              line.recording?.available &&
              line.recording?.url
            ) {
              alreadyAvailable++;
              return;
            }

            // Fetch recording from Exotel
            const recordingUrl = await getCallRecording(
              line.toNumber,
              bulkCall.fromNumber,
              line.callDate || line.createdAt
            );

            if (recordingUrl) {
              line.recording = {
                available: true,
                url: recordingUrl,
              };
              line.lastSynced = new Date();
              await line.save();
              fetched++;
            } else {
              // Mark as unavailable if not found
              if (!line.recording) {
                line.recording = { available: false };
              } else {
                line.recording.available = false;
              }
              line.lastSynced = new Date();
              await line.save();
              failed++;
            }
          } catch (error) {
            failed++;
          }
        })
      );

      // Small delay between batches to avoid rate limiting
      if (i + batchSize < callLines.length) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    res.json({
      success: true,
      message: `Fetched recordings for ${fetched} call lines`,
      data: {
        fetched,
        failed,
        alreadyAvailable,
        total: callLines.length,
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

// Get recording for a bulk call line: GET /api/v1/calls/bulk_call/recording/:id
exports.getBulkCallLineRecording = async (req, res) => {
  try {
    const userId = await getUserIdObjectId(req.user.id);
    const { id } = req.params;

    // Debug: Log what we're receiving

    const callLine = await BulkCallLine.findOne({
      _id: id,
    }).populate("bulkCallId");

    if (!callLine) {
      return res.status(404).json({
        success: false,
        message: "Call line not found",
      });
    }

    // Check if bulk call belongs to user
    if (
      callLine.bulkCallId &&
      callLine.bulkCallId.userId &&
      callLine.bulkCallId.userId.toString() !== userId.toString()
    ) {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      });
    }

    const recordingUrl = callLine.recording?.url || callLine.recordingUrl;

    if (!recordingUrl) {
      return res.status(404).json({
        success: false,
        message: "Recording not available for this call line",
      });
    }

    // Debug: Log recording URL

    // Proxy the Exotel recording with authentication
    const axios = require("axios");
    const config = require("../config/env.js");

    if (!config.exotel.apiKey || !config.exotel.apiToken) {
      return res.status(500).json({
        success: false,
        message: "Exotel credentials not configured",
      });
    }

    // Create authenticated request to Exotel
    const auth = Buffer.from(
      `${config.exotel.apiKey}:${config.exotel.apiToken}`
    ).toString("base64");

    try {
      const response = await axios.get(recordingUrl, {
        headers: {
          Authorization: `Basic ${auth}`,
        },
        responseType: "stream",
      });

      // Set appropriate headers for audio streaming with CORS
      res.setHeader(
        "Content-Type",
        response.headers["content-type"] || "audio/mpeg"
      );
      res.setHeader("Content-Length", response.headers["content-length"]);
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Authorization, Content-Type"
      );

      // Stream the audio to the client
      response.data.pipe(res);
    } catch (proxyError) {
      res.status(500).json({
        success: false,
        message: "Failed to fetch recording from Exotel",
        error: proxyError.message,
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Download recording as MP3: GET /api/v1/calls/bulk_call/recording/:id/download
exports.downloadBulkCallLineRecording = async (req, res) => {
  try {
    const userId = await getUserIdObjectId(req.user.id);
    const { id } = req.params;

    const callLine = await BulkCallLine.findOne({
      _id: id,
    }).populate("bulkCallId");

    if (!callLine) {
      return res.status(404).json({
        success: false,
        message: "Call line not found",
      });
    }

    // Check if bulk call belongs to user
    if (
      callLine.bulkCallId &&
      callLine.bulkCallId.userId &&
      callLine.bulkCallId.userId.toString() !== userId.toString()
    ) {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      });
    }

    const recordingUrl = callLine.recording?.url || callLine.recordingUrl;

    if (!recordingUrl) {
      return res.status(404).json({
        success: false,
        message: "Recording not available for this call line",
      });
    }

    // Proxy the Exotel recording with authentication
    const axios = require("axios");
    const config = require("../config/env.js");

    if (!config.exotel.apiKey || !config.exotel.apiToken) {
      return res.status(500).json({
        success: false,
        message: "Exotel credentials not configured",
      });
    }

    // Create authenticated request to Exotel
    const auth = Buffer.from(
      `${config.exotel.apiKey}:${config.exotel.apiToken}`
    ).toString("base64");

    try {
      const response = await axios.get(recordingUrl, {
        headers: {
          Authorization: `Basic ${auth}`,
        },
        responseType: "stream",
      });

      // Generate filename from call line details
      const timestamp = callLine.callDate
        ? new Date(callLine.callDate).toISOString().replace(/[:.]/g, "-")
        : new Date().toISOString().replace(/[:.]/g, "-");
      const filename = `recording-${
        callLine.toNumber || "unknown"
      }-${timestamp}.mp3`;

      // Set headers for download with CORS
      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"`
      );
      res.setHeader("Content-Length", response.headers["content-length"]);
      res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Authorization, Content-Type"
      );

      // Stream the audio to the client
      response.data.pipe(res);
    } catch (proxyError) {
      res.status(500).json({
        success: false,
        message: "Failed to download recording from Exotel",
        error: proxyError.message,
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};
