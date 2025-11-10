const axios = require("axios");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

/**
 * Fetch campaign ID for a specific call_request_id
 * @param {string|number} callRequestId - The call request ID to search for (can be the ID value from call_request_id.id)
 */
async function fetchCampaignForCallRequest(callRequestId) {
  try {
    console.log(
      `🔍 Fetching campaign for call_request_id.id: ${callRequestId}`
    );
    console.log(
      "============================================================\n"
    );

    // Check environment variables
    console.log(
      `🔑 API Key: ${process.env.OMNIDIMENSION_API_KEY ? "Found" : "NOT FOUND"}`
    );

    if (!process.env.OMNIDIMENSION_API_KEY) {
      throw new Error(
        "OMNIDIMENSION_API_KEY not found in environment variables"
      );
    }

    // Step 1: Fetch ALL call logs from OMNIDIMENSION API
    console.log("🌐 Fetching ALL call logs from Omnidimension API...");

    let allCallLogs = [];
    let callLogs = [];

    // Try different endpoints and pagination
    const callLogEndpoints = [
      "/calls/logs",
      "/calls/logs?limit=100",
      "/calls/logs?limit=1000",
      "/call-logs",
      "/v1/calls/logs",
    ];

    let successfulEndpoint = null;

    for (const endpoint of callLogEndpoints) {
      try {
        console.log(
          `🔍 Trying endpoint: ${process.env.OMNIDIMENSION_BASE_URL}${endpoint}`
        );
        const response = await axios.get(
          `${process.env.OMNIDIMENSION_BASE_URL}${endpoint}`,
          {
            headers: {
              Authorization: `Bearer ${process.env.OMNIDIMENSION_API_KEY}`,
              "Content-Type": "application/json",
            },
            timeout: process.env.OMNIDIMENSION_API_TIMEOUT || 30000,
          }
        );

        console.log(`✅ Response Status: ${response.status}`);

        // Handle different response formats
        if (Array.isArray(response.data)) {
          callLogs = response.data;
        } else if (
          response.data?.call_log_data &&
          Array.isArray(response.data.call_log_data)
        ) {
          callLogs = response.data.call_log_data;
        } else if (response.data?.data && Array.isArray(response.data.data)) {
          callLogs = response.data.data;
        }

        if (callLogs.length > 0) {
          successfulEndpoint = endpoint;
          console.log(
            `✅ Success with endpoint: ${endpoint} - Found ${callLogs.length} calls`
          );

          // If this endpoint gives us more data, use it
          if (callLogs.length > allCallLogs.length) {
            allCallLogs = [...callLogs];
          }

          // If we found a good amount of data, break
          if (callLogs.length >= 100) {
            break;
          }
        }
      } catch (error) {
        console.log(
          `❌ Endpoint ${endpoint} failed: ${
            error.response?.status || error.message
          }`
        );
        continue;
      }
    }

    // Use the best result we found
    callLogs = allCallLogs.length > 0 ? allCallLogs : callLogs;

    console.log(
      `📊 Processing ${callLogs.length} call logs to find call_request_id: ${callRequestId}`
    );

    // Debug: Show first few call_request_ids to understand the data structure
    console.log("\n🔍 DEBUG: First 5 call_request_id values found:");
    for (let i = 0; i < Math.min(5, callLogs.length); i++) {
      const callLog = callLogs[i];
      console.log(`Call ${i + 1}:`);
      console.log(`  - ID: ${callLog.id}`);
      console.log(
        `  - call_request_id: ${JSON.stringify(callLog.call_request_id)}`
      );
      console.log(`  - campaign_id: ${callLog.campaign_id || "N/A"}`);
      console.log(`  - bulk_call_id: ${callLog.bulk_call_id || "N/A"}`);
    }

    // Step 2: Search for the specific call_request_id
    let targetCall = null;
    let foundCallRequestIds = new Set();

    for (let i = 0; i < callLogs.length; i++) {
      const callLog = callLogs[i];

      // Collect all call_request_ids for debugging
      if (callLog.call_request_id?.id) {
        foundCallRequestIds.add(callLog.call_request_id.id.toString());
      }

      // Check if this call has the target call_request_id (try both string and number comparison)
      if (
        callLog.call_request_id?.id == callRequestId ||
        callLog.call_request_id?.id === parseInt(callRequestId)
      ) {
        targetCall = callLog;
        console.log(`🎉 FOUND TARGET CALL at index ${i}!`);
        console.log(`📞 Call ID: ${callLog.id}`);
        console.log(`📞 From: ${callLog.from_number}`);
        console.log(`📞 To: ${callLog.to_number}`);
        console.log(`📞 Time: ${callLog.time_of_call}`);
        break;
      }

      // Log progress every 10 calls (since we only have 30)
      if (i % 10 === 0) {
        console.log(`🔍 Searched ${i}/${callLogs.length} calls...`);
      }
    }

    // Debug: Show all found call_request_ids
    console.log(
      `\n🔍 DEBUG: All call_request_id values found (${foundCallRequestIds.size} unique):`
    );
    Array.from(foundCallRequestIds)
      .sort()
      .forEach((id) => {
        console.log(`  - ${id}`);
      });

    if (!targetCall) {
      console.log(
        `❌ No call found with call_request_id.id = ${callRequestId}`
      );
      return {
        source: "not_found",
        callRequestId: callRequestId,
        totalCallsSearched: callLogs.length,
        found: false,
      };
    }

    // Step 3: Extract campaign information from the found call
    console.log("\n🔍 Extracting campaign information from the call...");

    let campaignId = null;
    let campaignSource = null;

    // Method 1: Check for direct campaign_id field
    if (targetCall.campaign_id) {
      campaignId = targetCall.campaign_id;
      campaignSource = "campaign_id field";
      console.log(`✅ Found campaign_id: ${campaignId}`);
    }

    // Method 2: Check for bulk_call_id field
    else if (targetCall.bulk_call_id) {
      campaignId = targetCall.bulk_call_id;
      campaignSource = "bulk_call_id field";
      console.log(`✅ Found bulk_call_id: ${campaignId}`);
    }

    // Method 3: Extract from webhook payload
    else if (
      targetCall.post_call_actions?.call_recording_webhook_ids?.length > 0
    ) {
      for (const webhook of targetCall.post_call_actions
        .call_recording_webhook_ids) {
        if (webhook.payload) {
          try {
            const payloadData = JSON.parse(webhook.payload);
            if (payloadData.campaign_id) {
              campaignId = payloadData.campaign_id;
              campaignSource = "webhook payload campaign_id";
              console.log(`✅ Found campaign_id in webhook: ${campaignId}`);
              break;
            }
            if (payloadData.bulk_call_id) {
              campaignId = payloadData.bulk_call_id;
              campaignSource = "webhook payload bulk_call_id";
              console.log(`✅ Found bulk_call_id in webhook: ${campaignId}`);
              break;
            }
          } catch (e) {
            // Ignore JSON parse errors
          }
        }
      }
    }

    if (!campaignId) {
      console.log("❌ No campaign ID found in the call data");
      return {
        source: "call_found_no_campaign",
        callRequestId: callRequestId,
        callData: targetCall,
        found: true,
        campaignId: null,
      };
    }

    // Step 4: Fetch campaign details using the found campaign ID
    console.log(`\n🔍 Fetching campaign details for ID: ${campaignId}`);

    const campaignEndpoints = [
      `/campaigns/${campaignId}`,
      `/bulk-calls/${campaignId}`,
      `/calls/campaigns/${campaignId}`,
      `/v1/campaigns/${campaignId}`,
      `/v1/bulk-calls/${campaignId}`,
    ];

    let campaignData = null;
    let successfulCampaignEndpoint = null;

    for (const endpoint of campaignEndpoints) {
      try {
        console.log(`🔍 Trying campaign endpoint: ${endpoint}`);
        const campaignResponse = await axios.get(
          `${process.env.OMNIDIMENSION_BASE_URL}${endpoint}`,
          {
            headers: {
              Authorization: `Bearer ${process.env.OMNIDIMENSION_API_KEY}`,
              "Content-Type": "application/json",
            },
            timeout: process.env.OMNIDIMENSION_API_TIMEOUT || 30000,
          }
        );

        if (campaignResponse.data) {
          campaignData = campaignResponse.data;
          successfulCampaignEndpoint = endpoint;
          console.log(`✅ Success with endpoint: ${endpoint}`);
          break;
        }
      } catch (error) {
        console.log(
          `❌ Failed with endpoint: ${endpoint} - ${
            error.response?.status || error.message
          }`
        );
        continue;
      }
    }

    const campaignName =
      campaignData?.name ||
      campaignData?.campaign_name ||
      campaignData?.title ||
      `Campaign ${campaignId}`;

    console.log("\n📋 FINAL RESULTS:");
    console.log(`🎯 Campaign ID: ${campaignId}`);
    console.log(`🏆 Campaign Name: ${campaignName}`);
    console.log(`📊 Campaign Source: ${campaignSource}`);
    console.log(`🔗 Successful Campaign Endpoint: ${successfulCampaignEndpoint || "None"}`);

    return {
      source: "omnidimension_call_logs",
      callRequestId: callRequestId,
      campaignId: campaignId,
      campaignName: campaignName,
      campaignSource: campaignSource,
      endpoint: successfulCampaignEndpoint,
      callData: targetCall,
      campaignData: campaignData,
      found: true,
    };
  } catch (error) {
    console.error("❌ Error:", error.message);
    if (error.response) {
      console.error("📊 API Error Status:", error.response.status);
      console.error("📊 API Error Data:", error.response.data);
    }
    return null;
  }
}

/**
 * Main execution function
 */
async function main() {
  const callRequestId = process.argv[2] || "232278";

  console.log("🚀 Starting Campaign Fetch Script");
  console.log(
    `🎯 Target Call Request ID (from call_request_id.id): ${callRequestId}`
  );
  console.log("============================================================");

  const result = await fetchCampaignForCallRequest(callRequestId);

  if (result) {
    console.log("\n" + "=".repeat(60));
    console.log("📊 FINAL RESULT:");
    console.log("=".repeat(60));
    console.log(JSON.stringify(result, null, 2));
  }
}

// Run the script if called directly
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { fetchCampaignForCallRequest };
