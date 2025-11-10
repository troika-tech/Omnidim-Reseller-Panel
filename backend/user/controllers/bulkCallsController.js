const BulkCall = require("../../models/BulkCall");
const BulkCallLine = require("../../models/BulkCallLine");
const BulkCallActivityLog = require("../../models/BulkCallActivityLog");
const User = require("../../models/User");
const VoiceAssistant = require("../../models/VoiceAssistant");
const PhoneNumber = require("../../models/PhoneNumber");
const mongoose = require("mongoose");
const {
  fetchFromOmnidimension,
  syncToOmnidimension,
} = require("../../services/omniApi");
const axios = require("axios");
const config = require("../../config/env");
const multer = require("multer");
const csv = require("csv-parser");
const fs = require("fs");
const path = require("path");
const {
  syncBulkCallLinesFromLogs,
} = require("../../services/bulkCallLineSync");

const USER_CACHE_EXCLUDED_STATUSES = ["active"];

// Helper function to sync bulk calls from OMNIDIMENSION to local database (user version)
async function syncUserBulkCallsFromOmnidimension(omniBulkCalls, userId) {
  let syncedCount = 0;
  let createdCount = 0;
  let updatedCount = 0;

  if (!Array.isArray(omniBulkCalls)) {
    console.error("⚠️  Omni bulk calls is not an array:", omniBulkCalls);
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
        console.error("⚠️  Skipping bulk call: missing id", bulkCallData);
        continue;
      }

      const omniId = (
        bulkCallData.id ||
        bulkCallData.bulk_call_id ||
        bulkCallData.campaign_id
      ).toString();

      const existing = await BulkCall.findOne({
        omnidimensionId: omniId,
        userId,
      });

      // Map OMNIDIMENSION API fields to our schema
      const totalCalls =
        bulkCallData.total_calls_to_dispatch ||
        bulkCallData.total_calls_target ||
        bulkCallData.total_count ||
        0;
      const totalCallsMade =
        bulkCallData.total_calls_made ||
        bulkCallData.total_calls ||
        bulkCallData.calls_made ||
        bulkCallData.total_dialed_calls ||
        0;
      const callsPickedUp =
        bulkCallData.calls_picked_up || bulkCallData.picked_up_calls || 0;
      const highEngagementCalls =
        bulkCallData.high_engagement_calls ||
        bulkCallData.completed_calls ||
        callsPickedUp ||
        0;

      const statusValue =
        bulkCallData.status || bulkCallData.campaign_status || "pending";
      const statusLower = statusValue ? statusValue.toLowerCase() : "";
      const shouldCache =
        statusLower && !USER_CACHE_EXCLUDED_STATUSES.includes(statusLower);
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
        totalCalls,
        totalCallsMade,
        callsPickedUp,
        completedCalls: highEngagementCalls,
        highEngagementCalls,
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
          completed: highEngagementCalls,
          percentage:
            totalCalls > 0
              ? ((highEngagementCalls || 0) / totalCalls) * 100
              : 0,
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
      if (
        bulkCallData.phone_numbers &&
        Array.isArray(bulkCallData.phone_numbers)
      ) {
        mappedData.phoneNumbers = bulkCallData.phone_numbers;
      } else if (
        bulkCallData.contact_list &&
        Array.isArray(bulkCallData.contact_list)
      ) {
        // Extract phone numbers from contact list
        const phoneNumbers = bulkCallData.contact_list
          .map(
            (contact) =>
              contact.to_number || contact.phone_number || contact.number
          )
          .filter((num) => num && typeof num === "string")
          .map((num) => (num.startsWith("+") ? num : `+91${num}`)); // Normalize format
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
      if (bulkCallData.create_date) {
        // Parse MM/DD/YYYY HH:MM:SS format
        const dateParts = bulkCallData.create_date.split(" ");
        if (dateParts.length === 2) {
          const datePart = dateParts[0].split("/");
          const timePart = dateParts[1].split(":");
          if (datePart.length === 3 && timePart.length === 3) {
            const year = parseInt(datePart[2]);
            const month = parseInt(datePart[0]) - 1;
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

      // Extract phone numbers from OMNIDIMENSION response (same as Before version)
      let extractedPhoneNumbers = [];
      if (
        bulkCallData.contact_list &&
        Array.isArray(bulkCallData.contact_list) &&
        bulkCallData.contact_list.length > 0
      ) {
        // Extract from contact_list array
        extractedPhoneNumbers = bulkCallData.contact_list
          .map(
            (contact) =>
              contact.phone_number ||
              contact.phone ||
              contact.to_number ||
              (typeof contact === "string" ? contact : null)
          )
          .filter(Boolean);
      } else if (
        bulkCallData.phone_numbers &&
        Array.isArray(bulkCallData.phone_numbers) &&
        bulkCallData.phone_numbers.length > 0
      ) {
        // Extract from phone_numbers array
        extractedPhoneNumbers = bulkCallData.phone_numbers.filter(Boolean);
      }

      // Add extracted phone numbers to mapped data
      if (extractedPhoneNumbers.length > 0) {
        mappedData.phoneNumbers = extractedPhoneNumbers;
 
      }

      if (shouldCache) {
        mappedData.cachedAt = new Date();
      }

      let savedCampaign;
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
        savedCampaign = existing;
        updatedCount++;
        syncedCount++;
      } else {
        // Create new record only if shouldCache is true
        if (shouldCache) {
          try {
            const newBulkCall = new BulkCall({
              userId,
              ...mappedData,
              syncedAt: new Date(),
            });
            await newBulkCall.save();
            savedCampaign = newBulkCall;
            createdCount++;
            syncedCount++;
          } catch (duplicateError) {
            if (duplicateError.code === 11000) {
       
              const existingDuplicate = await BulkCall.findOne({
                omnidimensionId: omniId,
              });
              if (existingDuplicate) {
                Object.assign(existingDuplicate, mappedData);
                if (!shouldCache) {
                  existingDuplicate.cachedAt = undefined;
                } else {
                  existingDuplicate.cachedAt = mappedData.cachedAt;
                }
                await existingDuplicate.save();
                savedCampaign = existingDuplicate;
                updatedCount++;
                syncedCount++;
              } else {
                throw duplicateError;
              }
            } else {
              throw duplicateError;
            }
          }
        } else {

        }
      }


      if (bulkCallData.contact_list && bulkCallData.contact_list.length > 0) {
      }

      // Sync call lines from contact_list if available and campaign should be cached
      if (
        savedCampaign &&
        bulkCallData.contact_list &&
        Array.isArray(bulkCallData.contact_list) &&
        bulkCallData.contact_list.length > 0
      ) {
        // Skip call line sync for cached statuses (non-active campaigns)
        const shouldSkipCallLineSync =
          statusLower && !USER_CACHE_EXCLUDED_STATUSES.includes(statusLower);

        if (shouldSkipCallLineSync) {
       
        } else {
          
          await syncUserCallLinesFromOmnidimension(
            bulkCallData.contact_list,
            savedCampaign._id,
            userId
          ).catch((err) => {
            console.error("⚠️  Error syncing call lines:", err.message);
          });
        }
      } else {
      
      }
    } catch (error) {
      console.error("⚠️  Error syncing bulk call:", error.message);
    }
  }

 
  return { syncedCount, createdCount, updatedCount };
}

// Helper function to sync call lines from contact_list (user version, same as Before)
async function syncUserCallLinesFromOmnidimension(
  contactList,
  bulkCallId,
  userId
) {
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
        contact.to_number ||
        contact.phone_number ||
        contact.phone ||
        contact.number;
      if (!toNumber) continue;

      const existing = await BulkCallLine.findOne({
        bulkCallId,
        toNumber,
      });

      // Parse call date - prioritize contact data
      let callDate = new Date();
      if (contact.call_date) {
        const parsedDate = new Date(contact.call_date);
        if (!isNaN(parsedDate.getTime())) {
          callDate = parsedDate;
        }
      } else if (contact.created_at) {
        const parsedDate = new Date(contact.created_at);
        if (!isNaN(parsedDate.getTime())) {
          callDate = parsedDate;
        }
      }

      // Get recording URL directly from contact data (OMNIDIMENSION)
      let recordingUrl = contact.recording_url || contact.recordingUrl;
      let recordingAvailable = !!(recordingUrl && recordingUrl !== false);

      // Get transcript DIRECTLY from OMNIDIMENSION contact data (not from CallLog)
      // This ensures each call line gets its unique transcript
      let transcript =
        contact.call_conversation ||
        contact.transcript ||
        contact.call_transcript ||
        contact.conversation ||
        contact.transcription ||
        null;

      // If transcript is an array (from Omni API), join it
      if (Array.isArray(transcript)) {
        transcript = transcript
          .map((t) =>
            typeof t === "string" ? t : t.text || t.message || JSON.stringify(t)
          )
          .join("\n");
      }

      // Parse duration properly - handle formats like "0:17", "00:21", etc.
      let parsedDuration = 0;
      const durationStr = contact.call_duration || contact.duration || "0";
      if (typeof durationStr === "string" && durationStr.includes(":")) {
        const parts = durationStr.split(":");
        if (parts.length === 2) {
          parsedDuration = parseInt(parts[0]) * 60 + parseInt(parts[1]);
        }
      } else {
        parsedDuration =
          contact.call_duration_in_seconds || parseInt(durationStr) || 0;
      }

      const lineData = {
        toNumber,
        callDate: callDate,
        callStatus: contact.call_status || contact.status || "pending",
        interaction: transcript
          ? "completed"
          : contact.interaction || "no_interaction",
        duration: parsedDuration,
        transcript: transcript,
        recording: {
          available: recordingAvailable,
          url: recordingUrl || undefined,
        },
        metadata: {
          p50Latency: contact.p50_latency || 0,
          p99Latency: contact.p99_latency || 0,
          cqsScore: contact.cqs_score || contact.quality_score || 0,
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
      console.error(
        `⚠️  Error syncing call line for ${
          contact.to_number || contact.phone_number
        }:`,
        error.message
      );
    }
  }

  const updatedPhoneNumbers = Array.from(phoneNumbersSet);
  if (bulkCall && updatedPhoneNumbers.length > 0) {
    const numbersChanged =
      updatedPhoneNumbers.length !== existingPhoneNumbers.length ||
      updatedPhoneNumbers.some((num) => !existingPhoneNumbers.includes(num));

    if (numbersChanged) {
      try {
        await BulkCall.updateOne(
          { _id: bulkCall._id },
          {
            $addToSet: {
              phoneNumbers: { $each: updatedPhoneNumbers },
            },
          }
        );
      } catch (updateError) {
        console.error(
          `⚠️  Failed to update phoneNumbers for bulk call ${bulkCallId}:`,
          updateError.message
        );
      }
    }
  }


  return { syncedCount };
}

/**
 * Get user's bulk call campaigns
 * GET /api/user/calls/bulk_call
 */
exports.getUserBulkCalls = async (req, res) => {
  try {
    const userId = req.user.id;
    const { pageno = 1, pagesize = 10, status } = req.query;

    // Get user details
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const exotelNumbers = user.exotelNumbers || [];

    const requestedStatusLower = (status || "").toLowerCase();
    let needLiveSync = true;

    if (requestedStatusLower) {
      if (
        requestedStatusLower === "paused" ||
        requestedStatusLower === "pause" ||
        !USER_CACHE_EXCLUDED_STATUSES.includes(requestedStatusLower)
      ) {
        needLiveSync = false;
      }
    } else {
      // No status filter – only hit OMNIDIM if we have any live (active) campaigns locally
      const hasActiveCampaigns = await BulkCall.exists({
        status: "active",
        $or: [
          { userId: new mongoose.Types.ObjectId(userId) },
          { fromNumber: { $in: exotelNumbers } },
        ],
      });
      needLiveSync = !!hasActiveCampaigns;
    }

    // Auto-sync from OMNIDIMENSION first (same as admin controller)
    if (!needLiveSync) {
    } else {
      (async () => {
        try {
          const syncParams = {
            pageno: 1,
            pagesize: 100, // Fetch more to ensure we get all campaigns
          };

          if (status) syncParams.status = status;

          const response = await fetchFromOmnidimension(
            "calls/bulk_call",
            "GET",
            syncParams
          );

          console.log(
            "🔍 Omni API bulk calls response for user:",
            JSON.stringify(response, null, 2)
          );

          let omniBulkCalls = [];
          if (Array.isArray(response)) {
            omniBulkCalls = response;
          } else if (response?.records && Array.isArray(response.records)) {
            omniBulkCalls = response.records;
          } else if (response?.data && Array.isArray(response.data)) {
            omniBulkCalls = response.data;
          } else if (
            response?.bulk_calls &&
            Array.isArray(response.bulk_calls)
          ) {
            omniBulkCalls = response.bulk_calls;
          } else if (response?.campaigns && Array.isArray(response.campaigns)) {
            omniBulkCalls = response.campaigns;
          } else if (response?.results && Array.isArray(response.results)) {
            omniBulkCalls = response.results;
          } else {
            console.error("⚠️  Unexpected Omni API response format:", response);
          }


          if (omniBulkCalls.length > 0) {
            await syncUserBulkCallsFromOmnidimension(omniBulkCalls, userId);
          }
        } catch (apiError) {
          console.error("⚠️  Auto-sync skipped:", apiError.message);
        }
      })();
    }

    // Build query - filter by user's assigned campaigns
    // First try userId, then fallback to exotel numbers
    const query = {
      $or: [
        { userId: new mongoose.Types.ObjectId(userId) },
        { fromNumber: { $in: exotelNumbers } },
      ],
    };

    // Add status filter if provided
    if (status) {
      query.status = status;
    }

    // Calculate pagination
    const skip = (parseInt(pageno) - 1) * parseInt(pagesize);
    const limit = parseInt(pagesize);

    // Get total count
    const total = await BulkCall.countDocuments(query);

    // Get bulk calls with populated bot and phone number (same as admin)
    const campaigns = await BulkCall.find(query)
      .populate("bot", "name description")
      .populate("phoneNumberId", "number label")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const fromNumbers = campaigns
      .map((campaign) => campaign.fromNumber)
      .filter((num) => typeof num === "string" && num.trim().length > 0);

    const numberToName = {};
    if (fromNumbers.length > 0) {
      const owners = await User.find({
        exotelNumbers: { $in: fromNumbers },
      }).select("name exotelNumbers");

      owners.forEach((owner) => {
        (owner.exotelNumbers || []).forEach((number) => {
          if (number) {
            numberToName[number] = owner.name;
          }
        });
      });
    }

    const enhancedCampaigns = campaigns.map((campaign) => ({
      ...campaign,
      createdByName: numberToName[campaign.fromNumber] || null,
    }));


    // Calculate pages
    const pages = Math.ceil(total / limit);

    res.json({
      success: true,
      data: enhancedCampaigns,
      pagination: {
        pageno: parseInt(pageno),
        pagesize: parseInt(pagesize),
        total,
        pages,
      },
    });
  } catch (error) {
    console.error("Get User Bulk Calls Error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

/**
 * Get single campaign details
 * GET /api/user/calls/bulk_call/:id
 */
exports.getUserBulkCall = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;


    // Get user's Exotel numbers
    const User = require("../../models/User");
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const exotelNumbers = user.exotelNumbers || [];

    // Find campaign by omnidimensionId (same as admin controller)
    let campaign = await BulkCall.findOne({
      omnidimensionId: id.toString(),
    })
      .populate("bot", "name description")
      .populate("phoneNumberId", "number label")
      .lean();

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: "Campaign not found",
      });
    }

    // Verify campaign belongs to user's Exotel numbers
    if (!exotelNumbers.includes(campaign.fromNumber)) {
      console.log(
        `❌ Access denied - Campaign ${id} uses ${
          campaign.fromNumber
        }, user has ${JSON.stringify(exotelNumbers)}`
      );
      return res.status(403).json({
        success: false,
        message:
          "Access denied. This campaign does not belong to your assigned numbers.",
      });
    }


    const statusLower = campaign.status ? campaign.status.toLowerCase() : "";
    const shouldSkipSync =
      statusLower && !USER_CACHE_EXCLUDED_STATUSES.includes(statusLower);

    if (!shouldSkipSync) {
      try {
      
        const response = await fetchFromOmnidimension(
          `calls/bulk_call/${id}`,
          "GET"
        );

        if (response) {
         

          if (response.contact_list && Array.isArray(response.contact_list)) {
            // Skip call line sync for cached statuses (non-active campaigns)
            const shouldSkipCallLineSync =
              statusLower &&
              !USER_CACHE_EXCLUDED_STATUSES.includes(statusLower);

            if (shouldSkipCallLineSync) {
          
            } else {
            
              console.log(
                `🔍 Sample contact data:`,
                JSON.stringify(response.contact_list[0], null, 2)
              );

              await syncUserCallLinesFromOmnidimension(
                response.contact_list,
                campaign._id,
                userId
              ).catch((err) => {
                console.error("⚠️  Error syncing call lines:", err.message);
              });
            }

          } else {
           
          }

          try {
           
            const callLogsResponse = await fetchFromOmnidimension(
              "calls/logs",
              "GET",
              {
                pageno: 1,
                pagesize: 100,
              }
            );

            if (callLogsResponse?.call_log_data) {
              const campaignCallLogs = callLogsResponse.call_log_data.filter(
                (log) =>
                  log.call_request_id?.id &&
                  log.call_request_id.id.toString() === id.toString()
              );

              if (campaignCallLogs.length > 0) {
               

                for (const callLog of campaignCallLogs) {
                  const toNumber = callLog.to_number || callLog.from_number;
                  if (!toNumber) continue;

                  await BulkCallLine.updateOne(
                    { bulkCallId: campaign._id, toNumber },
                    {
                      $set: {
                        callStatus: callLog.call_status || "completed",
                        duration: callLog.call_duration_in_seconds || 0,
                        interaction: callLog.call_conversation
                          ? "completed"
                          : "no_interaction",
                        "recording.available": !!callLog.recording_url,
                        "recording.url": callLog.recording_url || undefined,
                      },
                    }
                  );
             
                }
              }
            }
          } catch (logError) {
            console.error(
              "⚠️  Failed to update from call logs:",
              logError.message
            );
          }

          const omniBulkCall = response.details || response;
          if (omniBulkCall) {
         
            await syncUserBulkCallsFromOmnidimension([omniBulkCall], userId);
          }
        }
      } catch (apiError) {
        console.error(
          "⚠️  Failed to fetch from Omnidimension API:",
          apiError.message
        );
      }

      campaign = await BulkCall.findOne({
        omnidimensionId: id.toString(),
      })
        .populate("bot", "name description")
        .populate("phoneNumberId", "number label")
        .lean();
    } else {
    
    }

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: "Campaign not found",
      });
    }

    if (campaign.fromNumber) {
      const creator = await User.findOne({
        exotelNumbers: campaign.fromNumber,
      }).select("name");
      campaign.createdByName = creator?.name || null;
    } else {
      campaign.createdByName = null;
    }

    res.json({
      success: true,
      data: campaign,
    });
  } catch (error) {
    console.error("Get User Bulk Call Error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

/**
 * Get campaign call lines
 * GET /api/user/calls/bulk_call/:id/lines
 */
exports.getUserBulkCallLines = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { pageno = 1, pagesize = 50, call_status, interaction } = req.query;
    const currentPage = parseInt(pageno, 10) || 1;
    const pageSizeNumber = parseInt(pagesize, 10) || 50;

    // Get user's Exotel numbers and verify campaign access
    const User = require("../../models/User");
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const exotelNumbers = user.exotelNumbers || [];

    // Find campaign by omnidimensionId (same as admin controller)
    const campaign = await BulkCall.findOne({
      omnidimensionId: id.toString(),
    });

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: "Campaign not found",
      });
    }


    if (!exotelNumbers.includes(campaign.fromNumber)) {
      return res.status(403).json({
        success: false,
        message:
          "Access denied. This campaign does not belong to your assigned numbers.",
      });
    }

    // Build query for call lines using the actual MongoDB _id
    const query = {
      bulkCallId: campaign._id,
    };

    // Add filters
    if (call_status) {
      query.callStatus = call_status;
    }
    if (interaction) {
      query.interaction = interaction;
    }

    if (currentPage === 1) {
      try {
        const syncSummary = await syncBulkCallLinesFromLogs({
          campaignId: id,
          bulkCall: campaign,
          pageSize: pageSizeNumber,
          maxPages: currentPage
        });
        if (syncSummary?.matched) {
          console.log(
            `🔄 [User] Synced ${syncSummary.upserted} new / ${syncSummary.updated} updated call lines for campaign ${id}.`
          );
        }
      } catch (syncError) {
        console.error(
          `⚠️  [User] Failed to sync call lines from logs for campaign ${id}:`,
          syncError.message
        );
      }
    }

    // Calculate pagination
    const skip = (currentPage - 1) * pageSizeNumber;
    const limit = pageSizeNumber;

    // Get total count
    const total = await BulkCallLine.countDocuments(query);

    // Get call lines
    const callLines = await BulkCallLine.find(query)
      .sort({ callDate: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    // Calculate pages
    const pages = Math.ceil(total / pageSizeNumber);

    res.json({
      success: true,
      data: callLines,
      pagination: {
        pageno: currentPage,
        pagesize: pageSizeNumber,
        total,
        pages,
      },
    });
  } catch (error) {
    console.error("Get User Bulk Call Lines Error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

/**
 * Get campaign activity logs
 * GET /api/user/calls/bulk_call/:id/logs
 */
exports.getUserBulkCallLogs = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { pageno = 1, pagesize = 20 } = req.query;

 

    // Get user's Exotel numbers and verify campaign access
    const User = require("../../models/User");
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const exotelNumbers = user.exotelNumbers || [];

    // Find campaign by omnidimensionId (same as admin controller)
    const campaign = await BulkCall.findOne({
      omnidimensionId: id.toString(),
    });

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: "Campaign not found",
      });
    }

    if (!exotelNumbers.includes(campaign.fromNumber)) {
      return res.status(403).json({
        success: false,
        message:
          "Access denied. This campaign does not belong to your assigned numbers.",
      });
    }

    // Build query for activity logs using the actual MongoDB _id
    const query = {
      bulkCallId: campaign._id,
    };

    // Calculate pagination
    const skip = (parseInt(pageno) - 1) * parseInt(pagesize);
    const limit = parseInt(pagesize);

    // Get total count
    const total = await BulkCallActivityLog.countDocuments(query);

    // Get activity logs
    const logs = await BulkCallActivityLog.find(query)
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(limit)
      .lean();


    // Calculate pages
    const pages = Math.ceil(total / limit);

    res.json({
      success: true,
      data: logs,
      pagination: {
        pageno: parseInt(pageno),
        pagesize: parseInt(pagesize),
        total,
        pages,
      },
    });
  } catch (error) {
    console.error("Get User Bulk Call Logs Error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

/**
 * Get campaign statistics
 * GET /api/user/calls/bulk_call/:id/stats
 */
exports.getUserBulkCallStats = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;


    // Get user's Exotel numbers and verify campaign access
    const User = require("../../models/User");
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const exotelNumbers = user.exotelNumbers || [];

    // Find campaign by omnidimensionId (same as admin controller)
    const campaign = await BulkCall.findOne({
      omnidimensionId: id.toString(),
    });

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: "Campaign not found",
      });
    }

    if (!exotelNumbers.includes(campaign.fromNumber)) {
      return res.status(403).json({
        success: false,
        message:
          "Access denied. This campaign does not belong to your assigned numbers.",
      });
    }

    // Calculate statistics using aggregation with correct bulkCallId
    const stats = await BulkCallLine.aggregate([
      { $match: { bulkCallId: campaign._id } },
      {
        $group: {
          _id: null,
          totalCalls: { $sum: 1 },
          completedCalls: {
            $sum: { $cond: [{ $eq: ["$callStatus", "completed"] }, 1, 0] },
          },
          failedCalls: {
            $sum: { $cond: [{ $ne: ["$callStatus", "completed"] }, 1, 0] },
          },
          totalDuration: {
            $sum: "$duration",
          },
          callsWithDuration: {
            $sum: { $cond: [{ $gt: ["$duration", 0] }, 1, 0] },
          },
        },
      },
    ]);

    // Format response
    const result = stats[0] || {
      totalCalls: 0,
      completedCalls: 0,
      failedCalls: 0,
      totalDuration: 0,
      callsWithDuration: 0,
    };

    const avgDuration =
      result.callsWithDuration > 0
        ? result.totalDuration / result.callsWithDuration
        : 0;

    const successRate =
      result.totalCalls > 0
        ? (result.completedCalls / result.totalCalls) * 100
        : 0;



    res.json({
      success: true,
      data: {
        totalCalls: result.totalCalls,
        completedCalls: result.completedCalls,
        failedCalls: result.failedCalls,
        avgDuration: Math.round(avgDuration * 10) / 10,
        successRate: Math.round(successRate * 10) / 10,
      },
    });
  } catch (error) {
    console.error("Get User Bulk Call Stats Error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

/**
 * Get analytics data for a user's bulk call campaign
 * GET /api/user/calls/bulk_call/:id/analytics
 */
exports.getUserBulkCallAnalytics = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;


    // Verify user and obtain Exotel numbers
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }
    const exotelNumbers = user.exotelNumbers || [];

    // Find campaign by omnidimensionId
    const campaign = await BulkCall.findOne({
      omnidimensionId: id.toString(),
    });

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: "Campaign not found",
      });
    }

    if (!exotelNumbers.includes(campaign.fromNumber)) {
      return res.status(403).json({
        success: false,
        message:
          "Access denied. This campaign does not belong to your assigned numbers.",
      });
    }

    // Retrieve call lines
    const callLines = await BulkCallLine.find({
      bulkCallId: campaign._id,
    });

    const cleanDistribution = (distribution = {}) =>
      Object.entries(distribution).reduce((acc, [key, value]) => {
        if (!key || value === undefined || value === null) {
          return acc;
        }
        acc[key] = value;
        return acc;
      }, {});

    // Build distributions from call lines
    let statusDistribution = {};
    callLines.forEach((line) => {
      const statusKey = line.callStatus || "pending";
      statusDistribution[statusKey] = (statusDistribution[statusKey] || 0) + 1;
    });
    statusDistribution = cleanDistribution(statusDistribution);

    let interactionDistribution = {};
    callLines.forEach((line) => {
      const interactionKey = line.interaction || "no_interaction";
      interactionDistribution[interactionKey] =
        (interactionDistribution[interactionKey] || 0) + 1;
    });
    interactionDistribution = cleanDistribution(interactionDistribution);

    // Fallbacks from campaign summary
    const fallbackTotal =
      campaign.totalCalls ||
      campaign.totalCallsMade ||
      campaign.progress?.total ||
      callLines.length ||
      0;
    const fallbackCompleted =
      campaign.highEngagementCalls ||
      campaign.callsPickedUp ||
      campaign.completedCalls ||
      campaign.progress?.completed ||
      0;
    const fallbackFailed = campaign.failedCalls || 0;
    const fallbackBusy = campaign.busyCalls || 0;
    const fallbackNoAnswer = campaign.noAnswerCalls || 0;
    const fallbackCancelled =
      campaign.status === "cancelled" ? fallbackTotal : 0;
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
        no_interaction: campaign.noLowInteractionCalls || fallbackPending,
        transfer: campaign.transferCalls || 0,
        low_interaction: Math.max(
          0,
          (campaign.noLowInteractionCalls || 0) - (campaign.transferCalls || 0)
        ),
      });
    }

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

    const getCount = (distribution, key) => {
      if (!distribution) return 0;
      const value = distribution[key];
      if (value === undefined || value === null) {
        return 0;
      }
      return value;
    };

    const derivedCompleted =
      getCount(statusDistribution, "completed") || fallbackCompleted;
    const derivedPending =
      getCount(statusDistribution, "pending") || fallbackPending;
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

    const averageDuration =
      callLines.length > 0
        ? callLines.reduce((sum, line) => sum + (line.duration || 0), 0) /
          callLines.length
        : campaign.progress?.averageDuration || 0;

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

    const pickupRate =
      totalCalls > 0 ? (derivedCompleted / totalCalls) * 100 : 0;

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
        totalCost: campaign.totalCost || 0,
      },
    });
  } catch (error) {
    console.error("Get User Bulk Call Analytics Error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

/**
 * Get recording for a user's bulk call line
 * GET /api/user/calls/bulk_call/recording/:id
 */
exports.getUserBulkCallLineRecording = async (req, res) => {
  try {
    const userId = req.user.id;
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

    // Check if bulk call belongs to user's assigned Exotel numbers
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const exotelNumbers = user.exotelNumbers || [];
    if (
      !callLine.bulkCallId ||
      !exotelNumbers.includes(callLine.bulkCallId.fromNumber)
    ) {
      return res.status(403).json({
        success: false,
        message:
          "Access denied. This campaign does not belong to your assigned numbers.",
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
    const config = require("../../config/env.js");

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
      console.error("Error proxying recording:", proxyError.message);
      res.status(500).json({
        success: false,
        message: "Failed to fetch recording from Exotel",
        error: proxyError.message,
      });
    }
  } catch (error) {
    console.error("Get User Bulk Call Line Recording Error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

/**
 * Download recording for a user's bulk call line
 * GET /api/user/calls/bulk_call/recording/:id/download
 */
exports.downloadUserBulkCallLineRecording = async (req, res) => {
  try {
    const userId = req.user.id;
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

    // Check if bulk call belongs to user's assigned Exotel numbers
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const exotelNumbers = user.exotelNumbers || [];
    if (
      !callLine.bulkCallId ||
      !exotelNumbers.includes(callLine.bulkCallId.fromNumber)
    ) {
      return res.status(403).json({
        success: false,
        message:
          "Access denied. This campaign does not belong to your assigned numbers.",
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
    const config = require("../../config/env.js");

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

      // Set appropriate headers for download
      res.setHeader(
        "Content-Type",
        response.headers["content-type"] || "audio/mpeg"
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="recording-${id}.mp3"`
      );
      res.setHeader("Content-Length", response.headers["content-length"]);
      res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
      res.setHeader("Access-Control-Allow-Credentials", "true");

      // Stream the audio to the client
      response.data.pipe(res);
    } catch (proxyError) {
      console.error("Error proxying recording download:", proxyError.message);
      res.status(500).json({
        success: false,
        message: "Failed to download recording from Exotel",
        error: proxyError.message,
      });
    }
  } catch (error) {
    console.error("Download User Bulk Call Line Recording Error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

/**
 * Get user's assigned phone numbers for campaign creation
 * GET /api/user/phone-numbers
 */
exports.getUserPhoneNumbers = async (req, res) => {
  try {
    const userId = req.user.id;

    // Get user details with Exotel numbers
    const user = await User.findById(userId).select("exotelNumbers email name");
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const exotelNumbers = user.exotelNumbers || [];


    // Format Exotel numbers for frontend use
    const phoneNumbers = exotelNumbers.map((number, index) => ({
      _id: `exotel_${index}`, // Temporary ID for frontend
      number: number,
      label: `Exotel ${index + 1}`,
      omnidimensionId: null, // Will be resolved during campaign creation
      isExotel: true,
    }));



    res.json({
      success: true,
      data: phoneNumbers,
    });
  } catch (error) {
    console.error("Get User Phone Numbers Error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

/**
 * Create new campaign via Omnidimension API
 * POST /api/user/calls/bulk_call/create
 */
exports.createCampaign = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      name,
      phoneNumberId,
      contactList,
      isScheduled,
      scheduledDatetime,
      timezone,
      retryConfig,
      enabledRescheduleCall,
      concurrentCallLimit,
    } = req.body;

   

    // Validate required fields
    if (
      !name ||
      !phoneNumberId ||
      !contactList ||
      !Array.isArray(contactList)
    ) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: name, phoneNumberId, contactList",
      });
    }

    // Get user details and verify phone number access
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Handle Exotel number selection
    let selectedPhoneNumber;

    if (phoneNumberId.startsWith("exotel_")) {
      // Extract index from exotel_0, exotel_1, etc.
      const index = parseInt(phoneNumberId.split("_")[1]);
      const exotelNumbers = user.exotelNumbers || [];

      if (index >= 0 && index < exotelNumbers.length) {
        selectedPhoneNumber = {
          number: exotelNumbers[index],
          _id: null,
          omnidimensionId: null, // Will be resolved by Omnidimension API
        };
      } else {
        return res.status(403).json({
          success: false,
          message: "Invalid phone number selection.",
        });
      }
    } else {
      // Fallback to PhoneNumber collection lookup
      const phoneNumber = await PhoneNumber.findOne({
        _id: phoneNumberId,
        userId: userId,
      });

      if (!phoneNumber) {
        return res.status(403).json({
          success: false,
          message: "Access denied. Phone number not assigned to user.",
        });
      }

      selectedPhoneNumber = phoneNumber;
    }

    // Format contact list with proper phone number format
    const formattedContactList = contactList.map((contact) => {
      let phoneNumber = contact.phone_number;

      // Add +91 prefix if missing (for Indian numbers)
      if (phoneNumber && !phoneNumber.startsWith("+")) {
        if (phoneNumber.startsWith("91")) {
          phoneNumber = "+" + phoneNumber;
        } else if (phoneNumber.length === 10) {
          phoneNumber = "+91" + phoneNumber;
        } else {
          phoneNumber = "+91" + phoneNumber;
        }
      }

      return {
        phone_number: phoneNumber,
        customer_name: contact.customer_name || "",
      };
    });

 

    // Prepare payload for Omnidimension API
    const campaignPayload = {
      name: name,
      contact_list: formattedContactList,
      phone_number_id: null, // Will be set from phone number ID
      agent_id: null, // Will be set from bot ID
      is_scheduled: isScheduled || false,
      concurrent_call_limit: concurrentCallLimit || 1,
    };

    // Add retry config if provided
    if (retryConfig && Object.keys(retryConfig).length > 0) {
      const scheduleRaw =
        retryConfig.autoRetrySchedule || retryConfig.auto_retry_schedule;
      const normalizedSchedule = (() => {
        if (!scheduleRaw) return "immediately";
        const value = scheduleRaw.toString().toLowerCase();
        if (value === "immediate") return "immediately";
        const allowed = ["immediately", "next_day", "scheduled_time"];
        return allowed.includes(value) ? value : "immediately";
      })();

      campaignPayload.retry_config = {
        auto_retry: !!retryConfig.autoRetry,
        auto_retry_schedule: normalizedSchedule,
      };

      // Add retry schedule details when using scheduled_time
      if (
        campaignPayload.retry_config.auto_retry_schedule === "scheduled_time"
      ) {
        if (retryConfig.retryScheduleDays !== undefined) {
          campaignPayload.retry_config.retry_schedule_days =
            parseInt(retryConfig.retryScheduleDays, 10) || 0;
        }
        if (retryConfig.retryScheduleHours !== undefined) {
          campaignPayload.retry_config.retry_schedule_hours =
            parseInt(retryConfig.retryScheduleHours, 10) || 0;
        }
      }

      // Add retry limit (applies regardless of schedule)
      if (retryConfig.retryLimit !== undefined) {
        campaignPayload.retry_config.retry_limit =
          parseInt(retryConfig.retryLimit, 10) || 1;
      }
    }

    // Add reschedule call option
    if (enabledRescheduleCall !== undefined) {
      campaignPayload.enabled_reschedule_call = enabledRescheduleCall;
    }

    // Add scheduling if provided
    if (isScheduled && scheduledDatetime) {
      campaignPayload.scheduled_datetime = scheduledDatetime;
      if (timezone) {
        campaignPayload.timezone = timezone;
      }
    }


    let omnidimensionPhoneNumberId;
    try {
      const phoneNumbersResponse = await fetchFromOmnidimension(
        "phone_number/list",
        "GET"
      );

    

      // Find the phone number in the response
      let phoneNumberRecord = null;
      let phoneNumbersList = [];

      // Handle different response structures
      if (Array.isArray(phoneNumbersResponse)) {
        phoneNumbersList = phoneNumbersResponse;
      } else if (
        phoneNumbersResponse.phone_numbers &&
        Array.isArray(phoneNumbersResponse.phone_numbers)
      ) {
        phoneNumbersList = phoneNumbersResponse.phone_numbers;
      } else if (
        phoneNumbersResponse.data &&
        Array.isArray(phoneNumbersResponse.data)
      ) {
        phoneNumbersList = phoneNumbersResponse.data;
      }



      phoneNumberRecord = phoneNumbersList.find((p) => {
        const phoneMatches =
          p.number === selectedPhoneNumber.number ||
          p.phone_number === selectedPhoneNumber.number ||
          p.twilio_number === selectedPhoneNumber.number ||
          p.exotel_phone_number === selectedPhoneNumber.number;

        if (phoneMatches) {
        }
        return phoneMatches;
      });

      if (phoneNumberRecord) {
        omnidimensionPhoneNumberId =
          phoneNumberRecord.id || phoneNumberRecord.phone_number_id;


        // Check if phone number has an associated agent/bot
        const botId =
          phoneNumberRecord.bot_id ||
          phoneNumberRecord.agent_id ||
          phoneNumberRecord.active_bot_id ||
          phoneNumberRecord.default_bot_id ||
          phoneNumberRecord.default_agent_id;

        if (botId) {
          campaignPayload.agent_id = parseInt(botId);
        } else {
      
          console.log(
            `📋 Available fields in phone record:`,
            Object.keys(phoneNumberRecord)
          );
        }
      } else {
        console.warn(
          `⚠️  Phone number ${selectedPhoneNumber.number} not found in Omnidimension. Using phone number as ID.`
        );
        omnidimensionPhoneNumberId = selectedPhoneNumber.number;
      }
    } catch (phoneError) {
      console.warn(
        "⚠️  Failed to fetch phone numbers from Omnidimension:",
        phoneError.message
      );
      omnidimensionPhoneNumberId = selectedPhoneNumber.number;
    }

    // Update campaign payload with correct phone number ID
    const parsedPhoneNumberId = parseInt(omnidimensionPhoneNumberId, 10);
    campaignPayload.phone_number_id = Number.isNaN(parsedPhoneNumberId)
      ? omnidimensionPhoneNumberId
      : parsedPhoneNumberId;


    // Create campaign via Omnidimension API
    const omniResponse = await syncToOmnidimension(
      "calls/bulk_call/create",
      campaignPayload,
      "POST"
    );


    // Extract campaign ID from response
    const campaignId =
      omniResponse.id || omniResponse.campaign_id || omniResponse.bulk_call_id;

    if (!campaignId) {
      throw new Error("No campaign ID returned from Omnidimension API");
    }

    // Create local campaign record
    const localCampaign = new BulkCall({
      userId: userId,
      omnidimensionId: campaignId.toString(),
      name: name,
      status: isScheduled ? "pending" : "active",
      fromNumber: selectedPhoneNumber.number,
      phoneNumberId: mongoose.Types.ObjectId.isValid(selectedPhoneNumber._id)
        ? selectedPhoneNumber._id
        : null,
      phoneNumbers: formattedContactList.map((contact) => contact.phone_number),
      totalCalls: formattedContactList.length,
      concurrentCalls: concurrentCallLimit || 1,
      progress: {
        total: formattedContactList.length,
        completed: 0,
        percentage: 0,
      },
      createdBy: user.email || user.name || "User",
      metadata: {
        autoRetry: {
          enabled: retryConfig?.autoRetry || false,
          maxRetries: retryConfig?.retryLimit || 0,
          retryDelay:
            (retryConfig?.retryScheduleDays || 0) * 24 * 60 +
            (retryConfig?.retryScheduleHours || 0) * 60,
        },
        reschedule: {
          enabled: enabledRescheduleCall || false,
          schedule: isScheduled ? new Date(scheduledDatetime) : null,
        },
        omnidimensionPayload: campaignPayload,
      },
      syncedAt: new Date(),
      syncStatus: "synced",
    });

    await localCampaign.save();


    res.json({
      success: true,
      data: {
        campaignId: campaignId,
        localId: localCampaign._id,
        name: name,
        status: localCampaign.status,
        totalContacts: contactList.length,
      },
      message: "Campaign created successfully",
    });
  } catch (error) {
    console.error("Create Campaign Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create campaign",
      error: error.message,
    });
  }
};

/**
 * Pause campaign
 * PUT /api/user/calls/bulk_call/:id/pause
 */
exports.pauseCampaign = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

  

    // Find and verify campaign access
    const campaign = await BulkCall.findOne({
      omnidimensionId: id.toString(),
      userId: userId,
    });

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: "Campaign not found or access denied",
      });
    }

    // Call Omnidimension API to pause
    const omniResponse = await fetchFromOmnidimension(
      `calls/bulk_call/${id}`,
      "PUT",
      { action: "pause" }
    );

    // Update local status
    campaign.status = "paused";
    await campaign.save();

  
    res.json({
      success: true,
      message: "Campaign paused successfully",
      data: { status: "paused" },
    });
  } catch (error) {
    console.error("Pause Campaign Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to pause campaign",
      error: error.message,
    });
  }
};

/**
 * Resume campaign
 * PUT /api/user/calls/bulk_call/:id/resume
 */
exports.resumeCampaign = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

   

    // Find and verify campaign access
    const campaign = await BulkCall.findOne({
      omnidimensionId: id.toString(),
      userId: userId,
    });

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: "Campaign not found or access denied",
      });
    }

    // Call Omnidimension API to resume
    const omniResponse = await fetchFromOmnidimension(
      `calls/bulk_call/${id}`,
      "PUT",
      { action: "resume" }
    );

    // Update local status
    campaign.status = "active";
    await campaign.save();



    res.json({
      success: true,
      message: "Campaign resumed successfully",
      data: { status: "active" },
    });
  } catch (error) {
    console.error("Resume Campaign Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to resume campaign",
      error: error.message,
    });
  }
};

/**
 * Reschedule campaign
 * PUT /api/user/calls/bulk_call/:id/reschedule
 */
exports.rescheduleCampaign = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { newScheduledDatetime, newTimezone } = req.body;

  

    if (!newScheduledDatetime) {
      return res.status(400).json({
        success: false,
        message: "Missing required field: newScheduledDatetime",
      });
    }

    // Find and verify campaign access
    const campaign = await BulkCall.findOne({
      omnidimensionId: id.toString(),
      userId: userId,
    });

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: "Campaign not found or access denied",
      });
    }

    // Call Omnidimension API to reschedule
    const reschedulePayload = {
      action: "reschedule",
      new_scheduled_datetime: newScheduledDatetime,
    };

    if (newTimezone) {
      reschedulePayload.new_timezone = newTimezone;
    }

    const omniResponse = await fetchFromOmnidimension(
      `calls/bulk_call/${id}`,
      "PUT",
      reschedulePayload
    );

    // Update local metadata
    if (!campaign.metadata) campaign.metadata = {};
    if (!campaign.metadata.reschedule) campaign.metadata.reschedule = {};

    campaign.metadata.reschedule.schedule = new Date(newScheduledDatetime);
    campaign.status = "pending";
    await campaign.save();



    res.json({
      success: true,
      message: "Campaign rescheduled successfully",
      data: {
        status: "pending",
        newSchedule: newScheduledDatetime,
      },
    });
  } catch (error) {
    console.error("Reschedule Campaign Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to reschedule campaign",
      error: error.message,
    });
  }
};

/**
 * Cancel campaign
 * DELETE /api/user/calls/bulk_call/:id
 */
exports.cancelCampaign = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;


    // Find and verify campaign access
    const campaign = await BulkCall.findOne({
      omnidimensionId: id.toString(),
      userId: userId,
    });

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: "Campaign not found or access denied",
      });
    }

    // Call Omnidimension API to cancel (if supported)
    try {
      await fetchFromOmnidimension(`calls/bulk_call/${id}`, "DELETE");
    } catch (apiError) {
      console.warn("Omnidimension API cancel failed:", apiError.message);
      // Continue with local cancellation even if API fails
    }

    // Update local status
    campaign.status = "cancelled";
    await campaign.save();



    res.json({
      success: true,
      message: "Campaign cancelled successfully",
      data: { status: "cancelled" },
    });
  } catch (error) {
    console.error("Cancel Campaign Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to cancel campaign",
      error: error.message,
    });
  }
};

/**
 * Sync campaigns from Omnidimension (manual sync)
 * POST /api/user/calls/bulk_call/sync
 */
exports.syncCampaigns = async (req, res) => {
  try {
    const userId = req.user.id;

    

    // Get user details
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Fetch campaigns from Omnidimension
    const response = await fetchFromOmnidimension("calls/bulk_call", "GET", {
      pageno: 1,
      pagesize: 100,
    });

    // Handle different response formats
    let omniBulkCalls = [];
    if (Array.isArray(response)) {
      omniBulkCalls = response;
    } else if (response?.records && Array.isArray(response.records)) {
      omniBulkCalls = response.records;
    } else if (response?.data && Array.isArray(response.data)) {
      omniBulkCalls = response.data;
    }

    // Sync to local database
    const syncResult = await syncUserBulkCallsFromOmnidimension(
      omniBulkCalls,
      userId
    );

  

    res.json({
      success: true,
      message: "Campaigns synced successfully",
      data: syncResult,
    });
  } catch (error) {
    console.error("Sync Campaigns Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to sync campaigns",
      error: error.message,
    });
  }
};
