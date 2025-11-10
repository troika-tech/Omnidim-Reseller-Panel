const CallLog = require("../models/CallLog");
const VoiceAssistant = require("../models/VoiceAssistant");
const BulkCall = require("../models/BulkCall");
const BulkCallLine = require("../models/BulkCallLine");
const mongoose = require("mongoose");
const { normalizePhoneNumber } = require("../utils/phone");
const {
  syncToOmnidimension,
  fetchFromOmnidimension,
} = require("../services/omniApi.js");

const adminCallLogSyncState = new Map();
const ADMIN_SYNC_COOLDOWN_MS = 60 * 1000;
const ADMIN_MAX_BACKGROUND_PAGES = 50;
const ADMIN_DEFAULT_OMNI_PAGE_SIZE = 100;

// Helper function to convert userId string to ObjectId
function toObjectId(userId) {
  if (!userId) return null;
  if (userId instanceof mongoose.Types.ObjectId) {
    return userId;
  }
  if (mongoose.Types.ObjectId.isValid(userId)) {
    return new mongoose.Types.ObjectId(userId);
  }
  return null;
}

// Helper function to ensure we have a valid userId ObjectId
async function getUserIdObjectId(userId) {
  if (!userId) {
    const User = require("../models/User");
    let adminUser = await User.findOne({ role: "admin" });
    if (!adminUser) {
      adminUser = await User.create({
        email: "admin@example.com",
        role: "admin",
      });
    }
    return adminUser._id;
  }
  return toObjectId(userId);
}

// Helper function to parse duration from various formats
function parseDuration(duration) {
  if (!duration) return 0;

  // If it's already a number, return it
  if (typeof duration === "number") return duration;

  // If it's a string, try to parse it
  if (typeof duration === "string") {
    // Handle formats like "0:8", "0:16", "00:21", "1:30", etc.
    const timeMatch = duration.match(/^(\d+):(\d+)$/);
    if (timeMatch) {
      const minutes = parseInt(timeMatch[1], 10);
      const seconds = parseInt(timeMatch[2], 10);
      return minutes * 60 + seconds;
    }

    // Handle pure number strings
    const numberMatch = duration.match(/^\d+$/);
    if (numberMatch) {
      return parseInt(duration, 10);
    }

    // Handle formats like "0:0" which should be 0
    if (duration === "0:0") return 0;
  }

  // Default to 0 if we can't parse it
  console.warn(`⚠️  Could not parse duration: ${duration}, defaulting to 0`);
  return 0;
}

function parseOmniResponse(response) {
  let omniCallLogs = [];
  let totalRecords = null;

  if (Array.isArray(response)) {
    omniCallLogs = response;
    totalRecords = omniCallLogs.length;
  } else if (response?.call_log_data && Array.isArray(response.call_log_data)) {
    omniCallLogs = response.call_log_data;
    totalRecords =
      response.total_records || response.total || omniCallLogs.length;
  } else if (response?.data && Array.isArray(response.data)) {
    omniCallLogs = response.data;
    totalRecords =
      response.total ||
      response.count ||
      response.total_records ||
      omniCallLogs.length;
  } else if (response?.call_logs && Array.isArray(response.call_logs)) {
    omniCallLogs = response.call_logs;
    totalRecords = response.total || omniCallLogs.length;
  } else if (response?.logs && Array.isArray(response.logs)) {
    omniCallLogs = response.logs;
    totalRecords = response.total || omniCallLogs.length;
  } else if (response?.results && Array.isArray(response.results)) {
    omniCallLogs = response.results;
    totalRecords = response.total || omniCallLogs.length;
  } else {
    console.error("⚠️  Unexpected Omni API response format:", response);
  }

  return { omniCallLogs, totalRecords };
}

function normalizeDisplayValue(value, options = {}) {
  if (value === undefined || value === null) return null;

  if (typeof value === "string" || typeof value === "number") {
    return value.toString();
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    return value.map((item) => normalizeDisplayValue(item, options)).join(", ");
  }

  if (typeof value === "object") {
    if (typeof value.id === "string" || typeof value.id === "number") {
      return value.id.toString();
    }
    if (typeof value.name === "string") {
      return value.name;
    }
    if (options.preferredKeys) {
      for (const key of options.preferredKeys) {
        if (value[key]) {
          return normalizeDisplayValue(value[key], options);
        }
      }
    }
    try {
      return JSON.stringify(value);
    } catch (_ignored) {
      return String(value);
    }
  }

  return String(value);
}

// Helper function to find campaign name for a call log
async function findCampaignNameForCallLog(callLog) {
  try {
    // Method 1: Direct campaign name from call log
    if (callLog.campaignName) {
      return callLog.campaignName;
    }

    // Method 2: Try to find campaign through call_request_id
    const callRequestId = callLog.call_request_id?.id || callLog.call_request_id;
    if (callRequestId) {
      // Look for bulk call line with matching omnidimensionCallId
      const bulkCallLine = await BulkCallLine.findOne({
        omnidimensionCallId: callRequestId.toString()
      }).populate('bulkCallId');

      if (bulkCallLine && bulkCallLine.bulkCallId) {
        return bulkCallLine.bulkCallId.name;
      }
    }

    // Method 3: Try to find campaign through phone number and agent matching
    const toNumber = callLog.toNumber || callLog.phoneNumber;
    const agentId = callLog.agentUsed?._id || callLog.agentUsed;
    
    if (toNumber && agentId) {
      // Find bulk campaigns that have this phone number and same agent
      const bulkCampaigns = await BulkCall.find({
        phoneNumbers: toNumber,
        bot: agentId
      }).sort({ createdAt: -1 }).limit(1);

      if (bulkCampaigns.length > 0) {
        return bulkCampaigns[0].name;
      }

      // Try without agent matching (fallback)
      const bulkCampaignsNoAgent = await BulkCall.find({
        phoneNumbers: toNumber
      }).sort({ createdAt: -1 }).limit(1);

      if (bulkCampaignsNoAgent.length > 0) {
        return bulkCampaignsNoAgent[0].name;
      }
    }

    // Method 4: Check if it's an incoming call (source different from system numbers)
    const systemNumbers = ["+917948516111"]; // Add your system numbers here
    const source = callLog.source;
    
    if (source && !systemNumbers.includes(source)) {
      return "Incoming Call";
    }

    // Default fallback
    return "Incoming Call";
  } catch (error) {
    console.error("Error finding campaign name:", error);
    return "Incoming Call";
  }
}

async function performAdminBackgroundSync({ userId, filters }) {
  try {
    let currentPage = 1;
    let totalFetched = 0;
    let totalSynced = 0;

    while (currentPage <= ADMIN_MAX_BACKGROUND_PAGES) {
      const omniParams = {
        pageno: currentPage,
        pagesize: ADMIN_DEFAULT_OMNI_PAGE_SIZE,
      };

      if (filters?.agentid) omniParams.agentid = filters.agentid;
      if (filters?.call_status) omniParams.call_status = filters.call_status;
      if (filters?.phone_number) omniParams.phone_number = filters.phone_number;
      if (filters?.start_date) omniParams.start_date = filters.start_date;
      if (filters?.end_date) omniParams.end_date = filters.end_date;

      console.log(
        `📡 Admin background sync: fetching page ${currentPage}`,
        omniParams
      );

      const response = await fetchFromOmnidimension(
        "calls/logs",
        "GET",
        omniParams
      );

      const { omniCallLogs } = parseOmniResponse(response);
      totalFetched += omniCallLogs.length;

      if (!omniCallLogs.length) {
        console.log(
          `📡 Admin background sync: page ${currentPage} empty, stopping (fetched=${totalFetched})`
        );
        break;
      }

      const syncResult = await syncCallLogsFromOmnidimension(
        omniCallLogs,
        userId
      );
      totalSynced += syncResult.syncedCount;
      console.log(
        `📡 Admin background sync: page ${currentPage} synced ${syncResult.syncedCount} logs (total=${totalSynced})`
      );

      if (omniCallLogs.length < ADMIN_DEFAULT_OMNI_PAGE_SIZE) {
        console.log(
          `📡 Admin background sync: reached final page (page size < ${ADMIN_DEFAULT_OMNI_PAGE_SIZE})`
        );
        break;
      }

      currentPage++;
    }

    return {
      totalFetched,
      totalSynced,
      pagesProcessed: currentPage,
    };
  } catch (error) {
    console.error("❌ Admin background call log sync failed:", error.message);
    throw error;
  }
}

function triggerAdminBackgroundSync({ userId, filters }) {
  const key = "admin";
  const existingState = adminCallLogSyncState.get(key);
  const now = Date.now();

  if (existingState?.inProgress) {
    return existingState.promise;
  }

  if (
    existingState?.lastRun &&
    now - existingState.lastRun < ADMIN_SYNC_COOLDOWN_MS
  ) {
    return existingState.promise;
  }

  const syncPromise = (async () => {
    try {
      const result = await performAdminBackgroundSync({ userId, filters });
      adminCallLogSyncState.set(key, {
        inProgress: false,
        lastRun: Date.now(),
        lastError: null,
        lastResult: result,
        promise: null,
      });
      return result;
    } catch (error) {
      adminCallLogSyncState.set(key, {
        inProgress: false,
        lastRun: Date.now(),
        lastError: error.message,
        lastResult: null,
        promise: null,
      });
      throw error;
    }
  })();

  adminCallLogSyncState.set(key, {
    inProgress: true,
    lastRun: existingState?.lastRun || null,
    lastError: existingState?.lastError || null,
    lastResult: existingState?.lastResult || null,
    promise: syncPromise,
  });

  syncPromise.catch(() => {});
  return syncPromise;
}

// Helper function to find campaign information for call logs
async function enrichCallLogsWithCampaignInfo(callLogs) {
  const enrichedCallLogs = [];

  for (const callLog of callLogs) {
    const enrichedCallLog = callLog.toObject();

    // Initialize campaign fields
    enrichedCallLog.campaignId = null;
    enrichedCallLog.campaignName = null;
    enrichedCallLog.campaignSource = null;

    // Only use call_request_id method - most reliable source
    if (callLog.call_request_id?.id) {
      enrichedCallLog.campaignId = callLog.call_request_id.id;
      enrichedCallLog.campaignSource = "call_request_id";

      // Use campaign ID to fetch campaign name from BulkCall
      try {
        const bulkCall = await BulkCall.findOne({
          omnidimensionId: enrichedCallLog.campaignId,
        });

        if (bulkCall) {
          enrichedCallLog.campaignName = bulkCall.name;
        } else {
          // Fallback to bot_name if available
          enrichedCallLog.campaignName = callLog.bot_name || `Campaign ${enrichedCallLog.campaignId}`;
        }
      } catch (error) {
        console.error(`Error finding campaign name for ID ${enrichedCallLog.campaignId}:`, error.message);
        enrichedCallLog.campaignName = callLog.bot_name || `Campaign ${enrichedCallLog.campaignId}`;
      }

    } else {
    }

    enrichedCallLogs.push(enrichedCallLog);
  }

  return enrichedCallLogs;
}

// Helper function to sync call logs from OMNIDIMENSION to local database
async function syncCallLogsFromOmnidimension(omniCallLogs, userId) {
  let syncedCount = 0;
  let createdCount = 0;
  let updatedCount = 0;

  if (!Array.isArray(omniCallLogs)) {
    console.error("⚠️  Omni call logs is not an array:", omniCallLogs);
    return { syncedCount: 0, createdCount: 0, updatedCount: 0 };
  }

  for (const omniCallLog of omniCallLogs) {
    try {
      // Debug: Log only first couple of call logs to understand the format
      if (syncedCount < 2) {
        console.log(
          "🔍 Processing Omni call log:",
          JSON.stringify(omniCallLog, null, 2)
        );
      }

      // Skip if essential fields are missing
      if (!omniCallLog.id && !omniCallLog.call_log_id && !omniCallLog.call_id) {
        console.error("⚠️  Skipping call log: missing id", omniCallLog);
        continue;
      }

      const omniId = (
        omniCallLog.id ||
        omniCallLog.call_log_id ||
        omniCallLog.call_id
      ).toString();
      // Omni API uses to_number (the number being called) as primary, with from_number as caller
      const toNumber =
        omniCallLog.to_number ||
        omniCallLog.toNumber ||
        omniCallLog.dialed_number ||
        omniCallLog.phoneNumberTo ||
        omniCallLog.phoneTo ||
        omniCallLog.phone_number_to;

      const phoneNumber =
        omniCallLog.from_number ||
        omniCallLog.phone_number ||
        omniCallLog.phoneNumber ||
        omniCallLog.phone ||
        omniCallLog.to_number ||
        omniCallLog.toNumber;

      if (!phoneNumber && !toNumber) {
        console.error(
          "⚠️  Skipping call log: missing phone number",
          omniCallLog
        );
        continue;
      }

      // Find existing call log by omnidimensionId
      const existing = await CallLog.findOne({
        omnidimensionId: omniId,
      });

      // Map OMNIDIMENSION API fields to our schema
      // Omni API fields: from_number, to_number, call_duration_in_seconds, call_status, cqs_score, call_cost, recording_url, call_conversation, bot_name, time_of_call, call_request_id
      const mappedData = {
        omnidimensionId: omniId,
        source:
          omniCallLog.source ||
          omniCallLog.from_number ||
          omniCallLog.to_number ||
          "unknown",
        phoneNumber: phoneNumber || "",
        toNumber: toNumber || phoneNumber || null,
        duration: parseDuration(
          omniCallLog.call_duration_in_seconds ||
            omniCallLog.duration ||
            omniCallLog.call_duration
        ),
        callType:
          omniCallLog.call_type ||
          omniCallLog.callType ||
          omniCallLog.channel_type ||
          (omniCallLog.direction === "inbound" ? "Inbound" : "Outbound"),
        cqsScore:
          omniCallLog.cqs_score ||
          omniCallLog.cqsScore ||
          omniCallLog.quality_score ||
          0,
        status: omniCallLog.call_status || omniCallLog.status || "completed",
        cost:
          omniCallLog.call_cost || omniCallLog.cost || omniCallLog.amount || 0,
        recordingUrl:
          omniCallLog.recording_url && omniCallLog.recording_url !== false
            ? omniCallLog.recording_url
            : omniCallLog.recordingUrl || null,
        transcript:
          omniCallLog.call_conversation ||
          omniCallLog.transcript ||
          omniCallLog.transcription ||
          null,
        // Store call_request_id for campaign identification
        call_request_id: omniCallLog.call_request_id || null,
        // Store bot_name for campaign name fallback
        bot_name: omniCallLog.bot_name || null,
        lastSynced: new Date(),
        syncStatus: "synced",
      };

      mappedData.normalizedSource = normalizePhoneNumber(mappedData.source);
      mappedData.normalizedPhoneNumber = normalizePhoneNumber(mappedData.phoneNumber);

      // Try to extract campaign name from webhook payload if available
      if (
        omniCallLog.post_call_actions?.call_recording_webhook_ids?.length > 0
      ) {
        const webhook =
          omniCallLog.post_call_actions.call_recording_webhook_ids[0];
        if (webhook.payload) {
          try {
            const payloadData = JSON.parse(webhook.payload);
            if (payloadData.bulk_call_name) {
              mappedData.campaignName = payloadData.bulk_call_name;
            }
          } catch (e) {
            // Ignore JSON parse errors
          }
        }
      }

      // Handle agentUsed from Omni API
      // Omni API might return bot_name (string), bot_id, agent_id, active_bot_id, etc.
      // We need to find the agent by bot_name or by ID
      let agentId = null;
      if (
        omniCallLog.bot_id ||
        omniCallLog.agent_id ||
        omniCallLog.active_bot_id
      ) {
        const agentIdStr = (
          omniCallLog.bot_id ||
          omniCallLog.agent_id ||
          omniCallLog.active_bot_id
        ).toString();

        // Find voice assistant by omnidimensionId
        const agent = await VoiceAssistant.findOne({
          omnidimensionId: agentIdStr,
          userId,
        });
        if (agent) {
          mappedData.agentUsed = agent._id;
        }
      } else if (omniCallLog.bot_name) {
        // Try to find agent by name (bot_name field in Omni API)
        const agent = await VoiceAssistant.findOne({
          name: omniCallLog.bot_name,
          userId,
        });
        if (agent) {
          mappedData.agentUsed = agent._id;
        }
      }

      // Handle createdAt
      // Omni API uses time_of_call in format "11/01/2025 09:06:21"
      if (omniCallLog.time_of_call) {
        // Parse MM/DD/YYYY HH:MM:SS format
        const timeParts = omniCallLog.time_of_call.split(" ");
        if (timeParts.length === 2) {
          const dateParts = timeParts[0].split("/");
          const timeParts2 = timeParts[1].split(":");
          if (dateParts.length === 3 && timeParts2.length === 3) {
            // Month, Day, Year format
            const year = parseInt(dateParts[2]);
            const month = parseInt(dateParts[0]) - 1; // JavaScript months are 0-indexed
            const day = parseInt(dateParts[1]);
            const hours = parseInt(timeParts2[0]);
            const minutes = parseInt(timeParts2[1]);
            const seconds = parseInt(timeParts2[2]);
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
      } else if (
        omniCallLog.created_at ||
        omniCallLog.createdAt ||
        omniCallLog.timestamp
      ) {
        mappedData.createdAt = new Date(
          omniCallLog.created_at ||
            omniCallLog.createdAt ||
            omniCallLog.timestamp
        );
      }

      if (existing) {
        // Update existing
        Object.assign(existing, mappedData);
        await existing.save();
        updatedCount++;
        syncedCount++;
      } else {
        // Create new
        const newCallLog = new CallLog({
          userId,
          ...mappedData,
          syncedAt: new Date(),
        });
        await newCallLog.save();
        createdCount++;
        syncedCount++;

        // Broadcast to connected clients
        if (global.io) {
          const populatedCallLog = await CallLog.findById(
            newCallLog._id
          ).populate("agentUsed", "name description");
          global.io.emit("call_log_created", populatedCallLog);
        }
      }
    } catch (error) {
      console.error(
        `❌ Error syncing call log ${omniCallLog.id}:`,
        error.message
      );
    }
  }


  return { syncedCount, createdCount, updatedCount };
}

// Get all call logs with filters and pagination
// Matches: GET /api/v1/calls/logs?pageno=1&pagesize=10&agentid=123&call_status=completed
exports.getCallLogs = async (req, res) => {
  try {
    const adminUserId = await getUserIdObjectId(req.user.id);
    const {
      pageno = 1,
      pagesize = 10,
      agentid,
      call_status,
      phone_number,
      start_date,
      end_date,
      userId: userIdFilter,
    } = req.query;

    // Build query
    const query = {};

    if (userIdFilter) {
      const resolvedUserId = await getUserIdObjectId(userIdFilter);
      if (resolvedUserId) {
        query.userId = resolvedUserId;
      }
    }

    // Add filters
    if (agentid) {
      // Find voice assistant by omnidimensionId
      const agent = await VoiceAssistant.findOne({
        omnidimensionId: agentid.toString(),
      });
      if (agent) {
        query.agentUsed = agent._id;
      } else {
        // Agent not found, return empty result
        return res.json({
          success: true,
          data: [],
          pagination: {
            pageno: parseInt(pageno),
            pagesize: parseInt(pagesize),
            total: 0,
            pages: 0,
          },
        });
      }
    }

    if (call_status) {
      query.status = call_status;
    }

    if (phone_number) {
      query.phoneNumber = phone_number;
    }

    // Date filters
    if (start_date || end_date) {
      query.createdAt = {};
      if (start_date) {
        query.createdAt.$gte = new Date(start_date);
      }
      if (end_date) {
        query.createdAt.$lte = new Date(end_date);
      }
    }

    // Calculate pagination (OMNIDIMENSION uses pageno and pagesize)
    const skip = (parseInt(pageno) - 1) * parseInt(pagesize);
    const limit = parseInt(pagesize);

    // Get call logs with populated agent
    const callLogs = await CallLog.find(query)
      .populate("agentUsed", "name description")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    // Get total count
    const total = await CallLog.countDocuments(query);

    // Format call logs with campaign name resolution
    const formattedCallLogs = await Promise.all(
      callLogs.map(async (log) => {
        const campaignId = normalizeDisplayValue(
          log.campaignId ??
            log?.call_request_id?.id ??
            log?.call_request_id ??
            null,
          { preferredKeys: ["id", "code"] }
        );
        
        // Use our new helper function to find campaign name
        const campaignName = await findCampaignNameForCallLog(log);

        return {
          _id: log._id,
          omnidimensionId: log.omnidimensionId,
          userId: log.userId,
          source: log.source || "Omnidimension",
          phoneNumber: log.phoneNumber,
          toNumber: log.toNumber || log.phoneNumber,
          duration: typeof log.duration === "number" ? log.duration : 0,
          callType: log.callType || "Call",
          cqsScore: log.cqsScore || 0,
          status: log.status || "completed",
          cost: log.cost || 0,
          recordingUrl: log.recordingUrl || null,
          transcript: log.transcript || null,
          agentUsed: log.agentUsed
            ? {
                _id: log.agentUsed._id,
                name: log.agentUsed.name,
                description: log.agentUsed.description,
              }
            : log.bot_name
            ? { name: log.bot_name }
            : null,
          createdAt: log.createdAt,
          campaignId,
          campaignName,
          metadata: log.metadata || undefined,
        };
      })
    );

    triggerAdminBackgroundSync({
      userId: userIdFilter
        ? await getUserIdObjectId(userIdFilter)
        : adminUserId,
      filters: {
        agentid,
        call_status,
        phone_number,
        start_date,
        end_date,
      },
    });

    res.json({
      success: true,
      data: formattedCallLogs,
      pagination: {
        pageno: parseInt(pageno),
        pagesize: parseInt(pagesize),
        total,
        pages: Math.ceil(total / parseInt(pagesize)),
      },
    });
  } catch (error) {
    console.error("Get Call Logs Error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Get single call log
// Matches: GET /api/v1/calls/logs/:id
exports.getCallLog = async (req, res) => {
  try {
    const { id } = req.params;

    // Find by omnidimensionId or _id
    const callLogIdStr = id.toString();
    const isObjectId = /^[0-9a-fA-F]{24}$/.test(callLogIdStr);

    const callLog = await CallLog.findOne({
      $or: isObjectId
        ? [{ omnidimensionId: callLogIdStr }, { _id: id }]
        : [{ omnidimensionId: callLogIdStr }],
    }).populate("agentUsed", "name description");

    if (!callLog) {
      return res.status(404).json({
        success: false,
        message: "Call log not found",
      });
    }

    // Enrich single call log with campaign information
    const enrichedCallLogs = await enrichCallLogsWithCampaignInfo([callLog]);

    res.json({
      success: true,
      data: enrichedCallLogs[0],
    });
  } catch (error) {
    console.error("Get Call Log Error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Get call statistics
exports.getCallStats = async (req, res) => {
  try {
    const { start_date, end_date, userId: userIdFilter } = req.query;

    // Build date filter
    const dateFilter = {};
    if (start_date || end_date) {
      dateFilter.createdAt = {};
      if (start_date) {
        dateFilter.createdAt.$gte = new Date(start_date);
      }
      if (end_date) {
        dateFilter.createdAt.$lte = new Date(end_date);
      }
    }

    const query = { ...dateFilter };

    if (userIdFilter) {
      const resolvedUserId = await getUserIdObjectId(userIdFilter);
      if (resolvedUserId) {
        query.userId = resolvedUserId;
      }
    }

    // Calculate statistics
    const totalCalls = await CallLog.countDocuments(query);
    const completedCalls = await CallLog.countDocuments({
      ...query,
      status: "completed",
    });
    const totalMinutes = await CallLog.aggregate([
      { $match: query },
      { $group: { _id: null, total: { $sum: "$duration" } } },
    ]);
    const totalCost = await CallLog.aggregate([
      { $match: query },
      { $group: { _id: null, total: { $sum: "$cost" } } },
    ]);
    const avgCqsScore = await CallLog.aggregate([
      { $match: { ...query, cqsScore: { $gt: 0 } } },
      { $group: { _id: null, avg: { $avg: "$cqsScore" } } },
    ]);

    res.json({
      success: true,
      data: {
        totalCalls,
        completedCalls,
        totalMinutes: totalMinutes[0]?.total || 0,
        totalCost: totalCost[0]?.total || 0,
        avgCqsScore: avgCqsScore[0]?.avg || 0,
        successRate:
          totalCalls > 0 ? ((completedCalls / totalCalls) * 100).toFixed(2) : 0,
      },
    });
  } catch (error) {
    console.error("Get Call Stats Error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Delete call log
exports.deleteCallLog = async (req, res) => {
  try {
    const { id } = req.params;

    // Find call log
    const callLogIdStr = id.toString();
    const isObjectId = /^[0-9a-fA-F]{24}$/.test(callLogIdStr);

    const callLog = await CallLog.findOne({
      $or: isObjectId
        ? [{ omnidimensionId: callLogIdStr }, { _id: id }]
        : [{ omnidimensionId: callLogIdStr }],
    });

    if (!callLog) {
      return res.status(404).json({
        success: false,
        message: "Call log not found",
      });
    }

    // Delete from local database
    await CallLog.findByIdAndDelete(callLog._id);

    // Broadcast to all connected clients
    if (global.io) {
      global.io.emit("call_log_deleted", { id: callLog._id });
    }

    res.json({
      success: true,
      message: "Call log deleted successfully",
    });
  } catch (error) {
    console.error("Delete Call Log Error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};
