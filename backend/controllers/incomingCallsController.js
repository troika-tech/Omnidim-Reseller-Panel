const IncomingCall = require("../models/IncomingCall");
const mongoose = require("mongoose");
const {
  fetchIncomingCalls,
  getIncomingCallDetails,
} = require("../services/exotelApi.js");

const incomingCallSyncState = new Map();
const INCOMING_SYNC_KEY = "admin";
const INCOMING_SYNC_COOLDOWN_MS = 60 * 1000;
const INCOMING_SYNC_MAX_DAYS = 7;
const INCOMING_SYNC_MAX_RECORDS = 1500;
const INCOMING_SYNC_CHUNK_DAYS = 1;

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

// Helper function to parse Exotel date format
function parseExotelDate(dateString) {
  if (!dateString) return null;

  // Try ISO format first
  const isoDate = new Date(dateString);
  if (!isNaN(isoDate.getTime())) {
    return isoDate;
  }

  // Try Exotel format: "YYYY-MM-DD HH:MM:SS"
  const exotelFormat = /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/;
  const match = dateString.match(exotelFormat);
  if (match) {
    const [, year, month, day, hour, minute, second] = match;
    return new Date(
      parseInt(year),
      parseInt(month) - 1, // Month is 0-indexed
      parseInt(day),
      parseInt(hour),
      parseInt(minute),
      parseInt(second)
    );
  }

  // Try other common formats
  const date = new Date(dateString);
  return isNaN(date.getTime()) ? null : date;
}

// Helper function to calculate duration in seconds
function calculateDuration(startTime, endTime) {
  if (!startTime || !endTime) return 0;
  const start = new Date(startTime);
  const end = new Date(endTime);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return 0;
  return Math.floor((end.getTime() - start.getTime()) / 1000);
}

// Helper function to map Exotel webhook data to IncomingCall schema
function mapExotelToIncomingCall(exotelData, userId) {
  // Exotel uses 'Sid' not 'CallSid' - prioritize Sid
  const exotelCallSid =
    exotelData.Sid || exotelData.CallSid || exotelData.callSid;

  if (!exotelCallSid) {
    console.warn(
      "⚠️  No CallSid/Sid found in Exotel data:",
      Object.keys(exotelData)
    );
  }

  const mappedData = {
    userId: toObjectId(userId),
    exotelCallSid: exotelCallSid,
    from: exotelData.From || exotelData.from || "",
    to: exotelData.To || exotelData.to || "",
    status: mapExotelStatus(exotelData.Status || exotelData.status),
    startTime: parseExotelDate(
      exotelData.StartTime ||
        exotelData.Start ||
        exotelData.startTime ||
        exotelData.DateCreated
    ),
    endTime: parseExotelDate(
      exotelData.EndTime ||
        exotelData.End ||
        exotelData.endTime ||
        exotelData.DateUpdated
    ),
    recordingUrl:
      exotelData.RecordingUrl ||
      exotelData.recordingUrl ||
      (exotelData.RecordingSid
        ? `https://${
            process.env.EXOTEL_SUBDOMAIN || "api"
          }.exotel.com/v1/Accounts/${
            process.env.EXOTEL_ACCOUNT_SID
          }/Recordings/${exotelData.RecordingSid}.mp3`
        : null),
    callType: "incoming",
    syncedAt: new Date(),
  };

  // Use Duration from Exotel if available (in seconds), otherwise calculate
  if (exotelData.Duration !== undefined && exotelData.Duration !== null) {
    mappedData.duration = parseInt(exotelData.Duration) || 0;
  } else if (mappedData.startTime && mappedData.endTime) {
    mappedData.duration = calculateDuration(
      mappedData.startTime,
      mappedData.endTime
    );
  } else {
    mappedData.duration = 0;
  }

  // Add metadata if available
  if (
    exotelData.Direction ||
    exotelData.CallerName ||
    exotelData.Location ||
    exotelData.AnsweredBy
  ) {
    mappedData.metadata = {
      direction: exotelData.Direction || exotelData.direction,
      callerName: exotelData.CallerName || exotelData.callerName,
      location: exotelData.Location || exotelData.location,
      answeredBy: exotelData.AnsweredBy || exotelData.answeredBy,
    };
  }

  return mappedData;
}

// Helper function to map Exotel status to our status enum
function mapExotelStatus(exotelStatus) {
  if (!exotelStatus) return "ringing";

  const statusMap = {
    ringing: "ringing",
    answered: "answered",
    completed: "completed",
    busy: "busy",
    "no-answer": "no-answer",
    "no-answer": "no-answer",
    failed: "failed",
    cancelled: "cancelled",
    busy: "busy",
    completed: "completed",
  };

  const lowerStatus = exotelStatus.toLowerCase();
  return statusMap[lowerStatus] || "ringing";
}

// Helper function to normalize phone numbers and get last 10 digits
function normalizePhoneNumber(phoneNumber) {
  if (!phoneNumber) return "";

  // Remove all non-digit characters
  const digitsOnly = phoneNumber.toString().replace(/\D/g, "");

  // Get last 10 digits (handles +91, 0, or direct 10-digit numbers)
  return digitsOnly.slice(-10);
}

// Helper function to filter out garbage entries where from and to numbers are the same
function filterValidCalls(calls) {
  return calls.filter((call) => {
    const fromNormalized = normalizePhoneNumber(call.from);
    const toNormalized = normalizePhoneNumber(call.to);

    // Skip entries where from and to are the same (garbage entries)
    if (fromNormalized === toNormalized && fromNormalized.length === 10) {
      return false;
    }

    return true;
  });
}

async function upsertIncomingCalls(exotelCalls, userId) {
  let syncedCount = 0;
  let createdCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (const exotelCall of exotelCalls) {
    try {
      const mappedData = mapExotelToIncomingCall(exotelCall, userId);

      if (!mappedData.exotelCallSid) {
        skippedCount++;
        continue;
      }

      if (!mappedData.userId) {
        skippedCount++;
        continue;
      }

      const isValidCall = filterValidCalls([mappedData]).length > 0;
      if (!isValidCall) {
        skippedCount++;
        continue;
      }

      // Use findOneAndUpdate with upsert for better duplicate handling
      const result = await IncomingCall.findOneAndUpdate(
        { exotelCallSid: mappedData.exotelCallSid },
        { $set: mappedData },
        {
          upsert: true,
          new: true,
          setDefaultsOnInsert: true,
        }
      );

      // Check if it was created or updated
      const existing = await IncomingCall.findOne({
        exotelCallSid: mappedData.exotelCallSid,
        createdAt: { $lt: new Date(Date.now() - 1000) }, // Created more than 1 second ago
      });

      if (existing) {
        updatedCount++;
      } else {
        createdCount++;
      }
      syncedCount++;
    } catch (syncError) {
      errorCount++;
      console.error("⚠️  Error syncing call:", syncError.message);
    }
  }

  return {
    synced: syncedCount,
    created: createdCount,
    updated: updatedCount,
    skipped: skippedCount,
    errors: errorCount,
    total: exotelCalls.length,
  };
}

async function performIncomingBackgroundSync({ userId, filters }) {
  try {
    const now = new Date();
    const endDate = filters.end_date ? new Date(filters.end_date) : now;
    const startDate = filters.start_date
      ? new Date(filters.start_date)
      : new Date(
          endDate.getTime() - INCOMING_SYNC_MAX_DAYS * 24 * 60 * 60 * 1000
        );

    console.log(
      `📡 Incoming call background sync starting: ${startDate.toISOString()} -> ${endDate.toISOString()}`
    );

    // Get all users with Exotel numbers for proper user assignment
    const User = require("../models/User");
    const usersWithExotel = await User.find({
      exotelNumbers: { $exists: true, $ne: [] },
    })
      .select("_id exotelNumbers")
      .lean();

    if (usersWithExotel.length === 0) {
      console.log("⚠️ No users with Exotel numbers found for sync");
      return {
        synced: 0,
        created: 0,
        updated: 0,
        skipped: 0,
        errors: 0,
        total: 0,
        fetched: 0,
        limited: 0,
      };
    }

    let totalSynced = 0;
    let totalCreated = 0;
    let totalUpdated = 0;
    let totalSkipped = 0;
    let totalErrors = 0;
    let totalFetched = 0;

    // Sync calls for each user's Exotel numbers
    for (const user of usersWithExotel) {
      for (const exotelNum of user.exotelNumbers) {
        try {
          const fetchParams = {
            StartTime: startDate,
            EndTime: endDate,
            To: exotelNum, // Fetch calls for this specific Exotel number
            chunkDays: INCOMING_SYNC_CHUNK_DAYS,
          };

          if (filters.from) fetchParams.From = filters.from;

          console.log(
            `📞 Syncing calls for user ${user._id} - Exotel number: ${exotelNum}`
          );

          const exotelCalls = await fetchIncomingCalls(fetchParams);
          totalFetched += exotelCalls.length;

          if (exotelCalls.length > 0) {
            const limitedCalls =
              INCOMING_SYNC_MAX_RECORDS &&
              exotelCalls.length > INCOMING_SYNC_MAX_RECORDS
                ? exotelCalls.slice(0, INCOMING_SYNC_MAX_RECORDS)
                : exotelCalls;

            // Assign calls to the correct user (owner of the Exotel number)
            const result = await upsertIncomingCalls(limitedCalls, user._id);

            totalSynced += result.synced;
            totalCreated += result.created;
            totalUpdated += result.updated;
            totalSkipped += result.skipped;
            totalErrors += result.errors;

            console.log(
              `✅ User ${user._id} - ${exotelNum}: ${result.synced} synced (${result.created} created, ${result.updated} updated)`
            );
          }
        } catch (userSyncError) {
          console.error(
            `❌ Error syncing for user ${user._id} - ${exotelNum}:`,
            userSyncError.message
          );
          totalErrors++;
        }
      }
    }

    console.log(
      `📡 Incoming call background sync finished: ${totalSynced} total synced (${totalCreated} created, ${totalUpdated} updated)`
    );

    return {
      synced: totalSynced,
      created: totalCreated,
      updated: totalUpdated,
      skipped: totalSkipped,
      errors: totalErrors,
      total: totalFetched,
      fetched: totalFetched,
      limited: totalFetched,
    };
  } catch (error) {
    console.error("❌ Incoming call background sync failed:", error.message);
    throw error;
  }
}

function triggerIncomingBackgroundSync({ userId, filters }) {
  const key = INCOMING_SYNC_KEY;
  const existingState = incomingCallSyncState.get(key);
  const now = Date.now();

  if (existingState?.inProgress) {
    return existingState.promise;
  }

  if (
    existingState?.lastRun &&
    now - existingState.lastRun < INCOMING_SYNC_COOLDOWN_MS
  ) {
    return existingState.promise;
  }

  const syncPromise = (async () => {
    try {
      const result = await performIncomingBackgroundSync({ userId, filters });
      incomingCallSyncState.set(key, {
        inProgress: false,
        lastRun: Date.now(),
        lastError: null,
        lastResult: result,
        promise: null,
      });
      return result;
    } catch (error) {
      incomingCallSyncState.set(key, {
        inProgress: false,
        lastRun: Date.now(),
        lastError: error.message,
        lastResult: null,
        promise: null,
      });
      throw error;
    }
  })();

  incomingCallSyncState.set(key, {
    inProgress: true,
    lastRun: existingState?.lastRun || null,
    lastError: existingState?.lastError || null,
    lastResult: existingState?.lastResult || null,
    promise: syncPromise,
  });

  syncPromise.catch(() => {});
  return syncPromise;
}

// Webhook endpoint: POST /api/v1/inbound/calls/sync-exotel
exports.syncExotelWebhook = async (req, res) => {
  try {
    const callData = req.body;

    console.log(
      "📞 Exotel webhook received:",
      JSON.stringify(callData, null, 2)
    );

    // Check if incoming call
    if (!callData || callData.CallType !== "incoming") {
      return res.status(200).send("OK");
    }

    // Get default admin user for webhook (no auth in webhook)
    const userId = await getUserIdObjectId(null);

    // Map Exotel data to our schema
    const mappedData = mapExotelToIncomingCall(callData, userId);

    if (!mappedData.exotelCallSid) {
      return res.status(400).json({
        success: false,
        message: "Missing CallSid in webhook data",
      });
    }

    // Filter out garbage entries where from and to numbers are the same
    const isValidCall = filterValidCalls([mappedData]).length > 0;
    if (!isValidCall) {
      console.log(
        `🗑️ Ignoring garbage call from webhook: ${mappedData.from} -> ${mappedData.to} (same number)`
      );
      return res.status(200).send("OK");
    }

    // Find existing incoming call by exotelCallSid
    const existing = await IncomingCall.findOne({
      exotelCallSid: mappedData.exotelCallSid,
      userId: mappedData.userId,
    });

    let incomingCall;
    let isNew = false;

    if (existing) {
      // Update existing
      Object.assign(existing, mappedData);
      await existing.save();
      incomingCall = existing;
    } else {
      // Create new
      incomingCall = new IncomingCall(mappedData);
      await incomingCall.save();
      isNew = true;
    }

    // Broadcast Socket.IO event
    if (global.io) {
      const eventName = isNew
        ? "incoming_call_created"
        : "incoming_call_updated";
      global.io.emit(eventName, incomingCall);
    }

    // Return 200 OK to Exotel
    res.status(200).send("OK");
  } catch (error) {
    console.error("❌ Error processing Exotel webhook:", error);
    // Still return 200 OK to Exotel to avoid retries
    res.status(200).send("OK");
  }
};

// Get all incoming calls: GET /api/v1/inbound/calls
exports.getIncomingCalls = async (req, res) => {
  try {
    const userId = await getUserIdObjectId(req.user.id);

    const {
      pageno = 1,
      pagesize = 10,
      from,
      to,
      status,
      start_date,
      end_date,
    } = req.query;

    // Build query - Admin sees all calls (no userId filter)
    const query = {};

    if (from) {
      query.from = { $regex: from.replace(/\D/g, ""), $options: "i" };
    }
    if (to) {
      query.to = { $regex: to.replace(/\D/g, ""), $options: "i" };
    }
    if (status) {
      query.status = status;
    }

    // Date filters
    if (start_date || end_date) {
      query.startTime = {};
      if (start_date) {
        query.startTime.$gte = new Date(start_date);
      }
      if (end_date) {
        query.startTime.$lte = new Date(end_date);
      }
    }

    const targetPageSize = parseInt(pagesize, 10) || 10;
    const currentPage = parseInt(pageno, 10) || 1;
    const skip = (currentPage - 1) * targetPageSize;

    const batchSize = targetPageSize * 3;

    const batchCalls = await IncomingCall.find(query)
      .sort({ startTime: -1 })
      .skip(skip)
      .limit(batchSize)
      .lean();

    const validBatchCalls = filterValidCalls(batchCalls);
    let pageValidCalls = validBatchCalls.slice(0, targetPageSize);

    let total = await IncomingCall.countDocuments(query);
    let estimatedValidTotal = total;

    // If results look sparse, enrich from Exotel API (same logic as user controller)
    if (pageValidCalls.length < targetPageSize) {
      console.log("📞 Admin: Enriching results from Exotel API...");

      try {
        const { fetchCallsFromExotel } = require("../services/exotelApi");
        const User = require("../models/User");

        // Get all users with Exotel numbers for admin view
        const usersWithExotel = await User.find({
          exotelNumbers: { $exists: true, $ne: [] },
        })
          .select("exotelNumbers")
          .lean();

        if (usersWithExotel.length > 0) {
          // Prepare date range for Exotel API
          const startDate = start_date
            ? new Date(start_date)
            : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // Last 7 days
          const endDate = end_date ? new Date(end_date) : new Date();

          const allExotelCalls = [];

          // Fetch calls from Exotel for all users' numbers
          for (const user of usersWithExotel) {
            for (const exotelNum of user.exotelNumbers) {
              try {
                const exotelCalls = await fetchCallsFromExotel(
                  exotelNum,
                  startDate,
                  endDate,
                  50 // Limit per number to avoid overwhelming
                );

                if (exotelCalls && exotelCalls.length > 0) {
                  console.log(
                    `📞 Admin: Fetched ${exotelCalls.length} calls from Exotel for ${exotelNum}`
                  );

                  // Map Exotel calls to IncomingCall format - ONLY INBOUND CALLS
                  for (const exotelCall of exotelCalls) {
                    // Filter: Only include inbound calls
                    if (
                      exotelCall.Direction !== "inbound" &&
                      exotelCall.Direction !== "inbound-api"
                    ) {
                      continue; // Skip outbound calls
                    }

                    const mappedCall = mapExotelToIncomingCall(
                      exotelCall,
                      user._id
                    );

                    if (mappedCall && mappedCall.exotelCallSid) {
                      // Check if call is valid (not garbage entry)
                      const isValidCall =
                        filterValidCalls([mappedCall]).length > 0;
                      if (isValidCall) {
                        allExotelCalls.push(mappedCall);
                      }
                    }
                  }
                }
              } catch (exotelError) {
                console.error(
                  `❌ Admin: Error fetching from Exotel for ${exotelNum}:`,
                  exotelError.message
                );
                // Continue with other numbers
              }
            }
          }

          // If we got calls from Exotel, merge them with existing results
          if (allExotelCalls.length > 0) {
            console.log(
              `✅ Admin: Fetched ${allExotelCalls.length} total INBOUND calls from Exotel API`
            );

            // Get existing call IDs to avoid duplicates
            const existingCallSids = new Set(
              pageValidCalls
                .filter((call) => call.exotelCallSid)
                .map((call) => String(call.exotelCallSid))
            );

            // Add new calls that don't already exist
            const newCalls = allExotelCalls.filter(
              (call) => !existingCallSids.has(String(call.exotelCallSid))
            );

            if (newCalls.length > 0) {
              // Merge and sort by start time
              const mergedCalls = [...pageValidCalls, ...newCalls];
              mergedCalls.sort(
                (a, b) =>
                  new Date(b.startTime || b.createdAt) -
                  new Date(a.startTime || a.createdAt)
              );

              // Take only the requested page size
              pageValidCalls = mergedCalls.slice(0, targetPageSize);

              // Update total count
              estimatedValidTotal = Math.max(
                estimatedValidTotal,
                mergedCalls.length
              );
            }
          }
        }
      } catch (enrichmentError) {
        console.error(
          "❌ Admin: Error enriching from Exotel API:",
          enrichmentError.message
        );
        // Continue with existing results if enrichment fails
      }
    }

    const totalPages = Math.max(
      1,
      Math.ceil(estimatedValidTotal / targetPageSize)
    );

    triggerIncomingBackgroundSync({
      userId,
      filters: { from, to, start_date, end_date },
    });

    const syncState = incomingCallSyncState.get(INCOMING_SYNC_KEY);

    res.json({
      success: true,
      data: pageValidCalls,
      pagination: {
        pageno: currentPage,
        pagesize: targetPageSize,
        total: estimatedValidTotal,
        pages: totalPages,
      },
      sync: {
        inProgress: Boolean(syncState?.inProgress),
        lastRunAt: syncState?.lastRun || null,
        lastError: syncState?.lastError || null,
        lastResult: syncState?.lastResult || null,
      },
    });
  } catch (error) {
    console.error("Get Incoming Calls Error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Get single incoming call: GET /api/v1/inbound/calls/:id
exports.getIncomingCall = async (req, res) => {
  try {
    const userId = await getUserIdObjectId(req.user.id);
    const { id } = req.params;

    // Find by ID or exotelCallSid
    const callIdStr = id.toString();
    const isObjectId = /^[0-9a-fA-F]{24}$/.test(callIdStr);

    const incomingCall = await IncomingCall.findOne({
      $or: isObjectId
        ? [
            { _id: id, userId },
            { exotelCallSid: callIdStr, userId },
          ]
        : [{ exotelCallSid: callIdStr, userId }],
    });

    if (!incomingCall) {
      return res.status(404).json({
        success: false,
        message: "Incoming call not found",
      });
    }

    res.json({
      success: true,
      data: incomingCall,
    });
  } catch (error) {
    console.error("Get Incoming Call Error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Sync incoming calls from Exotel: POST /api/v1/inbound/calls/sync
exports.syncIncomingCallsFromExotel = async (req, res) => {
  try {
    const userId = await getUserIdObjectId(req.user.id);

    const { start_date, end_date, from, to } = req.query;

    triggerIncomingBackgroundSync({
      userId,
      filters: { from, to, start_date, end_date },
    });

    const syncState = incomingCallSyncState.get(INCOMING_SYNC_KEY);

    res.json({
      success: true,
      message: syncState?.inProgress
        ? "Sync already in progress"
        : "Sync started",
      sync: {
        inProgress: Boolean(syncState?.inProgress),
        lastRunAt: syncState?.lastRun || null,
        lastError: syncState?.lastError || null,
        lastResult: syncState?.lastResult || null,
      },
    });
  } catch (error) {
    console.error("Sync Incoming Calls Error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Get statistics: GET /api/v1/inbound/calls/stats
exports.getIncomingCallStats = async (req, res) => {
  try {
    const userId = await getUserIdObjectId(req.user.id);
    const { start_date, end_date } = req.query;

    // Build date filter
    const dateFilter = {};
    if (start_date || end_date) {
      dateFilter.startTime = {};
      if (start_date) {
        dateFilter.startTime.$gte = new Date(start_date);
      }
      if (end_date) {
        dateFilter.startTime.$lte = new Date(end_date);
      }
    }

    const query = { userId, ...dateFilter };

    // Calculate statistics
    const totalCalls = await IncomingCall.countDocuments(query);

    // Count calls with valid recording URL (truthy, non-empty string)
    // This matches frontend logic: call.recordingUrl is truthy
    const answeredCalls = await IncomingCall.countDocuments({
      ...query,
      $and: [
        { recordingUrl: { $exists: true } },
        { recordingUrl: { $ne: null } },
        { recordingUrl: { $ne: "" } },
        { recordingUrl: { $type: "string" } },
        { recordingUrl: { $regex: /^https?:\/\// } }, // Must be a valid URL
      ],
    });

    // Count missed calls directly (calls without valid recording URL)
    // This matches frontend logic: !call.recordingUrl
    const missedCalls = await IncomingCall.countDocuments({
      ...query,
      $or: [
        { recordingUrl: { $exists: false } },
        { recordingUrl: null },
        { recordingUrl: "" },
        { recordingUrl: { $not: { $type: "string" } } },
        { recordingUrl: { $not: { $regex: /^https?:\/\// } } },
      ],
    });

    const completedCalls = await IncomingCall.countDocuments({
      ...query,
      status: "completed",
    });

    const totalDuration = await IncomingCall.aggregate([
      { $match: query },
      { $group: { _id: null, total: { $sum: "$duration" } } },
    ]);

    // With Recordings = same as Answered (calls with recording)
    const callsWithRecordings = answeredCalls;

    const avgDuration = await IncomingCall.aggregate([
      { $match: { ...query, duration: { $gt: 0 } } },
      { $group: { _id: null, avg: { $avg: "$duration" } } },
    ]);

    res.json({
      success: true,
      data: {
        totalCalls,
        answeredCalls,
        completedCalls,
        missedCalls,
        totalDuration: totalDuration[0]?.total || 0,
        avgDuration: avgDuration[0]?.avg || 0,
        callsWithRecordings,
      },
    });
  } catch (error) {
    console.error("Get Incoming Call Stats Error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Delete incoming call: DELETE /api/v1/inbound/calls/:id
exports.deleteIncomingCall = async (req, res) => {
  try {
    const userId = await getUserIdObjectId(req.user.id);
    const { id } = req.params;

    // Find by ID or exotelCallSid
    const callIdStr = id.toString();
    const isObjectId = /^[0-9a-fA-F]{24}$/.test(callIdStr);

    const incomingCall = await IncomingCall.findOne({
      $or: isObjectId
        ? [
            { _id: id, userId },
            { exotelCallSid: callIdStr, userId },
          ]
        : [{ exotelCallSid: callIdStr, userId }],
    });

    if (!incomingCall) {
      return res.status(404).json({
        success: false,
        message: "Incoming call not found",
      });
    }

    await IncomingCall.findByIdAndDelete(incomingCall._id);

    // Broadcast Socket.IO event
    if (global.io) {
      global.io.emit("incoming_call_deleted", { id: incomingCall._id });
      console.log("📡 Broadcasted: incoming_call_deleted");
    }

    res.json({
      success: true,
      message: "Incoming call deleted successfully",
    });
  } catch (error) {
    console.error("Delete Incoming Call Error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Get recording: GET /api/v1/inbound/calls/recording/:id
exports.getRecording = async (req, res) => {
  try {
    const userId = await getUserIdObjectId(req.user.id);
    const { id } = req.params;

    const incomingCall = await IncomingCall.findOne({
      _id: id,
      userId: userId,
    });

    if (!incomingCall) {
      return res.status(404).json({
        success: false,
        message: "Incoming call not found",
      });
    }

    if (!incomingCall.recordingUrl) {
      return res.status(404).json({
        success: false,
        message: "Recording not available for this call",
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
      const response = await axios.get(incomingCall.recordingUrl, {
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
      console.error("Error proxying recording:", proxyError.message);
      res.status(500).json({
        success: false,
        message: "Failed to fetch recording from Exotel",
        error: proxyError.message,
      });
    }
  } catch (error) {
    console.error("Get Recording Error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Download recording as MP3: GET /api/v1/inbound/calls/recording/:id/download
exports.downloadRecording = async (req, res) => {
  try {
    const userId = await getUserIdObjectId(req.user.id);
    const { id } = req.params;

    const incomingCall = await IncomingCall.findOne({
      _id: id,
      userId: userId,
    });

    if (!incomingCall) {
      return res.status(404).json({
        success: false,
        message: "Incoming call not found",
      });
    }

    if (!incomingCall.recordingUrl) {
      return res.status(404).json({
        success: false,
        message: "Recording not available for this call",
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
      const response = await axios.get(incomingCall.recordingUrl, {
        headers: {
          Authorization: `Basic ${auth}`,
        },
        responseType: "stream",
      });

      // Generate filename from call details
      const timestamp = incomingCall.startTime
        ? new Date(incomingCall.startTime).toISOString().replace(/[:.]/g, "-")
        : new Date().toISOString().replace(/[:.]/g, "-");
      const filename = `recording-${incomingCall.from || "unknown"}-${
        incomingCall.to || "unknown"
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
      console.error("Error downloading recording:", proxyError.message);
      res.status(500).json({
        success: false,
        message: "Failed to download recording from Exotel",
        error: proxyError.message,
      });
    }
  } catch (error) {
    console.error("Download Recording Error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};
