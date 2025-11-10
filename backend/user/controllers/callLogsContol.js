const CallLog = require("../../models/CallLog");
const VoiceAssistant = require("../../models/VoiceAssistant");
const BulkCall = require("../../models/BulkCall");
const BulkCallLine = require("../../models/BulkCallLine");
const User = require("../../models/User");
const mongoose = require("mongoose");
const { normalizePhoneNumber } = require("../../utils/phone");
const {
  syncToOmnidimension,
  fetchFromOmnidimension,
} = require("../../services/omniApi.js");

const userCallLogSyncState = new Map();
const SYNC_COOLDOWN_MS = 60 * 1000;
const MAX_BACKGROUND_SYNC_PAGES = 50;
const DEFAULT_OMNI_PAGE_SIZE = 100;

// Helper function to get user ID as ObjectId
const getUserIdObjectId = (userId) => {
  if (!userId) return null;
  if (userId instanceof mongoose.Types.ObjectId) {
    return userId;
  }
  if (mongoose.Types.ObjectId.isValid(userId)) {
    return new mongoose.Types.ObjectId(userId);
  }
  return null;
};

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

// // Helper function to ensure we have a valid userId ObjectId
// async function getUserIdObjectId(userId) {
//   if (!userId) {
//     const User = require("../../models/User");
//     let adminUser = await User.findOne({ role: "admin" });
//     if (!adminUser) {
//       adminUser = await User.create({
//         email: "admin@example.com",
//         role: "admin",
//       });
//     }
//     return adminUser._id;
//   }
//   return toObjectId(userId);
// }

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

function buildNumberMatcher(userExotelNumbers, normalizedUserExotelNumbers) {
  const normalizedSet = new Set(
    (normalizedUserExotelNumbers || []).filter(Boolean)
  );
  const exactSet = new Set((userExotelNumbers || []).filter(Boolean));

  return (log, debugIndex = null) => {
    const rawCandidates = [
      log.to_number,
      log.toNumber,
      log.to,
      log.phone_number,
      log.phoneNumber,
      log.from_number,
      log.fromNumber,
      log.from,
      log.source,
      log.phone,
      log.phoneNumber,
      log.normalizedSource,
      log.normalizedPhoneNumber,
    ];

    const candidates = rawCandidates
      .map((value) =>
        value === undefined || value === null ? null : String(value).trim()
      )
      .filter(Boolean);

    if (debugIndex !== null && debugIndex < 5) {
      console.log(
        `🔍 Candidate numbers for log ${debugIndex + 1}:`,
        candidates
      );
    }

    for (const candidate of candidates) {
      if (exactSet.has(candidate)) {
        return true;
      }
      const normalizedCandidate = normalizePhoneNumber(candidate);
      if (normalizedCandidate && normalizedSet.has(normalizedCandidate)) {
        return true;
      }
    }
    return false;
  };
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
    // Method 1: Direct campaign name from call log (but skip if it looks like an agent name)
    if (
      callLog.campaignName &&
      !callLog.campaignName.includes("Agent") &&
      !callLog.campaignName.includes("Development")
    ) {
      return callLog.campaignName;
    }

    // Method 2: Try to find campaign through call_request_id
    const callRequestId =
      callLog.call_request_id?.id || callLog.call_request_id;
    if (callRequestId) {
      // Look for bulk call line with matching omnidimensionCallId
      const bulkCallLine = await BulkCallLine.findOne({
        omnidimensionCallId: callRequestId.toString(),
      }).populate("bulkCallId");

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
        bot: agentId,
      })
        .sort({ createdAt: -1 })
        .limit(1);

      if (bulkCampaigns.length > 0) {
        return bulkCampaigns[0].name;
      }

      // Try without agent matching (fallback)
      const bulkCampaignsNoAgent = await BulkCall.find({
        phoneNumbers: toNumber,
      })
        .sort({ createdAt: -1 })
        .limit(1);

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

async function performBackgroundSync({
  userId,
  userExotelNumbers,
  normalizedUserExotelNumbers,
  filters,
}) {
  try {
    const matchLogToNumbers = buildNumberMatcher(
      userExotelNumbers,
      normalizedUserExotelNumbers
    );

    let currentPage = 1;
    let totalFetched = 0;
    let totalMatched = 0;
    let totalSynced = 0;

    while (currentPage <= MAX_BACKGROUND_SYNC_PAGES) {
      const omniParams = {
        pageno: currentPage,
        pagesize: DEFAULT_OMNI_PAGE_SIZE,
      };

      if (filters.agentid) omniParams.agentid = filters.agentid;
      if (filters.call_status) omniParams.call_status = filters.call_status;
      if (filters.phone_number) omniParams.phone_number = filters.phone_number;
      if (filters.start_date) omniParams.start_date = filters.start_date;
      if (filters.end_date) omniParams.end_date = filters.end_date;

      console.log(
        `📡 Background sync: fetching page ${currentPage} for user ${userId}`,
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
          `📡 Background sync: page ${currentPage} empty, stopping (fetched=${totalFetched})`
        );
        break;
      }

      const matchedLogs = omniCallLogs.filter((log) => matchLogToNumbers(log));
      totalMatched += matchedLogs.length;

      if (matchedLogs.length) {
        const syncResult = await syncCallLogsFromOmnidimension(
          matchedLogs,
          userId
        );
        totalSynced += syncResult.syncedCount;
        console.log(
          `📡 Background sync: user ${userId} page ${currentPage} synced ${syncResult.syncedCount} logs`
        );
      }

      if (omniCallLogs.length < DEFAULT_OMNI_PAGE_SIZE) {
        console.log(
          `📡 Background sync: reached last page for user ${userId} (page size smaller than expected)`
        );
        break;
      }

      currentPage++;
    }

    return {
      totalFetched,
      totalMatched,
      totalSynced,
      pagesProcessed: currentPage,
    };
  } catch (error) {
    console.error(
      `❌ Background call log sync failed for user ${userId}:`,
      error.message
    );
    throw error;
  }
}

function triggerBackgroundSync({
  userId,
  userExotelNumbers,
  normalizedUserExotelNumbers,
  filters,
}) {
  const key = userId.toString();
  const existingState = userCallLogSyncState.get(key);
  const now = Date.now();

  if (existingState?.inProgress) {
    return existingState.promise;
  }

  if (
    existingState?.lastRun &&
    now - existingState.lastRun < SYNC_COOLDOWN_MS
  ) {
    return existingState.promise;
  }

  const syncPromise = (async () => {
    try {
      const result = await performBackgroundSync({
        userId,
        userExotelNumbers,
        normalizedUserExotelNumbers,
        filters,
      });
      userCallLogSyncState.set(key, {
        inProgress: false,
        lastRun: Date.now(),
        lastError: null,
        lastResult: result,
        promise: null,
      });
      return result;
    } catch (error) {
      userCallLogSyncState.set(key, {
        inProgress: false,
        lastRun: Date.now(),
        lastError: error.message,
        lastResult: null,
        promise: null,
      });
      throw error;
    }
  })();

  userCallLogSyncState.set(key, {
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
          enrichedCallLog.campaignName =
            callLog.bot_name || `Campaign ${enrichedCallLog.campaignId}`;
        }
      } catch (error) {
        console.error(
          `Error finding campaign name for ID ${enrichedCallLog.campaignId}:`,
          error.message
        );
        enrichedCallLog.campaignName =
          callLog.bot_name || `Campaign ${enrichedCallLog.campaignId}`;
      }

      console.log(
        `   ✅ Found campaign: ID=${enrichedCallLog.campaignId}, Name=${enrichedCallLog.campaignName}`
      );
    } else {
      console.log(
        `   ❌ No call_request_id found for call ${callLog.omnidimensionId}`
      );
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

  let userExotelNumbers = [];
  let normalizedUserExotelNumbers = [];
  if (userId) {
    try {
      const userRecord = await User.findById(userId).select("exotelNumbers");
      if (userRecord?.exotelNumbers?.length) {
        userExotelNumbers = userRecord.exotelNumbers
          .map((num) => (typeof num === "string" ? num.trim() : `${num}`))
          .filter(Boolean);
        normalizedUserExotelNumbers = userExotelNumbers
          .map((num) => normalizePhoneNumber(num))
          .filter(Boolean);
      }
    } catch (userLookupError) {
      console.error(
        "⚠️  Unable to load user Exotel numbers during sync:",
        userLookupError.message
      );
    }
  }

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

      const directionRaw =
        omniCallLog.direction ||
        omniCallLog.call_direction ||
        omniCallLog.call_type ||
        omniCallLog.callType ||
        omniCallLog.channel_type;
      const direction =
        typeof directionRaw === "string"
          ? directionRaw.toLowerCase()
          : undefined;

      const inboundDirections = ["inbound", "incoming", "in", "call_in"];
      const outboundDirections = ["outbound", "outgoing", "out", "call_out"];

      const toNumber =
        omniCallLog.to_number ||
        omniCallLog.toNumber ||
        omniCallLog.to ||
        omniCallLog.phone_number ||
        omniCallLog.phoneNumber;
      const fromNumber =
        omniCallLog.from_number ||
        omniCallLog.fromNumber ||
        omniCallLog.from ||
        omniCallLog.caller_number;

      let exotelNumber = null;
      if (direction && inboundDirections.includes(direction)) {
        exotelNumber = toNumber || fromNumber || omniCallLog.phone;
      } else if (direction && outboundDirections.includes(direction)) {
        exotelNumber = fromNumber || toNumber || omniCallLog.phone;
      } else {
        exotelNumber =
          omniCallLog.source || fromNumber || toNumber || omniCallLog.phone;
      }

      if (normalizedUserExotelNumbers.length) {
        const candidates = [toNumber, fromNumber, exotelNumber].filter(Boolean);
  
        const matchedExotel = candidates
          .map((num) => num.toString().trim())
          .find((num) => {
            const normalizedCandidate = normalizePhoneNumber(num);
            const exactMatch = userExotelNumbers.includes(num);
            const normalizedMatch =
              normalizedCandidate &&
              normalizedUserExotelNumbers.includes(normalizedCandidate);

            console.log(
              `   📞 Checking ${num} (normalized: ${normalizedCandidate})`
            );
            console.log(`      - Exact match: ${exactMatch}`);
            console.log(`      - Normalized match: ${normalizedMatch}`);

            return exactMatch || normalizedMatch;
          });

        if (matchedExotel) {
          exotelNumber = matchedExotel;
          console.log(`✅ Found matching exotel number: ${matchedExotel}`);
        } else {
          console.log(`❌ No matching exotel number found for call ${omniId}`);
        }
      }

      const rawNumberCandidates = [
        toNumber,
        fromNumber,
        omniCallLog.phone_number,
        omniCallLog.phoneNumber,
        omniCallLog.customer_phone_number,
        omniCallLog.customerPhoneNumber,
        omniCallLog.contact_number,
        omniCallLog.contactNumber,
        omniCallLog.phone,
      ].filter(Boolean);

      const normalizedExotelNumber = normalizePhoneNumber(exotelNumber);
      const customerNumberCandidate = rawNumberCandidates.find((num) => {
        const normalizedCandidate = normalizePhoneNumber(num);
        return (
          normalizedCandidate &&
          (!normalizedExotelNumber ||
            normalizedCandidate !== normalizedExotelNumber)
        );
      });

      const phoneNumber =
        customerNumberCandidate || rawNumberCandidates[0] || null;

      if (!exotelNumber && phoneNumber) {
        exotelNumber = phoneNumber;
      }

      if (!phoneNumber) {
        console.error(
          "⚠️  Skipping call log: missing phone number",
          omniCallLog
        );
        continue;
      }

      // Find existing call log by omnidimensionId
      const existing = await CallLog.findOne({
        omnidimensionId: omniId,
        userId,
      });

      // Map OMNIDIMENSION API fields to our schema
      // Omni API fields: from_number, to_number, call_duration_in_seconds, call_status, cqs_score, call_cost, recording_url, call_conversation, bot_name, time_of_call, call_request_id
      const mappedData = {
        omnidimensionId: omniId,
        source: exotelNumber || "unknown",
        phoneNumber: phoneNumber,
        toNumber: toNumber || null,
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
      mappedData.normalizedPhoneNumber = normalizePhoneNumber(
        mappedData.phoneNumber
      );

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
      // Handle duplicate key errors gracefully
      if (error.code === 11000 && error.message.includes("omnidimensionId")) {
        console.log(
          `⚠️  Call log ${omniCallLog.id} already exists, skipping...`
        );
        // Try to update the existing record instead
        try {
          const currentOmniId = (
            omniCallLog.id ||
            omniCallLog.call_log_id ||
            omniCallLog.call_id
          ).toString();

          const existingRecord = await CallLog.findOne({
            omnidimensionId: currentOmniId,
            userId,
          });
          if (existingRecord) {
            Object.assign(existingRecord, mappedData);
            await existingRecord.save();
            updatedCount++;
            syncedCount++;
            console.log(`✅ Updated existing call log ${omniCallLog.id}`);
          }
        } catch (updateError) {
          console.error(
            `❌ Failed to update existing call log ${omniCallLog.id}:`,
            updateError.message
          );
        }
      } else {
        console.error(
          `❌ Error syncing call log ${omniCallLog.id}:`,
          error.message
        );
      }
    }
  }

  console.log(
    `✅ Synced ${syncedCount} call logs (${createdCount} created, ${updatedCount} updated)`
  );
  console.log(`🔍 User Exotel numbers used for filtering:`, userExotelNumbers);
  console.log(
    `🔍 Normalized user Exotel numbers:`,
    normalizedUserExotelNumbers
  );
  return { syncedCount, createdCount, updatedCount };
}

// Get all call logs with filters and pagination
// Matches: GET /api/v1/calls/logs?pageno=1&pagesize=10&agentid=123&call_status=completed
exports.getCallLogs = async (req, res) => {
  try {
    const userId = await getUserIdObjectId(req.user.id);

    // Get user's assigned Exotel numbers
    const user = await User.findById(userId);
    if (!user || !user.exotelNumbers || user.exotelNumbers.length === 0) {
      return res.json({
        success: true,
        data: [],
        pagination: {
          pageno: 1,
          pagesize: 10,
          total: 0,
          pages: 0,
        },
        message: "No assigned Exotel numbers found for this user",
      });
    }

    const userExotelNumbers = user.exotelNumbers
      .map((num) => (typeof num === "string" ? num.trim() : `${num}`))
      .filter(Boolean);
    const normalizedUserExotelNumbers = userExotelNumbers
      .map((num) => normalizePhoneNumber(num))
      .filter(Boolean);

    const {
      pageno = 1,
      pagesize = 10,
      agentid,
      call_status,
      phone_number,
      start_date,
      end_date,
    } = req.query;

    const requestedPageSize = parseInt(pagesize, 10);
    const requestedPageNo = parseInt(pageno, 10);

    const actualPageSize =
      Number.isNaN(requestedPageSize) || requestedPageSize <= 0
        ? 10
        : Math.min(requestedPageSize, 100);
    const actualPageNo =
      Number.isNaN(requestedPageNo) || requestedPageNo <= 0
        ? 1
        : requestedPageNo;

    console.log(
      `🔍 Requested (cached): Page ${actualPageNo}, PageSize ${actualPageSize}`
    );

    const skip = (actualPageNo - 1) * actualPageSize;

    const matchConditions = [
      { userId },
      {
        $or: [
          { source: { $in: userExotelNumbers } },
          { phoneNumber: { $in: userExotelNumbers } },
          { normalizedSource: { $in: normalizedUserExotelNumbers } },
          { normalizedPhoneNumber: { $in: normalizedUserExotelNumbers } },
        ],
      },
    ];

    if (call_status) {
      matchConditions.push({ status: call_status });
    }

    if (start_date || end_date) {
      const dateFilter = {};
      if (start_date) {
        dateFilter.$gte = new Date(start_date);
      }
      if (end_date) {
        dateFilter.$lte = new Date(end_date);
      }
      matchConditions.push({ createdAt: dateFilter });
    }

    if (phone_number) {
      const trimmed = String(phone_number).trim();
      const normalizedPhoneInput = normalizePhoneNumber(trimmed);
      const phoneConditions = [{ phoneNumber: trimmed }, { source: trimmed }];

      if (normalizedPhoneInput) {
        phoneConditions.push(
          { normalizedPhoneNumber: normalizedPhoneInput },
          { normalizedSource: normalizedPhoneInput }
        );
      }

      matchConditions.push({ $or: phoneConditions });
    }

    if (agentid) {
      const agentObjectId = toObjectId(agentid);
      const agentConditions = [
        { "call_request_id.id": agentid },
        { call_request_id: agentid },
        { campaignId: agentid },
      ];

      if (agentObjectId) {
        agentConditions.push({ agentUsed: agentObjectId });
      }

      matchConditions.push({ $or: agentConditions });
    }

    const mongoQuery = { $and: matchConditions };

    const totalFiltered = await CallLog.countDocuments(mongoQuery);

    const paginatedLogs = await CallLog.find(mongoQuery)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(actualPageSize)
      .populate("agentUsed", "name description")
      .lean();

    // Format call logs with campaign name resolution
    const formattedCallLogs = await Promise.all(
      paginatedLogs.map(async (log) => {
        const campaignId = normalizeDisplayValue(
          log.campaignId ??
            log?.call_request_id?.id ??
            log?.call_request_id ??
            null,
          { preferredKeys: ["id", "code"] }
        );

        // Use our new helper function to find campaign name
        const campaignName = await findCampaignNameForCallLog(log);

        // Debug logging for first few calls
        if (paginatedLogs.indexOf(log) < 3) {
          console.log(`🔍 Call ${paginatedLogs.indexOf(log) + 1}:`, {
            originalCampaignName: log.campaignName,
            resolvedCampaignName: campaignName,
            callRequestId: log.call_request_id,
            agentUsed: log.agentUsed?.name,
            botName: log.bot_name,
          });
        }

        const normalizedSourceNumber = normalizePhoneNumber(log.source);
        const phoneCandidates = [
          log.phoneNumber,
          log.toNumber,
          log.metadata?.phoneNumber,
          log.metadata?.customerPhoneNumber,
          log.metadata?.contactNumber,
          log.metadata?.toNumber,
        ].filter(Boolean);
        const displayPhoneNumber =
          phoneCandidates.find((num) => {
            const normalizedCandidate = normalizePhoneNumber(num);
            return (
              normalizedCandidate &&
              (!normalizedSourceNumber ||
                normalizedCandidate !== normalizedSourceNumber)
            );
          }) ||
          phoneCandidates[0] ||
          log.phoneNumber;

        return {
          _id: log._id,
          omnidimensionId: log.omnidimensionId,
          userId: log.userId,
          source: log.source || "Omnidimension",
          phoneNumber: displayPhoneNumber,
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

    triggerBackgroundSync({
      userId,
      userExotelNumbers,
      normalizedUserExotelNumbers,
      filters: {
        agentid,
        call_status,
        phone_number,
        start_date,
        end_date,
      },
    });

    const syncKey = userId.toString();
    const syncState = userCallLogSyncState.get(syncKey);

    return res.json({
      success: true,
      data: formattedCallLogs,
      pagination: {
        pageno: actualPageNo,
        pagesize: actualPageSize,
        total: totalFiltered,
        pages: Math.max(
          1,
          Math.ceil(totalFiltered / Math.max(actualPageSize, 1))
        ),
      },
      sync: {
        inProgress: Boolean(syncState?.inProgress),
        lastRunAt: syncState?.lastRun || null,
        lastError: syncState?.lastError || null,
        lastResult: syncState?.lastResult || null,
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
    const userId = await getUserIdObjectId(req.user.id);
    const { id } = req.params;

    // Find by omnidimensionId or _id
    const callLogIdStr = id.toString();
    const isObjectId = /^[0-9a-fA-F]{24}$/.test(callLogIdStr);

    // Get user's assigned Exotel numbers for filtering
    const user = await User.findById(userId);
    if (!user || !user.exotelNumbers || user.exotelNumbers.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No assigned Exotel numbers found for this user",
      });
    }

    const userExotelNumbers = user.exotelNumbers
      .map((num) => (typeof num === "string" ? num.trim() : `${num}`))
      .filter(Boolean);
    const normalizedUserExotelNumbers = userExotelNumbers
      .map((num) => normalizePhoneNumber(num))
      .filter(Boolean);

    const callLog = await CallLog.findOne({
      $or: isObjectId
        ? [{ omnidimensionId: callLogIdStr }, { _id: id }]
        : [{ omnidimensionId: callLogIdStr }],
      $or: [
        { source: { $in: userExotelNumbers } },
        { normalizedSource: { $in: normalizedUserExotelNumbers } },
      ],
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
    const userId = await getUserIdObjectId(req.user.id);

    // Get user's assigned Exotel numbers
    const user = await User.findById(userId);
    if (!user || !user.exotelNumbers || user.exotelNumbers.length === 0) {
      return res.json({
        success: true,
        data: {
          totalCalls: 0,
          completedCalls: 0,
          totalMinutes: 0,
          totalCost: 0,
          avgCqsScore: 0,
          successRate: 0,
        },
      });
    }

    const userExotelNumbers = user.exotelNumbers
      .map((num) => (typeof num === "string" ? num.trim() : `${num}`))
      .filter(Boolean);
    const normalizedUserExotelNumbers = userExotelNumbers
      .map((num) => normalizePhoneNumber(num))
      .filter(Boolean);

    const { start_date, end_date } = req.query;

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

    const query = {
      userId,
      $or: [
        { source: { $in: userExotelNumbers } },
        { normalizedSource: { $in: normalizedUserExotelNumbers } },
        { normalizedPhoneNumber: { $in: normalizedUserExotelNumbers } },
        { phoneNumber: { $in: userExotelNumbers } },
      ],
      ...dateFilter,
    };

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

// Get call log recording
exports.getCallLogRecording = async (req, res) => {
  try {
    const userId = await getUserIdObjectId(req.user.id);
    const { id } = req.params;
    const { recordingUrl } = req.query;

    // Get user's assigned Exotel numbers for security
    const user = await User.findById(userId);
    if (!user || !user.exotelNumbers || user.exotelNumbers.length === 0) {
      return res.status(403).json({
        success: false,
        message: "No assigned Exotel numbers found for this user",
      });
    }

    // Find call log and verify it belongs to user's assigned numbers
    const callLogIdStr = id.toString();
    const isObjectId = /^[0-9a-fA-F]{24}$/.test(callLogIdStr);

    const callLog = await CallLog.findOne({
      $or: isObjectId
        ? [{ omnidimensionId: callLogIdStr }, { _id: id }]
        : [{ omnidimensionId: callLogIdStr }],
      source: { $in: user.exotelNumbers }, // Security: only allow access to assigned numbers (check source field)
    });

    if (!callLog && !recordingUrl) {
      return res.status(404).json({
        success: false,
        message: "Call log not found or not accessible",
      });
    }

    // Use recordingUrl from call log or query parameter
    const finalRecordingUrl = callLog?.recordingUrl || recordingUrl;

    if (!finalRecordingUrl) {
      return res.status(404).json({
        success: false,
        message: "Recording URL not found",
      });
    }

    // Fetch and stream the recording
    const axios = require("axios");
    const response = await axios.get(finalRecordingUrl, {
      responseType: "stream",
      timeout: 30000,
    });

    // Set appropriate headers
    res.setHeader(
      "Content-Type",
      response.headers["content-type"] || "audio/mpeg"
    );
    res.setHeader("Content-Length", response.headers["content-length"]);
    res.setHeader("Cache-Control", "public, max-age=3600");

    // Pipe the audio stream to response
    response.data.pipe(res);
  } catch (error) {
    console.error("Get Call Log Recording Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch recording",
      error: error.message,
    });
  }
};

// Delete call log
exports.deleteCallLog = async (req, res) => {
  try {
    const userId = await getUserIdObjectId(req.user.id);
    const { id } = req.params;

    // Find call log
    const callLogIdStr = id.toString();
    const isObjectId = /^[0-9a-fA-F]{24}$/.test(callLogIdStr);

    const callLog = await CallLog.findOne({
      $or: isObjectId
        ? [{ omnidimensionId: callLogIdStr }, { _id: id }]
        : [{ omnidimensionId: callLogIdStr }],
      userId,
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
      console.log("📡 Broadcasted: call_log_deleted");
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
