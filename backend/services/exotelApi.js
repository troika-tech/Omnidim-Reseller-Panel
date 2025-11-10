const axios = require("axios");
const config = require("../config/env.js");

/**
 * Exotel API Service
 * Handles all Exotel API interactions for fetching call recordings
 */

// Create axios instance for Exotel API
function createExotelClient() {
  if (
    !config.exotel.apiKey ||
    !config.exotel.apiToken ||
    !config.exotel.accountSid ||
    !config.exotel.subdomain
  ) {
    console.warn(
      "⚠️  Exotel credentials not configured. Recording fetch will be disabled."
    );
    return null;
  }

  const baseURL = `https://${config.exotel.subdomain}.exotel.com/v1/Accounts/${config.exotel.accountSid}`;

  // Basic Authentication: base64(apiKey:apiToken)
  const auth = Buffer.from(
    `${config.exotel.apiKey}:${config.exotel.apiToken}`
  ).toString("base64");

  const exotelApi = axios.create({
    baseURL: baseURL,
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    timeout: config.exotel.timeout || 30000,
  });

  // Handle API errors
  exotelApi.interceptors.response.use(
    (response) => response,
    (error) => {
      console.error("Exotel API Error:", error.response?.data || error.message);
      return Promise.reject(error);
    }
  );

  return exotelApi;
}

// Format phone number for Exotel API
// Removes +91, leading 0, spaces, etc.
function formatPhoneNumberForExotel(phoneNumber) {
  if (!phoneNumber) return "";

  // Remove all non-digit characters
  let formatted = phoneNumber.replace(/\D/g, "");

  // Remove +91 country code if present
  if (formatted.startsWith("91") && formatted.length > 10) {
    formatted = formatted.substring(2);
  }

  // Remove leading 0 if present (Indian numbers)
  if (formatted.startsWith("0") && formatted.length > 10) {
    formatted = formatted.substring(1);
  }

  return formatted;
}

/**
 * Fetch calls from Exotel API with filters
 * @param {string} phoneNumber - Phone number to filter by (Exotel number)
 * @param {Date} startDate - Start date for search
 * @param {Date} endDate - End date for search
 * @param {number} pageSize - Number of results per page (default: 100)
 * @returns {Promise<Array>} Array of call records from Exotel
 */
async function fetchCallsFromExotel(
  phoneNumber,
  startDate,
  endDate,
  pageSize = 100
) {
  const client = createExotelClient();
  if (!client) {
    console.warn("⚠️  Exotel client not available");
    return [];
  }

  try {
    // Format phone number for Exotel API
    let formattedPhone = formatPhoneNumberForExotel(phoneNumber);

    // Add +91 if not present (Exotel expects +91XXXXXXXXXX format)
    if (!formattedPhone.startsWith("+91")) {
      formattedPhone = "+91" + formattedPhone;
    }

    // Format dates for Exotel API (YYYY-MM-DD HH:MM:SS)
    const formatDateForExotel = (date) => {
      if (!date) return null;
      const d = new Date(date);
      if (isNaN(d.getTime())) return null;
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      const hours = String(d.getHours()).padStart(2, "0");
      const minutes = String(d.getMinutes()).padStart(2, "0");
      const seconds = String(d.getSeconds()).padStart(2, "0");
      return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    };

    const defaultStartDate =
      startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // Last 30 days
    const defaultEndDate = endDate || new Date();

    const startTime = formatDateForExotel(defaultStartDate);
    const endTime = formatDateForExotel(defaultEndDate);

    if (!startTime || !endTime) {
      console.warn("⚠️  Invalid date range for Exotel search");
      return [];
    }

    // Build query parameters
    // Note: Exotel API endpoint is configured via EXOTEL_SUBDOMAIN
    // DateCreated format: gte:YYYY-MM-DD HH:MM:SS;lte:YYYY-MM-DD HH:MM:SS
    // Exotel expects spaces to be URL-encoded as %20, but colons and semicolons should remain unencoded
    // Since axios params will encode everything, we need to manually construct the query string
    const exotelBaseURL = `https://${config.exotel.subdomain}.exotel.com/v1/Accounts/${config.exotel.accountSid}`;

    // Format DateCreated: Exotel expects single DateCreated parameter with semicolon separator
    // Format: DateCreated=gte:YYYY-MM-DD HH:MM:SS;lte:YYYY-MM-DD HH:MM:SS
    // Spaces should be URL-encoded as %20, semicolon should be URL-encoded as %3B
    const dateCreatedParam = `gte:${startTime.replace(
      / /g,
      "%20"
    )}%3Blte:${endTime.replace(/ /g, "%20")}`;

    // Build query string manually to preserve special characters
    // Use single DateCreated parameter with semicolon separator
    const encodedPhoneNumber = encodeURIComponent(formattedPhone);
    
    // Try using 'To' parameter instead of 'PhoneNumber' to get calls TO your number
    // This should return calls where customers called your Exotel number
    const queryString = `DateCreated=${dateCreatedParam}&To=${encodedPhoneNumber}&details=true&PageSize=${pageSize}`;
    
    console.log(`🔄 Using 'To' parameter instead of 'PhoneNumber' to get incoming calls`);

    console.log(`📞 Fetching Exotel calls for ${formattedPhone} from ${startTime} to ${endTime}`);
    console.log(`📅 DateCreated param: ${dateCreatedParam}`);
    console.log(`🔗 Full query string: ${queryString}`);

    // Make request to Exotel API with manually constructed query string
    const response = await axios.get(
      `${exotelBaseURL}/Calls.json?${queryString}`,
      {
        auth: {
          username: config.exotel.apiKey,
          password: config.exotel.apiToken,
        },
        headers: {
          "Content-Type": "application/json",
        },
        timeout: config.exotel.timeout || 30000,
      }
    );

    // Parse Exotel response - it can be in different formats
    let calls = [];

    if (response.data) {
      // Format 1: { Calls: [...] }
      if (response.data.Calls && Array.isArray(response.data.Calls)) {
        calls = response.data.Calls;
      }
      // Format 2: { Calls: { Call: [...] } }
      else if (response.data.Calls && response.data.Calls.Call) {
        calls = Array.isArray(response.data.Calls.Call)
          ? response.data.Calls.Call
          : [response.data.Calls.Call];
      }
      // Format 3: { Call: [...] }
      else if (response.data.Call) {
        calls = Array.isArray(response.data.Call)
          ? response.data.Call
          : [response.data.Call];
      }
      // Format 4: Array directly
      else if (Array.isArray(response.data)) {
        calls = response.data;
      }
    }

    if (calls.length > 0) {
      console.log(`✅ Fetched ${calls.length} calls from Exotel`);
      return calls;
    }

    console.log("⚠️  No calls found in Exotel response");
    return [];
  } catch (error) {
    console.error(
      "❌ Error fetching calls from Exotel:",
      error.response?.data || error.message
    );
    return [];
  }
}

/**
 * Search calls by phone number and date range
 * @param {string} toNumber - Phone number that was called (destination)
 * @param {string} fromNumber - Phone number that made the call (source)
 * @param {Date} startDate - Start date for search
 * @param {Date} endDate - End date for search
 * @returns {Promise<Array>} Array of call records with RecordingUrl
 */
async function searchCallsByNumber(toNumber, fromNumber, startDate, endDate) {
  const client = createExotelClient();
  if (!client) {
    return [];
  }

  try {
    // Format phone numbers
    const formattedTo = formatPhoneNumberForExotel(toNumber);
    const formattedFrom = formatPhoneNumberForExotel(fromNumber);

    // Format dates for Exotel API (YYYY-MM-DD HH:MM:SS)
    const formatDateForExotel = (date) => {
      if (!date) return null;
      const d = new Date(date);
      if (isNaN(d.getTime())) return null;
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      const hours = String(d.getHours()).padStart(2, "0");
      const minutes = String(d.getMinutes()).padStart(2, "0");
      const seconds = String(d.getSeconds()).padStart(2, "0");
      return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    };

    const defaultStartDate =
      startDate || new Date(Date.now() - 24 * 60 * 60 * 1000);
    const defaultEndDate = endDate || new Date();

    const startTime = formatDateForExotel(defaultStartDate);
    const endTime = formatDateForExotel(defaultEndDate);

    if (!startTime || !endTime) {
      console.warn("⚠️  Invalid date range for Exotel search");
      return [];
    }

    // IMPORTANT: Exotel treats From/To in reverse order
    // In our system: fromNumber = source (who made the call), toNumber = destination (who was called)
    // In Exotel: From = destination (who was called), To = source (who made the call)
    // So we need to swap them when searching Exotel API
    const paramsSwapped = {
      From: formattedTo, // Swap: Exotel's From = our destination (toNumber)
      To: formattedFrom, // Swap: Exotel's To = our source (fromNumber)
      StartTime: startTime,
      EndTime: endTime,
    };

    console.log(`🔍 Searching Exotel calls (From/To swapped):`, paramsSwapped);

    let response;
    let calls = [];

    // Try with swapped From/To first (correct way)
    try {
      response = await client.get("/Calls.json", { params: paramsSwapped });

      // Parse Exotel response
      if (response.data) {
        if (response.data.Calls && response.data.Calls.Call) {
          calls = Array.isArray(response.data.Calls.Call)
            ? response.data.Calls.Call
            : [response.data.Calls.Call];
        } else if (response.data.Call) {
          calls = Array.isArray(response.data.Call)
            ? response.data.Call
            : [response.data.Call];
        } else if (Array.isArray(response.data)) {
          calls = response.data;
        }
      }

      // If no results with swapped, try without swap as fallback
      if (calls.length === 0 && formattedFrom) {
        console.log(
          `🔍 No results with swapped From/To, trying original order...`
        );
        const paramsOriginal = {
          From: formattedFrom, // Original: Exotel's From = our source (fromNumber)
          To: formattedTo, // Original: Exotel's To = our destination (toNumber)
          StartTime: startTime,
          EndTime: endTime,
        };

        try {
          response = await client.get("/Calls.json", {
            params: paramsOriginal,
          });

          // Parse response
          if (response.data) {
            if (response.data.Calls && response.data.Calls.Call) {
              calls = Array.isArray(response.data.Calls.Call)
                ? response.data.Calls.Call
                : [response.data.Calls.Call];
            } else if (response.data.Call) {
              calls = Array.isArray(response.data.Call)
                ? response.data.Call
                : [response.data.Call];
            } else if (Array.isArray(response.data)) {
              calls = response.data;
            }
          }
        } catch (fallbackError) {
          // Ignore fallback errors
          console.log(`⚠️  Fallback search also failed, using empty results`);
        }
      }
    } catch (error) {
      throw error; // Re-throw if primary search fails
    }

    console.log(`✅ Found ${calls.length} calls in Exotel`);
    return calls;
  } catch (error) {
    console.error(
      `❌ Error searching Exotel calls:`,
      error.response?.status,
      error.response?.data || error.message
    );
    // Return empty array instead of throwing to avoid breaking the flow
    return [];
  }
}

/**
 * Get call recording URL by phone number and date range
 * @param {string} toNumber - Phone number that was called (destination)
 * @param {string} fromNumber - Phone number that made the call (source, optional)
 * @param {Date} callDate - Approximate call date
 * @returns {Promise<string|null>} Recording URL or null if not found
 */
async function getCallRecording(toNumber, fromNumber, callDate) {
  if (!toNumber || !callDate) {
    return null;
  }

  try {
    // Create date range: ±5 minutes from call date
    const dateRange = 5 * 60 * 1000; // 5 minutes in milliseconds
    const startDate = new Date(callDate.getTime() - dateRange);
    const endDate = new Date(callDate.getTime() + dateRange);

    // Search for calls (From/To will be swapped inside searchCallsByNumber)
    const calls = await searchCallsByNumber(
      toNumber,
      fromNumber,
      startDate,
      endDate
    );

    if (!calls || calls.length === 0) {
      console.log(`⚠️  No calls found in Exotel for ${toNumber}`);
      return null;
    }

    // Find the closest match by date
    let closestCall = null;
    let closestTimeDiff = Infinity;

    for (const call of calls) {
      if (!call.RecordingUrl && !call.RecordingSid) continue;

      // Parse call start time
      let callStartTime = null;
      if (call.StartTime) {
        callStartTime = new Date(call.StartTime);
      } else if (call.Start) {
        callStartTime = new Date(call.Start);
      }

      if (callStartTime) {
        const timeDiff = Math.abs(callStartTime.getTime() - callDate.getTime());
        if (timeDiff < closestTimeDiff) {
          closestTimeDiff = timeDiff;
          closestCall = call;
        }
      }
    }

    // If no call with recording found, try first call with recording
    if (!closestCall) {
      closestCall = calls.find(
        (call) => call.RecordingUrl || call.RecordingSid
      );
    }

    if (!closestCall) {
      console.log(`⚠️  No recording found in Exotel for ${toNumber}`);
      return null;
    }

    // Extract recording URL
    let recordingUrl = closestCall.RecordingUrl;

    // If only RecordingSid is available, construct URL
    if (!recordingUrl && closestCall.RecordingSid) {
      recordingUrl = `https://${config.exotel.subdomain}.exotel.com/v1/Accounts/${config.exotel.accountSid}/Recordings/${closestCall.RecordingSid}.mp3`;
    }

    if (recordingUrl) {
      console.log(
        `✅ Found recording URL for ${toNumber}: ${recordingUrl.substring(
          0,
          50
        )}...`
      );
      return recordingUrl;
    }

    return null;
  } catch (error) {
    console.error(
      `❌ Error getting call recording for ${toNumber}:`,
      error.message
    );
    return null;
  }
}

/**
 * Get call details by CallSid
 * @param {string} callSid - Exotel CallSid
 * @returns {Promise<object|null>} Call details with RecordingUrl
 */
async function getCallDetails(callSid) {
  const client = createExotelClient();
  if (!client || !callSid) {
    return null;
  }

  try {
    const response = await client.get(`/Calls/${callSid}.json`);

    if (response.data && response.data.Call) {
      const call = response.data.Call;

      // Construct recording URL if only RecordingSid is available
      let recordingUrl = call.RecordingUrl;
      if (!recordingUrl && call.RecordingSid) {
        recordingUrl = `https://${config.exotel.subdomain}.exotel.com/v1/Accounts/${config.exotel.accountSid}/Recordings/${call.RecordingSid}.mp3`;
      }

      return {
        ...call,
        RecordingUrl: recordingUrl,
      };
    }

    return null;
  } catch (error) {
    console.error(
      `❌ Error getting call details for ${callSid}:`,
      error.response?.status,
      error.response?.data || error.message
    );
    return null;
  }
}

/**
 * Fetch incoming calls from Exotel API with date range chunking for complete results
 * @param {object} params - Query parameters
 * @param {string} params.From - Caller's phone number (optional)
 * @param {string} params.To - Called phone number (optional)
 * @param {string} params.StartTime - Start time in YYYY-MM-DD HH:MM:SS format
 * @param {string} params.EndTime - End time in YYYY-MM-DD HH:MM:SS format
 * @param {number} params.chunkDays - Number of days per chunk (default: 1 day)
 * @returns {Promise<Array>} Array of incoming call records
 */
async function fetchIncomingCalls(params = {}) {
  const client = createExotelClient();
  if (!client) {
    return [];
  }

  // Get baseURL for pagination
  const baseURL = `https://${config.exotel.subdomain}.exotel.com/v1/Accounts/${config.exotel.accountSid}`;

  try {
    // Format dates for Exotel API
    const formatDateForExotel = (date) => {
      if (!date) return null;
      const d = new Date(date);
      if (isNaN(d.getTime())) return null;
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      const hours = String(d.getHours()).padStart(2, "0");
      const minutes = String(d.getMinutes()).padStart(2, "0");
      const seconds = String(d.getSeconds()).padStart(2, "0");
      return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    };

    // Parse start and end dates (handle both Date objects and date strings)
    let startDate = params.StartTime
      ? params.StartTime instanceof Date
        ? params.StartTime
        : new Date(params.StartTime)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    let endDate = params.EndTime
      ? params.EndTime instanceof Date
        ? params.EndTime
        : new Date(params.EndTime)
      : new Date();

    // Ensure valid dates
    if (isNaN(startDate.getTime())) {
      console.warn("⚠️  Invalid StartTime, using default (last 30 days)");
      startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    }
    if (isNaN(endDate.getTime())) {
      console.warn("⚠️  Invalid EndTime, using default (now)");
      endDate = new Date();
    }

    // Build base query parameters
    // Try without CallType first, then filter in code if needed
    const baseQueryParams = {};

    // Only add CallType if we want to filter (but Exotel might not support it)
    // We'll filter in code instead
    // baseQueryParams.CallType = 'incoming';

    if (params.From) {
      baseQueryParams.From = formatPhoneNumberForExotel(params.From);
    }
    if (params.To) {
      baseQueryParams.To = formatPhoneNumberForExotel(params.To);
    }

    const chunkDays = params.chunkDays || 1; // Default: 1 day chunks
    const allCalls = [];
    const seenCallSids = new Set(); // To avoid duplicates

    // Split date range into chunks to ensure we get all calls
    const totalDays = Math.ceil((endDate - startDate) / (24 * 60 * 60 * 1000));
    const numChunks = Math.ceil(totalDays / chunkDays);

    console.log(
      `🔍 Fetching incoming calls from Exotel (${totalDays} days, split into ${numChunks} chunks of ${chunkDays} day(s)):`
    );

    // Fetch calls in chunks
    for (let i = 0; i < numChunks; i++) {
      try {
        // Calculate chunk date range
        const chunkStart = new Date(
          startDate.getTime() + i * chunkDays * 24 * 60 * 60 * 1000
        );
        const chunkEnd = new Date(
          Math.min(
            chunkStart.getTime() + chunkDays * 24 * 60 * 60 * 1000 - 1,
            endDate.getTime()
          )
        );

        const queryParams = {
          ...baseQueryParams,
          StartTime: formatDateForExotel(chunkStart),
          EndTime: formatDateForExotel(chunkEnd),
        };

        console.log(
          `📅 Chunk ${i + 1}/${numChunks}: ${formatDateForExotel(
            chunkStart
          )} to ${formatDateForExotel(chunkEnd)}`
        );

        // Fetch all pages for this chunk (pagination)
        let nextPageUrl = null;
        let pageNum = 1;
        let chunkCalls = [];
        let consecutiveEmptyPages = 0; // Track consecutive pages with 0 incoming calls

        do {
          try {
            let response;

            if (nextPageUrl) {
              // Fetch next page using NextPageUri
              // NextPageUri from Exotel is a relative URL like "/v1/Accounts/troikaplus1/Calls.json?..."
              // Since our axios client already has baseURL set to "https://api.exotel.com/v1/Accounts/troikaplus1",
              // we need to extract just the path after the baseURL part
              let pathWithQuery = nextPageUrl;

              if (nextPageUrl.startsWith("http")) {
                // If it's a full URL, extract path and query, then remove the base path
                try {
                  const url = new URL(nextPageUrl);
                  pathWithQuery = url.pathname + url.search;
                  // Remove the base path "/v1/Accounts/{accountSid}" from the path
                  const basePathPattern = `/v1/Accounts/${config.exotel.accountSid}`;
                  if (pathWithQuery.startsWith(basePathPattern)) {
                    pathWithQuery = pathWithQuery.substring(
                      basePathPattern.length
                    );
                  }
                  console.log(
                    `   🔗 Using NextPageUri (full URL): ${pathWithQuery}`
                  );
                } catch (urlError) {
                  console.error(
                    `   ⚠️  Error parsing NextPageUri URL: ${urlError.message}`
                  );
                  pathWithQuery = nextPageUrl;
                }
              } else if (nextPageUrl.startsWith("/")) {
                // Remove the base path "/v1/Accounts/{accountSid}" from the relative URL
                const basePathPattern = `/v1/Accounts/${config.exotel.accountSid}`;
                if (pathWithQuery.startsWith(basePathPattern)) {
                  pathWithQuery = pathWithQuery.substring(
                    basePathPattern.length
                  );
                  console.log(
                    `   🔗 Using NextPageUri (removed base path): ${pathWithQuery.substring(
                      0,
                      100
                    )}...`
                  );
                } else {
                  console.log(
                    `   🔗 Using NextPageUri (relative): ${pathWithQuery.substring(
                      0,
                      100
                    )}...`
                  );
                }
              } else {
                // If it doesn't start with /, use it as is
                console.log(
                  `   ⚠️  Unexpected NextPageUri format: ${nextPageUrl.substring(
                    0,
                    100
                  )}`
                );
                pathWithQuery = nextPageUrl;
              }

              try {
                response = await client.get(pathWithQuery);
              } catch (pageError) {
                console.error(
                  `   ⚠️  Error fetching page ${pageNum} with NextPageUri: ${pathWithQuery}`
                );
                console.error(`   Original NextPageUri: ${nextPageUrl}`);
                console.error(`   Error: ${pageError.message}`);
                if (pageError.response) {
                  console.error(`   Status: ${pageError.response.status}`);
                  console.error(
                    `   Response: ${JSON.stringify(
                      pageError.response.data
                    ).substring(0, 200)}`
                  );
                }
                // Stop pagination for this chunk - set nextPageUrl to null to exit loop
                nextPageUrl = null;
                break;
              }
            } else {
              // First page of this chunk
              response = await client.get("/Calls.json", {
                params: queryParams,
              });
            }

            // If response is undefined (due to error), skip processing
            if (!response) {
              break;
            }

            // Debug: Log full response for first chunk and first page
            if (i === 0 && pageNum === 1) {
              console.log(`   🔍 Debug - Full API Response Structure:`);
              console.log(`   Status: ${response.status}`);
              if (response.data) {
                console.log(`   Response Keys:`, Object.keys(response.data));
                if (response.data.Metadata) {
                  console.log(
                    `   📊 Total Calls: ${
                      response.data.Metadata.Total || "N/A"
                    }`
                  );
                  console.log(
                    `   📄 Page Size: ${
                      response.data.Metadata.PageSize || "N/A"
                    }`
                  );
                }
              }
            }

            let rawCalls = [];

            // Parse response based on Exotel API structure
            if (response.data) {
              // Check for Metadata to get pagination info
              if (response.data.Metadata) {
                const metadata = response.data.Metadata;
                if (pageNum === 1) {
                  console.log(
                    `   📊 Total calls in date range: ${
                      metadata.Total || "N/A"
                    }`
                  );
                  console.log(
                    `   📄 NextPageUri: ${metadata.NextPageUri || "N/A"}`
                  );
                  console.log(
                    `   📄 PrevPageUri: ${metadata.PrevPageUri || "N/A"}`
                  );
                }
                nextPageUrl = metadata.NextPageUri || null;

                // Debug NextPageUri for troubleshooting
                if (nextPageUrl && pageNum === 1) {
                  console.log(
                    `   🔍 NextPageUri format: ${nextPageUrl.substring(
                      0,
                      100
                    )}...`
                  );
                }

                // Stop pagination if NextPageUri is null (no more pages)
                if (!nextPageUrl && pageNum > 1) {
                  console.log(
                    `   ✅ No more pages (NextPageUri is null), stopping pagination`
                  );
                }
              }

              // Parse calls array
              if (response.data.Calls) {
                if (Array.isArray(response.data.Calls)) {
                  rawCalls = response.data.Calls;
                } else if (response.data.Calls.Call) {
                  rawCalls = Array.isArray(response.data.Calls.Call)
                    ? response.data.Calls.Call
                    : [response.data.Calls.Call];
                }
              } else if (response.data.Call) {
                rawCalls = Array.isArray(response.data.Call)
                  ? response.data.Call
                  : [response.data.Call];
              } else if (Array.isArray(response.data)) {
                rawCalls = response.data;
              }
            }

            // Stop pagination if we get 0 calls (no more data)
            // This prevents infinite loops when Exotel keeps returning NextPageUri with no calls
            if (rawCalls.length === 0) {
              console.log(
                `   ⚠️  No calls in response (page ${pageNum}), stopping pagination for this chunk`
              );
              nextPageUrl = null;
            }

            // Debug: Show sample call structure for first chunk and first page
            if (i === 0 && pageNum === 1 && rawCalls.length > 0) {
              console.log(
                `   🔍 Sample raw call structure:`,
                JSON.stringify(rawCalls[0], null, 2)
              );
            }

            // Filter incoming calls - Exotel uses Direction: "inbound" for incoming calls
            const incomingCalls = rawCalls.filter((call) => {
              const callSid = call.Sid || call.CallSid || call.callSid;
              if (!callSid || seenCallSids.has(callSid)) {
                return false;
              }

              // Exotel uses Direction field for call type
              // "inbound" = incoming call, "outbound-api" = outgoing call
              const direction = call.Direction || call.direction;
              const callType = call.CallType || call.callType;

              // Check if it's an incoming call
              // Exotel uses "inbound" for incoming calls
              const isIncoming =
                direction === "inbound" ||
                direction === "incoming" ||
                direction === "in" ||
                callType === "incoming" ||
                callType === "inbound" ||
                callType === "in";

              return isIncoming;
            });

            // Add to seen set
            incomingCalls.forEach((call) => {
              const callSid = call.Sid || call.CallSid || call.callSid;
              if (callSid) {
                seenCallSids.add(callSid);
              }
            });

            chunkCalls.push(...incomingCalls);

            if (pageNum === 1) {
              console.log(
                `   📄 Page ${pageNum}: ${rawCalls.length} raw calls, ${incomingCalls.length} incoming calls`
              );
            } else {
              console.log(
                `   📄 Page ${pageNum}: ${rawCalls.length} raw calls, ${incomingCalls.length} incoming calls (Total in chunk: ${chunkCalls.length})`
              );
            }

            // Track consecutive pages with 0 incoming calls
            // If we get 2+ consecutive pages with 0 incoming calls after page 1,
            // we've likely moved outside the chunk's date range or exhausted calls
            if (incomingCalls.length === 0) {
              consecutiveEmptyPages++;
              // Stop pagination if we get 2 consecutive pages with 0 incoming calls
              // This prevents infinite loops when NextPageUri points to outside chunk range
              if (consecutiveEmptyPages >= 2 && pageNum > 1) {
                console.log(
                  `   ⚠️  Stopping pagination: ${consecutiveEmptyPages} consecutive pages with 0 incoming calls (likely outside chunk date range)`
                );
                nextPageUrl = null;
              }
            } else {
              consecutiveEmptyPages = 0; // Reset counter when we find incoming calls
            }

            pageNum++;

            // Small delay between pages to avoid rate limiting
            if (nextPageUrl && rawCalls.length > 0) {
              await new Promise((resolve) => setTimeout(resolve, 200));
            }
          } catch (pageError) {
            console.error(
              `⚠️  Error fetching page ${pageNum} of chunk ${i + 1}:`,
              pageError.message
            );
            break; // Stop pagination for this chunk if error occurs
          }
        } while (nextPageUrl);

        allCalls.push(...chunkCalls);
        console.log(
          `   ✅ Found ${chunkCalls.length} incoming calls in this chunk (Total so far: ${allCalls.length})`
        );

        // Small delay to avoid rate limiting
        if (i < numChunks - 1) {
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
      } catch (chunkError) {
        console.error(`⚠️  Error fetching chunk ${i + 1}:`, chunkError.message);
        // Continue with next chunk even if one fails
      }
    }

    console.log(
      `✅ Found total ${allCalls.length} unique incoming calls in Exotel (fetched ${numChunks} chunk(s))`
    );
    return allCalls;
  } catch (error) {
    console.error(
      `❌ Error fetching incoming calls from Exotel:`,
      error.response?.status,
      error.response?.data || error.message
    );
    return [];
  }
}

/**
 * Get incoming call details by CallSid
 * @param {string} callSid - Exotel CallSid
 * @returns {Promise<object|null>} Incoming call details with RecordingUrl
 */
async function getIncomingCallDetails(callSid) {
  return await getCallDetails(callSid);
}

/**
 * Update Exotel webhook URL for a virtual number
 * @param {string} phoneNumber - Virtual phone number (ExoPhone number)
 * @param {string} webhookUrl - Webhook URL to set
 * @returns {Promise<object|null>} Response from Exotel API
 */
async function updateWebhookUrl(phoneNumber, webhookUrl) {
  const client = createExotelClient();
  if (!client || !phoneNumber || !webhookUrl) {
    throw new Error("Missing required parameters: phoneNumber and webhookUrl");
  }

  try {
    // Format phone number
    const formattedNumber = formatPhoneNumberForExotel(phoneNumber);

    // Exotel API endpoint for updating virtual number webhook
    const url = `/IncomingPhoneNumbers/${formattedNumber}/update`;

    // Exotel expects form-encoded data
    const formData = new URLSearchParams();
    formData.append("app_url", webhookUrl);

    console.log(
      `🔧 Updating Exotel webhook for ${formattedNumber}: ${webhookUrl}`
    );

    const response = await client.post(url, formData.toString(), {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });

    console.log(`✅ Webhook updated successfully:`, response.data);
    return response.data;
  } catch (error) {
    console.error(
      `❌ Error updating Exotel webhook:`,
      error.response?.status,
      error.response?.data || error.message
    );
    throw error;
  }
}

module.exports = {
  fetchCallsFromExotel,
  getCallRecording,
  searchCallsByNumber,
  getCallDetails,
  formatPhoneNumberForExotel,
  fetchIncomingCalls,
  getIncomingCallDetails,
  updateWebhookUrl,
};
