const IncomingCall = require("../../models/IncomingCall");
const User = require("../../models/User");
const mongoose = require("mongoose");
const { fetchCallsFromExotel } = require("../../services/exotelApi");
const config = require("../../config/env.js");

/**
 * Normalize phone number for matching
 * Removes +, spaces, dashes, leading 0, and country code variations
 */
function normalizePhoneNumber(phone) {
  if (!phone) return "";

  // Convert to string and remove all non-digit characters except +
  let normalized = String(phone).replace(/[\s\-()]/g, "");

  // Remove leading +
  normalized = normalized.replace(/^\+/, "");

  // Remove leading 0 (for Indian numbers like 07948516111 -> 7948516111)
  if (normalized.startsWith("0")) {
    normalized = normalized.substring(1);
  }

  // If starts with 91 (India country code), remove it
  if (normalized.startsWith("91") && normalized.length > 10) {
    normalized = normalized.substring(2);
  }

  // Also try without country code
  return normalized;
}

/**
 * Get all variations of a phone number for matching
 */
function getPhoneNumberVariations(phone) {
  if (!phone) return [];

  const variations = new Set();
  const normalized = normalizePhoneNumber(phone);

  // Original
  variations.add(String(phone).trim());

  // Normalized
  variations.add(normalized);

  // With leading 0
  if (!normalized.startsWith("0")) {
    variations.add("0" + normalized);
  }

  // With +91
  variations.add("+91" + normalized);

  // With 91
  variations.add("91" + normalized);

  // With +91 and leading 0
  variations.add("+910" + normalized);
  variations.add("910" + normalized);

  return Array.from(variations).filter((v) => v.length > 0);
}

/**
 * Determine if an incoming call entry is valid by comparing caller and target numbers
 */
function isValidIncomingCallEntry(fromNumber, toNumber) {
  const normalizedFrom = normalizePhoneNumber(fromNumber);
  const normalizedTo = normalizePhoneNumber(toNumber);

  if (!normalizedFrom || !normalizedTo) {
    return true;
  }

  return normalizedFrom !== normalizedTo;
}

/**
 * Resolve Exotel caller/target numbers handling swapped labels
 */
function resolveExotelNumbers(exotelCall, exotelNum) {
  const defaultNormalized = normalizePhoneNumber(exotelNum);

  const potentialDIDs = [
    exotelCall.VirtualNumber,
    exotelCall.DialWhomNumber,
    exotelCall.ForwardedTo,
    exotelCall.CalledNumber,
    exotelCall.CustomerToNumber,
    exotelCall.ConnectedToNumber,
    exotelCall.To,
    exotelNum,
  ].filter(Boolean);

  const potentialCallers = [
    exotelCall.PhoneNumber,
    exotelCall.From,
    exotelCall.CallerNumber,
    exotelCall.CallerId,
    exotelCall.CustomerNumber,
    exotelCall.ContactNumber,
    exotelCall.ClientNumber,
    exotelCall.To,
  ].filter(Boolean);

  let resolvedToNumber = null;
  for (const candidate of potentialDIDs) {
    if (normalizePhoneNumber(candidate) === defaultNormalized) {
      resolvedToNumber = candidate;
      break;
    }
  }

  if (!resolvedToNumber && potentialDIDs.length > 0) {
    resolvedToNumber = potentialDIDs[0];
  }

  let resolvedPhoneNumber = null;
  for (const candidate of potentialCallers) {
    const normalizedCandidate = normalizePhoneNumber(candidate);
    if (
      normalizedCandidate &&
      normalizedCandidate.length > 0 &&
      normalizedCandidate !== defaultNormalized
    ) {
      resolvedPhoneNumber = candidate;
      break;
    }
  }

  if (!resolvedPhoneNumber) {
    resolvedPhoneNumber =
      exotelCall.PhoneNumber ||
      exotelCall.From ||
      exotelCall.CallerNumber ||
      exotelCall.To ||
      exotelNum;
  }

  // Prevent identical values if both resolved to same number
  if (
    normalizePhoneNumber(resolvedPhoneNumber) ===
    normalizePhoneNumber(resolvedToNumber)
  ) {
    resolvedPhoneNumber =
      exotelCall.PhoneNumber ||
      exotelCall.From ||
      exotelCall.CallerNumber ||
      resolvedPhoneNumber;
  }

  return {
    phoneNumber: resolvedPhoneNumber,
    toNumber: resolvedToNumber || exotelNum,
  };
}

function mapIncomingCallToResponse(incomingCallDoc) {
  return {
    _id: incomingCallDoc._id,
    omnidimensionId: incomingCallDoc.exotelCallSid,
    userId: incomingCallDoc.userId,
    source: incomingCallDoc.from || "Exotel",
    phoneNumber: incomingCallDoc.to || "",
    toNumber: incomingCallDoc.to || "",
    duration: incomingCallDoc.duration || 0,
    callType: "Call",
    cqsScore: 0,
    status: incomingCallDoc.status || "completed",
    cost: incomingCallDoc.cost || 0,
    recordingUrl: incomingCallDoc.recordingUrl || null,
    transcript: null,
    agentUsed: null,
    createdAt: incomingCallDoc.startTime || incomingCallDoc.createdAt,
    startTime: incomingCallDoc.startTime,
    endTime: incomingCallDoc.endTime,
    metadata: incomingCallDoc.metadata || {},
  };
}

/**
 * Get user's call logs (filtered by Exotel numbers)
 * GET /api/user/calls/logs
 */
exports.getUserCallLogs = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      pageno = 1,
      pagesize = 100,
      call_status,
      start_date,
      end_date,
    } = req.query;

    // Get user's Exotel numbers
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const exotelNumbers = user.exotelNumbers || [];

    console.log("👤 User ID:", userId);
    console.log("📞 User Exotel Numbers:", exotelNumbers);

    // Debug: Check what's in the database
    const totalCallsInDB = await IncomingCall.countDocuments({});
    const distinctUserIds = await IncomingCall.distinct("userId");
    const distinctToNumbers = await IncomingCall.distinct("to");
    console.log(
      `🔍 DEBUG - Total calls in DB: ${totalCallsInDB}, Distinct users: ${distinctUserIds.length}`
    );
    console.log(`🔍 DEBUG - Distinct userIds:`, distinctUserIds);
    console.log(`🔍 DEBUG - Distinct 'to' numbers in DB:`, distinctToNumbers);

    // Check if user's assigned number matches any calls in DB
    const userHasMatchingCalls = await IncomingCall.countDocuments({
      to: { $in: exotelNumbers },
    });
    console.log(
      `🔍 DEBUG - Calls matching user's assigned numbers: ${userHasMatchingCalls}`
    );

    // If user has no Exotel numbers, return empty result
    if (exotelNumbers.length === 0) {
      console.log("⚠️  User has no Exotel numbers assigned");
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

    // Get all variations of Exotel numbers for matching
    const allPhoneVariations = [];
    for (const exotelNum of exotelNumbers) {
      const variations = getPhoneNumberVariations(exotelNum);
      allPhoneVariations.push(...variations);
    }

    console.log("📞 Phone number variations for matching:", allPhoneVariations);

    const phoneMatchValues = Array.from(new Set(allPhoneVariations)).filter(
      (val) => val && val.length > 0
    );

    const query = {};

    if (phoneMatchValues.length > 0) {
      query.to = { $in: phoneMatchValues };
    }

    // Add status filter if provided
    if (call_status) {
      query.status = call_status;
    }

    // Add date range filter if provided
    if (start_date || end_date) {
      query.startTime = {};
      if (start_date) {
        query.startTime.$gte = new Date(start_date);
      }
      if (end_date) {
        query.startTime.$lte = new Date(end_date);
      }
    }

    console.log("🔍 Incoming call query:", JSON.stringify(query, null, 2));

    // Debug: Check if there are any calls that match the phone numbers
    if (phoneMatchValues.length > 0) {
      const sampleCalls = await IncomingCall.find({})
        .limit(5)
        .select("userId from to");
      console.log(`🔍 DEBUG - Sample calls in DB:`, sampleCalls);

      // Check if any calls match the phone variations
      const matchingCalls = await IncomingCall.find({
        to: { $in: phoneMatchValues },
      })
        .limit(3)
        .select("userId from to");
      console.log(`🔍 DEBUG - Calls matching phone variations:`, matchingCalls);
    }

    // Calculate pagination
    const skip = (parseInt(pageno) - 1) * parseInt(pagesize);
    const limit = parseInt(pagesize);

    // Get total count
    let total = await IncomingCall.countDocuments(query);
    console.log("📊 Total incoming calls found:", total);

    // Get call logs from database
    const incomingCalls = await IncomingCall.find(query)
      .sort({ startTime: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const validIncomingCalls = incomingCalls.filter((call) =>
      isValidIncomingCallEntry(call.from, call.to)
    );

    let callLogs = validIncomingCalls.map(mapIncomingCallToResponse);

    console.log("📋 Incoming calls fetched from database:", callLogs.length);

    // If results look sparse, top up from Exotel API
    if (callLogs.length < limit && exotelNumbers.length > 0) {
      console.log("📞 Enriching results from Exotel API...");

      try {
        // Prepare date range for Exotel API
        const startDate = start_date
          ? new Date(start_date)
          : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // Last 30 days
        const endDate = end_date ? new Date(end_date) : new Date();

        // Fetch calls from Exotel for each Exotel number
        const allExotelCalls = [];
        for (const exotelNum of exotelNumbers) {
          const exotelCalls = await fetchCallsFromExotel(
            exotelNum,
            startDate,
            endDate,
            100
          );
          if (exotelCalls && exotelCalls.length > 0) {
            console.log(
              `📞 Fetched ${exotelCalls.length} calls from Exotel for ${exotelNum}`
            );

            // Map Exotel calls to CallLog format - ONLY INBOUND CALLS
            for (const exotelCall of exotelCalls) {
              // Filter: Only include inbound calls (incoming calls)
              if (
                exotelCall.Direction !== "inbound" &&
                exotelCall.Direction !== "inbound-api"
              ) {
                continue; // Skip outbound calls
              }

              // Log Exotel call structure for debugging
              if (exotelCalls.indexOf(exotelCall) === 0) {
                console.log(
                  "📋 Sample Exotel call structure:",
                  JSON.stringify(exotelCall, null, 2)
                );
              }

              // Determine recording URL - use direct Exotel URL (same as incoming calls controller)
              // Store direct URL, frontend will use proxy endpoint when accessing
              let recordingUrl = null;

              if (exotelCall.RecordingUrl) {
                // Use direct Exotel RecordingUrl (same as incoming calls controller)
                recordingUrl = exotelCall.RecordingUrl;
                console.log("📹 Using direct RecordingUrl:", recordingUrl);
              } else if (exotelCall.RecordingSid) {
                // Construct direct Exotel URL from RecordingSid (same as incoming calls controller)
                recordingUrl = `https://${config.exotel.subdomain}.exotel.com/v1/Accounts/${config.exotel.accountSid}/Recordings/${exotelCall.RecordingSid}.mp3`;
                console.log(
                  "📹 Constructed direct Exotel URL from RecordingSid:",
                  recordingUrl
                );
              }

              // Since we're only processing inbound calls, set callType to "Inbound"
              const callType = "Inbound";

              // Determine cost (Exotel uses Price field)
              const cost = exotelCall.Price
                ? parseFloat(exotelCall.Price)
                : exotelCall.Cost
                ? parseFloat(exotelCall.Cost)
                : 0;

              const resolvedNumbers = resolveExotelNumbers(
                exotelCall,
                exotelNum
              );

              const mappedCall = {
                userId: new mongoose.Types.ObjectId(userId),
                omnidimensionId: exotelCall.CallSid || exotelCall.Sid || null,
                source:
                  resolvedNumbers.phoneNumber ||
                  exotelCall.PhoneNumber ||
                  exotelCall.From ||
                  "Exotel",
                toNumber: resolvedNumbers.toNumber,
                phoneNumber: resolvedNumbers.phoneNumber,
                duration: exotelCall.Duration
                  ? parseInt(exotelCall.Duration)
                  : 0,
                callType: callType,
                cqsScore: 0, // Exotel doesn't provide CQS score
                status:
                  exotelCall.Status === "completed"
                    ? "completed"
                    : exotelCall.Status === "busy"
                    ? "busy"
                    : exotelCall.Status === "failed"
                    ? "failed"
                    : "completed",
                cost: cost,
                recordingUrl: recordingUrl,
                transcript: null, // Exotel doesn't provide transcript in list response - would need to fetch separately per call
                agentUsed: null, // Exotel doesn't provide agent/voice assistant info - only available from OmniDimension
                createdAt: exotelCall.DateCreated
                  ? new Date(exotelCall.DateCreated)
                  : exotelCall.StartTime
                  ? new Date(exotelCall.StartTime)
                  : new Date(),
                syncedAt: new Date(),
                lastSynced: new Date(),
                syncStatus: "synced",
              };

              if (
                !isValidIncomingCallEntry(
                  mappedCall.source,
                  mappedCall.phoneNumber || mappedCall.toNumber
                )
              ) {
                continue;
              }

              allExotelCalls.push(mappedCall);
            }
          }
        }

        // If we got calls from Exotel, merge them
        if (allExotelCalls.length > 0) {
          console.log(
            `✅ Fetched ${allExotelCalls.length} total INBOUND calls from Exotel API`
          );

          const existingIds = new Set(
            callLogs
              .filter((log) => !!log.omnidimensionId)
              .map((log) => String(log.omnidimensionId))
          );

          const mergedCalls = [...callLogs];
          for (const exotelCall of allExotelCalls) {
            const exotelId = exotelCall.omnidimensionId
              ? String(exotelCall.omnidimensionId)
              : null;
            if (exotelId && existingIds.has(exotelId)) {
              continue;
            }
            mergedCalls.push(exotelCall);
          }

          const filteredMergedCalls = mergedCalls.filter((call) =>
            isValidIncomingCallEntry(
              call.source || call.from,
              call.phoneNumber || call.toNumber || call.to
            )
          );

          filteredMergedCalls.sort(
            (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
          );

          const paginatedCalls = filteredMergedCalls.slice(0, limit);

          // Update total count to reflect merged set
          total = Math.max(total, filteredMergedCalls.length);

          callLogs = paginatedCalls;
        }
      } catch (exotelError) {
        console.error("❌ Error fetching from Exotel API:", exotelError);
        // Continue with empty results if Exotel fetch fails
      }
    }

    // Calculate pages
    const pages = Math.ceil(total / limit);
    const totalValidCalls = callLogs.length;

    res.json({
      success: true,
      data: callLogs,
      pagination: {
        pageno: parseInt(pageno),
        pagesize: parseInt(pagesize),
        total,
        pages,
      },
      stats: {
        totalCalls: total,
        completedCalls: callLogs.filter((call) => call.status === "completed")
          .length,
        totalMinutes: callLogs.reduce((acc, call) => acc + (call.duration || 0), 0),
      },
    });
  } catch (error) {
    console.error("Get User Call Logs Error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

/**
 * Get single call log details
 * GET /api/user/calls/logs/:id
 */
exports.getUserCallLog = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    // Get user's Exotel numbers
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const exotelNumbers = user.exotelNumbers || [];

    // Find call log
    const callLog = await IncomingCall.findById(id).lean();

    if (!callLog) {
      return res.status(404).json({
        success: false,
        message: "Call log not found",
      });
    }

    // Verify call log belongs to user's Exotel numbers
    const allowedNumbers = new Set();
    for (const num of exotelNumbers) {
      const variations = getPhoneNumberVariations(num).map((v) =>
        normalizePhoneNumber(v)
      );
      variations.forEach((v) => allowedNumbers.add(v));
    }

    const callTargets = [];
    if (callLog.to) {
      callTargets.push(...getPhoneNumberVariations(callLog.to));
    }

    const matchesAssignedNumber = callTargets.some((candidate) =>
      allowedNumbers.has(normalizePhoneNumber(candidate))
    );

    if (!matchesAssignedNumber) {
      return res.status(403).json({
        success: false,
        message:
          "Access denied. This call log does not belong to your assigned numbers.",
      });
    }

    res.json({
      success: true,
      data: mapIncomingCallToResponse(callLog),
    });
  } catch (error) {
    console.error("Get User Call Log Error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

/**
 * Get recording for a user's call log
 * GET /api/user/calls/logs/:id/recording
 */
exports.getUserCallLogRecording = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { recordingUrl: recordingUrlParam } = req.query; // Get recordingUrl from query params

    let callLog = null;
    let recordingUrl = recordingUrlParam || null; // Use recordingUrl from query if provided

    // If recordingUrl not provided in query, try to find in database
    if (!recordingUrl) {
      // Check if id is a valid MongoDB ObjectId
      if (mongoose.Types.ObjectId.isValid(id)) {
        callLog = await IncomingCall.findById(id);

        if (callLog && callLog.recordingUrl) {
          recordingUrl = callLog.recordingUrl;
        }
      } else {
        callLog = await IncomingCall.findOne({
          exotelCallSid: id,
        });

        if (callLog && callLog.recordingUrl) {
          recordingUrl = callLog.recordingUrl;
        }
      }
    }

    if (!recordingUrl) {
      return res.status(404).json({
        success: false,
        message: "Recording not available for this call",
      });
    }

    // Proxy the Exotel recording with authentication (same as incoming calls controller)
    const axios = require("axios");

    if (!config.exotel.apiKey || !config.exotel.apiToken) {
      return res.status(500).json({
        success: false,
        message: "Exotel credentials not configured",
      });
    }

    try {
      const response = await axios.get(recordingUrl, {
        auth: {
          username: config.exotel.apiKey,
          password: config.exotel.apiToken,
        },
        responseType: "stream",
        timeout: 30000,
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
      message: "Failed to get recording",
      error: error.message,
    });
  }
};

/**
 * Get user's call statistics
 * GET /api/user/calls/logs/stats
 */
exports.getUserCallLogStats = async (req, res) => {
  try {
    const userId = req.user.id;
    const { start_date, end_date, call_status } = req.query;

    // Get user's Exotel numbers
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const exotelNumbers = user.exotelNumbers || [];

    // If user has no Exotel numbers, return empty stats
    if (exotelNumbers.length === 0) {
      return res.json({
        success: true,
        data: {
          totalCalls: 0,
          completedCalls: 0,
          totalMinutes: 0,
          avgCqsScore: 0,
          totalCost: 0,
        },
      });
    }

    // Build query
    const statsVariationsSet = new Set();
    for (const exotelNum of exotelNumbers) {
      getPhoneNumberVariations(exotelNum).forEach((variant) =>
        statsVariationsSet.add(variant)
      );
    }

    const statsVariations = Array.from(statsVariationsSet);

    const query = {
      to: { $in: statsVariations },
    };

    if (call_status) {
      query.status = call_status;
    }

    // Add date range filter if provided
    if (start_date || end_date) {
      query.startTime = {};
      if (start_date) {
        query.startTime.$gte = new Date(start_date);
      }
      if (end_date) {
        query.startTime.$lte = new Date(end_date);
      }
    }

    // Calculate statistics using application logic to keep parity with filtering rules
    const matchedCalls = await IncomingCall.find(query)
      .select("from to status duration cost cqsScore")
      .lean();

    const validCalls = matchedCalls.filter((call) =>
      isValidIncomingCallEntry(call.from, call.to)
    );

    const totalCalls = validCalls.length;
    const completedCalls = validCalls.filter(
      (call) => call.status === "completed"
    ).length;
    const totalDurationSeconds = validCalls.reduce(
      (sum, call) => sum + (call.duration || 0),
      0
    );
    const totalCost = validCalls.reduce(
      (sum, call) => sum + (call.cost || 0),
      0
    );
    const { totalCqsScore, callsWithCqs } = validCalls.reduce(
      (acc, call) => {
        const score = call.cqsScore || 0;
        return {
          totalCqsScore: acc.totalCqsScore + score,
          callsWithCqs: acc.callsWithCqs + (score > 0 ? 1 : 0),
        };
      },
      { totalCqsScore: 0, callsWithCqs: 0 }
    );
    const avgCqsScore =
      callsWithCqs > 0 ? totalCqsScore / callsWithCqs : 0;

    res.json({
      success: true,
      data: {
        totalCalls,
        completedCalls,
        totalMinutes: Math.round((totalDurationSeconds / 60) * 10) / 10,
        avgCqsScore: Math.round(avgCqsScore * 100) / 100,
        totalCost: Math.round(totalCost * 1000) / 1000,
      },
    });
  } catch (error) {
    console.error("Get User Call Log Stats Error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};
