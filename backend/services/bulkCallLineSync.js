const BulkCallLine = require('../models/BulkCallLine');
const { fetchFromOmnidimension } = require('./omniApi');

const DEFAULT_PAGE_SIZE =
  parseInt(process.env.BULK_CALL_LOG_SYNC_PAGE_SIZE, 10) || 200;
const DEFAULT_MAX_PAGES =
  parseInt(process.env.BULK_CALL_LOG_SYNC_MAX_PAGES, 10) || 10;

/**
 * Sync bulk call line documents using Omni call logs.
 *
 * @param {Object} params
 * @param {string|number} params.campaignId - Omni campaign identifier
 * @param {import('mongoose').Document} params.bulkCall - BulkCall mongoose document
 * @param {number} [params.pageSize=DEFAULT_PAGE_SIZE]
 * @param {number} [params.maxPages=DEFAULT_MAX_PAGES]
 * @returns {Promise<Object>} Summary of sync operation
 */
async function syncBulkCallLinesFromLogs({
  campaignId,
  bulkCall,
  pageSize = DEFAULT_PAGE_SIZE,
  maxPages = DEFAULT_MAX_PAGES
}) {
  if (!bulkCall || !bulkCall._id) {
    throw new Error('bulkCall document is required for log sync.');
  }

  const campaignSnapshot = await fetchCampaignSnapshot(campaignId);
  const mergedContactNumbers = mergeContactNumbers(
    bulkCall.phoneNumbers,
    campaignSnapshot.contactNumbers
  );

  if (mergedContactNumbers.changed) {
    try {
      bulkCall.phoneNumbers = mergedContactNumbers.values;
      await bulkCall.save();
    } catch (updateError) {
      console.error(
        `⚠️  Failed to update bulk call phone numbers for campaign ${campaignId}:`,
        updateError.message
      );
    }
  }

  const context = buildMatchContext({
    bulkCall,
    campaignSnapshot
  });

  const processedCallIds = new Set();
  let pageNo = 1;
  let totalFetched = 0;
  let matched = 0;
  let upserted = 0;
  let updated = 0;

  while (pageNo <= maxPages) {
    const pageData = await fetchLogsPage(pageNo, pageSize);
    if (!pageData.logs.length) {
      break;
    }

    totalFetched += pageData.logs.length;

    for (const log of pageData.logs) {
      const normalized = normalizeLog(log, context);
      if (!normalized) {
        continue;
      }

      if (processedCallIds.has(normalized.callRequestId)) {
        continue;
      }
      processedCallIds.add(normalized.callRequestId);
      matched++;

      const result = await upsertBulkCallLine({
        bulkCall,
        normalized
      });

      if (result.upserted) {
        upserted++;
      } else if (result.modified) {
        updated++;
      }
    }

    if (pageData.logs.length < pageSize) {
      break;
    }

    pageNo++;
  }

  return {
    matched,
    upserted,
    updated,
    totalFetched,
    pagesFetched: pageNo - 1,
    contactNumbers: mergedContactNumbers.values.length
  };
}

async function fetchCampaignSnapshot(campaignId) {
  try {
    const response = await fetchFromOmnidimension(
      `calls/bulk_call/${campaignId}`,
      'GET'
    );

    const details = response?.details || response || {};
    const contactList = Array.isArray(response?.contact_list)
      ? response.contact_list
      : Array.isArray(details?.contact_list)
      ? details.contact_list
      : [];

    const contactNumbers = contactList
      .map((item) => item?.to_number || item?.phone_number || item?.number)
      .filter(Boolean);

    return {
      contactNumbers,
      fromNumber:
        details.twilio_number ||
        details.from_number ||
        details.number ||
        null,
      botName: details.bot_name || null
    };
  } catch (error) {
    console.error(
      `⚠️  Failed to fetch campaign snapshot for ${campaignId}:`,
      error.message
    );
    return {
      contactNumbers: [],
      fromNumber: null,
      botName: null
    };
  }
}

function mergeContactNumbers(existing = [], incoming = []) {
  const existingSet = new Set((existing || []).filter(Boolean));
  let changed = false;

  (incoming || []).forEach((num) => {
    if (num && !existingSet.has(num)) {
      existingSet.add(num);
      changed = true;
    }
  });

  return {
    changed,
    values: Array.from(existingSet)
  };
}

function buildMatchContext({ bulkCall, campaignSnapshot }) {
  const contactNumbers = mergeUnique(
    campaignSnapshot.contactNumbers,
    bulkCall.phoneNumbers
  ).map(sanitizePhoneNumber);

  const contactNumberSet = new Set(contactNumbers.filter(Boolean));

  return {
    contactNumberSet,
    hasContacts: contactNumberSet.size > 0,
    fromNumberSanitized: sanitizePhoneNumber(
      campaignSnapshot.fromNumber || bulkCall.fromNumber
    ),
    botNameLower: (campaignSnapshot.botName || bulkCall.botName || '')
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/[^\w\s]/g, ''),
    allowedStatuses: new Set([
      'completed',
      'failed',
      'busy',
      'no-answer',
      'pending',
      'cancelled'
    ])
  };
}

function mergeUnique(arr1 = [], arr2 = []) {
  const merged = new Set();
  (arr1 || []).forEach((value) => value && merged.add(value));
  (arr2 || []).forEach((value) => value && merged.add(value));
  return Array.from(merged);
}

async function fetchLogsPage(pageNo, pageSize) {
  try {
    const response = await fetchFromOmnidimension('calls/logs', 'GET', {
      pageno: pageNo,
      pagesize: pageSize
    });

    const logs = Array.isArray(response)
      ? response
      : Array.isArray(response?.call_log_data)
      ? response.call_log_data
      : Array.isArray(response?.data)
      ? response.data
      : Array.isArray(response?.records)
      ? response.records
      : Array.isArray(response?.results)
      ? response.results
      : [];

    return {
      logs,
      raw: response
    };
  } catch (error) {
    console.error(
      `⚠️  Failed to fetch call logs page ${pageNo}:`,
      error.message
    );
    return {
      logs: [],
      raw: null
    };
  }
}

function normalizeLog(log, context) {
  if (!log || typeof log !== 'object') {
    return null;
  }

  const callRequestId = log.call_request_id?.id;
  if (!callRequestId) {
    return null;
  }

  if (log.is_bot_response === false) {
    return null;
  }

  const toNumber =
    log.to_number ||
    log.toNumber ||
    log.phone_number ||
    log.customer_phone_number ||
    null;
  if (!toNumber) {
    return null;
  }

  const fromNumber = log.from_number || log.agent_number || null;
  const sanitizedTo = sanitizePhoneNumber(toNumber);
  const sanitizedFrom = sanitizePhoneNumber(fromNumber);

  const matchesTo =
    context.hasContacts && sanitizedTo
      ? context.contactNumberSet.has(sanitizedTo)
      : context.hasContacts
      ? false
      : true;

  const matchesFrom =
    context.fromNumberSanitized && sanitizedFrom
      ? sanitizedFrom === context.fromNumberSanitized
      : false;

  if (!matchesTo && !matchesFrom) {
    return null;
  }

  if (context.botNameLower) {
    const logBotName = (log.bot_name || '').toLowerCase().trim();
    if (logBotName && logBotName !== context.botNameLower) {
      return null;
    }
  }

  const callDate =
    parseOmniDate(log.time_of_call) ||
    parseOmniDate(log.created_at) ||
    parseOmniDate(log.call_date);

  const durationSeconds = parseDuration(
    log.call_duration_in_seconds ||
      log.duration_in_seconds ||
      log.duration ||
      log.call_duration ||
      0
  );

  const transcript =
    log.call_conversation ||
    log.transcript ||
    log.call_transcript ||
    log.conversation ||
    null;

  const callStatus = mapCallStatus(
    log.call_status || log.status,
    context.allowedStatuses
  );

  const interaction = deriveInteraction({
    transcript,
    isTransfer: log.is_call_transfer,
    hasCustomerSpeech: Boolean(
      log.interactions &&
        Array.isArray(log.interactions) &&
        log.interactions.some(
          (entry) => entry?.user_query && entry.user_query.trim().length > 0
        )
    )
  });

  return {
    callRequestId: String(callRequestId),
    omnidimensionId: log.id ? String(log.id) : null,
    toNumber,
    fromNumber,
    callStatus,
    interaction,
    callDate,
    durationSeconds,
    recordingUrl: log.recording_url || log.recordingUrl || null,
    transcript,
    metadata: {
      p50Latency: toNumberIfFinite(log.p50_latency),
      p99Latency: toNumberIfFinite(log.p99_latency),
      cqsScore: toNumberIfFinite(log.cqs_score),
      sentimentScore: log.sentiment_score || null,
      callCost: toNumberIfFinite(log.call_cost),
      totalTokens: toNumberIfFinite(log.total_tokens)
    }
  };
}

function mapCallStatus(status, allowedSet) {
  if (!status) return 'pending';
  const normalized = status
    .toString()
    .trim()
    .toLowerCase()
    .replace(/_/g, '-');
  if (allowedSet.has(normalized)) {
    return normalized;
  }
  if (normalized === 'in-progress') {
    return 'pending';
  }
  return 'pending';
}

function deriveInteraction({ transcript, isTransfer, hasCustomerSpeech }) {
  if (isTransfer) {
    return 'transfer';
  }
  if (transcript || hasCustomerSpeech) {
    return 'completed';
  }
  return 'no_interaction';
}

async function upsertBulkCallLine({ bulkCall, normalized }) {
  const now = new Date();
  const query = {
    bulkCallId: bulkCall._id,
    omnidimensionCallId: normalized.callRequestId
  };

  const updateDoc = {
    toNumber: normalized.toNumber,
    callDate: normalized.callDate || now,
    callStatus: normalized.callStatus,
    interaction: normalized.interaction,
    duration: normalized.durationSeconds,
    recording: {
      available: Boolean(normalized.recordingUrl),
      url: normalized.recordingUrl || undefined
    },
    transcript: normalized.transcript || undefined,
    metadata: normalized.metadata,
    lastSynced: now,
    syncStatus: 'synced'
  };

  const update = {
    $set: updateDoc,
    $setOnInsert: {
      bulkCallId: bulkCall._id,
      omnidimensionCallId: normalized.callRequestId,
      syncedAt: now
    }
  };

  const result = await BulkCallLine.updateOne(query, update, {
    upsert: true
  });

  return {
    upserted: result.upsertedCount > 0,
    modified:
      result.matchedCount > 0 &&
      (result.modifiedCount > 0 || result.upsertedCount === 0)
  };
}

function sanitizePhoneNumber(number) {
  if (!number || typeof number !== 'string') return null;
  return number.replace(/\D+/g, '');
}

function parseOmniDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
}

function parseDuration(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.round(value));
  }

  if (typeof value === 'string' && value.includes(':')) {
    const parts = value.split(':').map((part) => parseInt(part, 10) || 0);
    if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    }
  }

  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return Math.max(0, Math.round(numeric));
  }

  return 0;
}

function toNumberIfFinite(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

module.exports = {
  syncBulkCallLinesFromLogs
};


