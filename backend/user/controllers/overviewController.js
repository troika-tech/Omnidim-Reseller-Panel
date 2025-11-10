const BulkCall = require("../../models/BulkCall");
const IncomingCall = require("../../models/IncomingCall");
const CallLog = require("../../models/CallLog");
const User = require("../../models/User");
const { fetchFromOmnidimension } = require("../../services/omniApi");
const {
  normalizePhoneNumber: normalizePhoneNumberUtil,
} = require("../../utils/phone");

/**
 * Get all variations of a phone number for matching
 */
function getPhoneNumberVariations(phone) {
  if (!phone) return [];

  const variations = new Set();
  const numStr = String(phone || "").trim();
  if (!numStr) return [];

  const normalized = numStr.replace(/[\s\-()]/g, "").replace(/^\+/, "");

  // Original
  variations.add(numStr);

  // Normalized (full number)
  variations.add(normalized);

  // Remove country code if present and get base number
  let baseNumber = normalized;
  if (normalized.startsWith("91") && normalized.length > 10) {
    baseNumber = normalized.substring(2); // Remove "91"
  }

  // Add base number variations
  variations.add(baseNumber);

  // With leading 0 for base number
  if (!baseNumber.startsWith("0")) {
    variations.add("0" + baseNumber);
  }

  // With country codes for base number
  variations.add("+91" + baseNumber);
  variations.add("91" + baseNumber);

  // With country codes for normalized (full) number
  variations.add("+91" + normalized);
  variations.add("91" + normalized);

  // With leading 0 for full normalized number
  if (!normalized.startsWith("0")) {
    variations.add("0" + normalized);
  }

  return Array.from(variations).filter((v) => v.length > 0);
}

// Get overview statistics
exports.getOverviewStats = async (req, res) => {
  try {
    const userId = req.user.id;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const exotelNumbers = user.exotelNumbers || [];

    console.log(`🔍 DEBUG - User ID: ${userId}`);
    console.log(`🔍 DEBUG - User Exotel Numbers:`, exotelNumbers);
    console.log(`🔍 DEBUG - User has ${exotelNumbers.length} Exotel numbers`);

    // Build campaign query similar to bulkCallsController (userId + fromNumber)
    const campaignQuery =
      exotelNumbers.length > 0
        ? {
            $or: [{ userId: user._id }, { fromNumber: { $in: exotelNumbers } }],
          }
        : { userId: user._id };

    const campaigns = await BulkCall.find(campaignQuery).select(
      "status progress.total"
    );

    const totalCampaigns = campaigns.length;

    const activeStatuses = new Set([
      "RUNNING",
      "PENDING",
      "in_progress",
      "active",
      "retry_scheduled",
      "paused",
    ]);

    const activeCampaigns = campaigns.filter(
      (campaign) =>
        campaign.status && activeStatuses.has(campaign.status.toUpperCase())
    ).length;

    // Calculate total calls from all campaigns
    let totalCalls = 0;
    campaigns.forEach((campaign) => {
      totalCalls += campaign.progress?.total || 0;
    });

    // Fetch incoming calls count using EXACT same logic as callLogsController.js
    let incomingCalls = 0;
    try {
      // Same phone number variation logic as callLogsController.js
      function normalizePhoneNumber(phone) {
        if (!phone) return "";
        let normalized = String(phone).replace(/[\s\-()]/g, "");
        normalized = normalized.replace(/^\+/, "");
        if (normalized.startsWith("0")) {
          normalized = normalized.substring(1);
        }
        if (normalized.startsWith("91") && normalized.length > 10) {
          normalized = normalized.substring(2);
        }
        return normalized;
      }

      function getPhoneNumberVariations(phone) {
        if (!phone) return [];
        const variations = new Set();
        const normalized = normalizePhoneNumber(phone);
        variations.add(String(phone).trim());
        variations.add(normalized);
        if (!normalized.startsWith("0")) {
          variations.add("0" + normalized);
        }
        variations.add("+91" + normalized);
        variations.add("91" + normalized);
        variations.add("+910" + normalized);
        variations.add("910" + normalized);
        return Array.from(variations).filter((v) => v.length > 0);
      }

      if (exotelNumbers.length > 0) {
        // Get all variations of Exotel numbers for matching (same as callLogsController.js)
        const allPhoneVariations = [];
        for (const exotelNum of exotelNumbers) {
          const variations = getPhoneNumberVariations(exotelNum);
          allPhoneVariations.push(...variations);
        }

        const phoneMatchValues = Array.from(new Set(allPhoneVariations)).filter(
          (val) => val && val.length > 0
        );

        // Same query as callLogsController.js
        const query = {
          to: { $in: phoneMatchValues },
        };

        incomingCalls = await IncomingCall.countDocuments(query);

        console.log(
          `📞 Phone number variations for matching:`,
          phoneMatchValues
        );
        console.log(
          `📞 Incoming calls (using callLogsController.js logic): ${incomingCalls}`
        );
      } else {
        incomingCalls = 0;
        console.log("⚠️ User has no Exotel numbers assigned");
      }
    } catch (dbError) {
      console.warn(
        "Could not count incoming calls from IncomingCall collection:",
        dbError.message
      );
    }

    // Fetch all calls for this user similar to call logs page
    // We'll filter down to genuine outbound dials initiated from the user's Exotel numbers
    const trimmedExotelNumbers = exotelNumbers
      .map((num) => (typeof num === "string" ? num.trim() : `${num}`))
      .filter(Boolean);
    const normalizedExotelNumbers = trimmedExotelNumbers
      .map((num) => normalizePhoneNumberUtil(num))
      .filter(Boolean);

    const exotelNumberVariationsSet = new Set(trimmedExotelNumbers);
    const normalizedExotelVariationsSet = new Set(normalizedExotelNumbers);

    for (const exotelNum of trimmedExotelNumbers) {
      const variations = getPhoneNumberVariations(exotelNum);
      variations.forEach((variant) => {
        if (!variant) return;

        exotelNumberVariationsSet.add(variant);

        const normalizedVariant = normalizePhoneNumberUtil(variant);
        if (normalizedVariant) {
          normalizedExotelVariationsSet.add(normalizedVariant);
        }
      });
    }

    const exotelNumberVariations = Array.from(exotelNumberVariationsSet);
    const normalizedExotelVariations = Array.from(
      normalizedExotelVariationsSet
    );

    let outgoingCalls = 0;

    if (trimmedExotelNumbers.length > 0) {
      /**
       * Treat a call as "outgoing" only when:
       *  - The source/normalizedSource matches one of the user's Exotel numbers (our system dialled out)
       *  - AND the destination number does NOT match any of the user's Exotel numbers (to avoid double-counting inbound calls
       *    or internal routing hops where both source and destination might match)
       */
      const outgoingCallQuery = {
        userId: user._id,
        $or: [
          { source: { $in: exotelNumberVariations } },
          { normalizedSource: { $in: normalizedExotelVariations } },
        ],
        phoneNumber: { $nin: exotelNumberVariations },
        normalizedPhoneNumber: { $nin: normalizedExotelVariations },
        toNumber: { $nin: exotelNumberVariations },
      };

      outgoingCalls = await CallLog.countDocuments(outgoingCallQuery);
    }

    console.log(`📞 Total user calls (showing as outgoing): ${outgoingCalls}`);
    console.log(
      `📞 Incoming calls (from IncomingCall collection): ${incomingCalls}`
    );

    res.json({
      success: true,
      data: {
        totalCampaigns,
        activeCampaigns,
        incomingCalls,
        outgoingCalls,
        totalCalls,
      },
    });
  } catch (error) {
    console.error("Get Overview Stats Error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Get call logs directly from Omnidimension API - first 10 records only
exports.getCallLogs = async (req, res) => {
  try {
    const userId = req.user.id;

    // Get user's Exotel numbers for filtering
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const exotelNumbers = user.exotelNumbers || [];
    console.log(`🔍 DEBUG - User ID: ${userId}`);
    console.log(`🔍 DEBUG - User Exotel Numbers:`, exotelNumbers);

    // If user has no Exotel numbers, return empty result
    if (exotelNumbers.length === 0) {
      console.log("⚠️ User has no assigned Exotel numbers");
      return res.json({
        success: true,
        data: [],
        pagination: {
          page: 1,
          limit: 10,
          total: 0,
          pages: 0,
        },
      });
    }

    console.log(`🔄 Fetching call logs directly from OMNIDIMENSION API`);

    // Direct call to Omnidimension API - get first 10 records only
    const endpoint = `calls/logs?pageno=1&pagesize=10`;
    const response = await fetchFromOmnidimension(endpoint);

    console.log(
      `📥 Raw Response from OMNIDIMENSION:`,
      JSON.stringify(response, null, 2)
    );

    // Parse response - omnidim.io returns call_log_data array
    let callLogs = [];
    let totalRecords = 0;

    // Check various possible response structures (call_log_data is the primary format)
    if (response?.call_log_data && Array.isArray(response.call_log_data)) {
      callLogs = response.call_log_data;
      totalRecords =
        response.total_records ||
        response.total ||
        response.count ||
        callLogs.length;
      console.log(
        `✅ Found ${callLogs.length} records in response.call_log_data`
      );
    } else if (response?.records && Array.isArray(response.records)) {
      callLogs = response.records;
      totalRecords =
        response.total_records ||
        response.total ||
        response.count ||
        callLogs.length;
      console.log(`✅ Found ${callLogs.length} records in response.records`);
    } else if (response?.data && Array.isArray(response.data)) {
      callLogs = response.data;
      totalRecords = response.total || response.count || callLogs.length;
      console.log(`✅ Found ${callLogs.length} records in response.data`);
    } else if (response?.results && Array.isArray(response.results)) {
      callLogs = response.results;
      totalRecords = response.total || response.count || callLogs.length;
      console.log(`✅ Found ${callLogs.length} records in response.results`);
    } else if (Array.isArray(response)) {
      callLogs = response;
      totalRecords = callLogs.length;
      console.log(
        `✅ Found ${callLogs.length} records in direct array response`
      );
    } else {
      console.warn(
        `⚠️ Unexpected response structure:`,
        Object.keys(response || {})
      );
    }

    // Generate all phone number variations for user's Exotel numbers
    const allPhoneVariations = [];
    for (const exotelNum of exotelNumbers) {
      const variations = getPhoneNumberVariations(exotelNum);
      allPhoneVariations.push(...variations);
    }

    const phoneMatchValues = Array.from(new Set(allPhoneVariations)).filter(
      (val) => val && val.length > 0
    );

    console.log(`📞 Phone number variations for matching:`, phoneMatchValues);

    // Filter call logs to only include calls related to user's Exotel numbers
    const filteredCallLogs = callLogs.filter((log) => {
      // Check if from_number or to_number matches any of the user's Exotel number variations
      const fromNumber = log.from_number || log.source || log.caller_id || '';
      const toNumber = log.to_number || log.destination || log.phone_number || '';
      
      const fromMatches = phoneMatchValues.some(variation => 
        fromNumber.includes(variation) || variation.includes(fromNumber)
      );
      const toMatches = phoneMatchValues.some(variation => 
        toNumber.includes(variation) || variation.includes(toNumber)
      );
      
      return fromMatches || toMatches;
    });

    console.log(
      `🔍 Filtered ${callLogs.length} total logs to ${filteredCallLogs.length} user-specific logs`
    );

    // Return first 10 filtered records
    const first10Records = filteredCallLogs.slice(0, 10);

    console.log(
      `📊 Returning ${first10Records.length} call logs directly from Omnidimension`
    );

    res.json({
      success: true,
      data: first10Records,
      pagination: {
        page: 1,
        limit: 10,
        total: first10Records.length,
        pages: 1,
      },
    });
  } catch (error) {
    console.error("❌ Get Call Logs Error:", error);
    console.error("❌ Error Details:", {
      message: error.message,
      stack: error.stack,
      response: error.response?.data,
    });

    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};
