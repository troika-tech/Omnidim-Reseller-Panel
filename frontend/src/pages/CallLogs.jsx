import React, { useState, useEffect, useCallback, useRef } from "react";
import api from "../utils/api";
import socket from "../utils/socket";

const CallLogs = () => {
  const [callLogs, setCallLogs] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pageno, setPageno] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [selectedCallLog, setSelectedCallLog] = useState(null);

  // Smart loading states
  const [shouldShowSpinner, setShouldShowSpinner] = useState(false);
  const [hasCheckedOnce, setHasCheckedOnce] = useState(false);

  // Filter states based on available endpoints
  const [filters, setFilters] = useState({
    call_type: "all", // Filter by call type: all, incoming, outgoing
    call_status: "", // Filter by call status
    phone_number: "", // Additional filter by phone number
    start_date: "", // Date range start
    end_date: "", // Date range end
  });

  // Voice assistants for agent filter dropdown
  const [agents, setAgents] = useState([]);

  // In-memory cache for call log responses
  const CACHE_TTL = 60 * 1000; // 60 seconds
  const pageCacheRef = useRef(new Map());
  const filterCacheRef = useRef(new Map());

  const buildCacheKey = useCallback((prefix, filtersObject, extra = {}) => {
    const sortedFilters = Object.keys(filtersObject)
      .sort()
      .reduce((acc, key) => {
        acc[key] = filtersObject[key];
        return acc;
      }, {});

    return JSON.stringify({ prefix, filters: sortedFilters, ...extra });
  }, []);

  const clearCaches = useCallback(() => {
    pageCacheRef.current.clear();
    filterCacheRef.current.clear();
    setHasCheckedOnce(false);
  }, []);

  const normalizePhone = (value) => {
    if (!value) return "";
    return value.toString().replace(/\D+/g, "");
  };

  const getReceiverNumber = (callLog) => {
    if (!callLog) return "";

    const candidates = [
      callLog.toNumber,
      callLog.phoneNumber,
      callLog.customerPhoneNumber,
      callLog.contactNumber,
      callLog.recipientNumber,
      callLog.metadata?.toNumber,
      callLog.metadata?.phoneNumber,
      callLog.metadata?.customerPhoneNumber,
      callLog.metadata?.contactNumber,
    ].filter(Boolean);

    if (candidates.length === 0) {
      return callLog.source || "Unknown";
    }

    const normalizedSource = normalizePhone(callLog.source);
    const distinct = candidates.find(
      (candidate) => normalizePhone(candidate) !== normalizedSource
    );

    return distinct || candidates[0] || callLog.source || "Unknown";
  };

  // Fetch call logs from API with smart pagination for filtering
  const fetchCallLogs = useCallback(async () => {
    try {
      setLoading(true);
      const targetRecords = 10;

      // If no call type filter, use normal pagination
      if (filters.call_type === "all") {
        const params = {
          pageno: pageno,
          pagesize: 10,
        };

        // Add filters if provided
        if (filters.call_status) params.call_status = filters.call_status;
        if (filters.phone_number) params.phone_number = filters.phone_number;
        if (filters.start_date) params.start_date = filters.start_date;
        if (filters.end_date) params.end_date = filters.end_date;

        const cacheKey = buildCacheKey("admin-call-logs-page", filters, {
          page: pageno,
        });
        const cached = pageCacheRef.current.get(cacheKey);

        if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
          setCallLogs(cached.data);
          setTotalPages(cached.totalPages);
          setError(null);
          setLoading(false);
          return;
        }

        const response = await api.get("/v1/calls/logs", { params });

        if (response.data.success) {
          const currentData = response.data.data;
          const currentTotalPages = response.data.pagination?.pages || 1;

          setCallLogs(currentData);
          setTotalPages(currentTotalPages);
          setError(null);

          pageCacheRef.current.set(cacheKey, {
            data: currentData,
            totalPages: currentTotalPages,
            timestamp: Date.now(),
          });
        }
        return;
      }

      // For call type filtering, fetch ALL pages to get accurate count
      let allFilteredLogs = [];
      let fetchPage = 1;
      let hasMorePages = true;
      let totalPagesFromAPI = 1;

      const filterCacheKey = buildCacheKey(
        "admin-call-logs-filtered",
        filters
      );
      const cachedFiltered = filterCacheRef.current.get(filterCacheKey);

      if (cachedFiltered && Date.now() - cachedFiltered.timestamp < CACHE_TTL) {
        const startIndex = (pageno - 1) * targetRecords;
        const endIndex = startIndex + targetRecords;
        const pageRecords = cachedFiltered.allLogs.slice(startIndex, endIndex);

        setCallLogs(pageRecords);
        setTotalPages(cachedFiltered.totalPages);
        setError(null);
        setLoading(false);
        return;
      }

      // First, fetch all pages to get complete filtered dataset
      while (hasMorePages && fetchPage <= totalPagesFromAPI) {
        const params = {
          pageno: fetchPage,
          pagesize: 50, // Fetch more records per request for efficiency
        };

        // Add filters if provided
        if (filters.call_status) params.call_status = filters.call_status;
        if (filters.phone_number) params.phone_number = filters.phone_number;
        if (filters.start_date) params.start_date = filters.start_date;
        if (filters.end_date) params.end_date = filters.end_date;

        const response = await api.get("/v1/calls/logs", { params });

        if (response.data.success) {
          const pageData = response.data.data || [];
          totalPagesFromAPI = response.data.pagination?.pages || 1;

          // Filter the page data by call type
          const pageFiltered = pageData.filter((callLog) => {
            const campaignName = callLog.campaignName || "";
            const isIncoming =
              campaignName.toLowerCase().includes("incoming") ||
              campaignName === "Incoming Call" ||
              !campaignName ||
              campaignName.trim() === "";

            if (filters.call_type === "incoming") {
              return isIncoming;
            } else if (filters.call_type === "outgoing") {
              return !isIncoming;
            }
            return true;
          });

          allFilteredLogs = [...allFilteredLogs, ...pageFiltered];

          // Check if we've reached the end
          if (pageData.length < 50 || fetchPage >= totalPagesFromAPI) {
            hasMorePages = false;
          }

          fetchPage++;
        } else {
          hasMorePages = false;
        }
      }

      // Now paginate the filtered results
      const startIndex = (pageno - 1) * targetRecords;
      const endIndex = startIndex + targetRecords;
      const pageRecords = allFilteredLogs.slice(startIndex, endIndex);

      // Calculate total pages based on ALL filtered results
      const totalFilteredRecords = allFilteredLogs.length;
      const calculatedTotalPages =
        Math.ceil(totalFilteredRecords / targetRecords) || 1;

      setCallLogs(pageRecords);
      setTotalPages(calculatedTotalPages);
      setError(null);

      filterCacheRef.current.set(filterCacheKey, {
        allLogs: allFilteredLogs,
        totalPages: calculatedTotalPages,
        timestamp: Date.now(),
      });

      console.log(
        `Filtered ${totalFilteredRecords} ${filters.call_type} calls into ${calculatedTotalPages} pages`
      );
    } catch (err) {
      console.error("Error fetching call logs:", err);
      setError(err.response?.data?.message || "Failed to fetch call logs");
    } finally {
      setLoading(false);
    }
  }, [pageno, filters, buildCacheKey]);

  // Fetch call logs and stats on component mount
  useEffect(() => {
    fetchVoiceAssistants();
    fetchCallLogs();
    fetchStats();
  }, [pageno, filters, fetchCallLogs]);

  // Simple loading logic - just check once (for admin, no sync status available)
  useEffect(() => {
    const hasNoData = callLogs.length === 0;

    // Show spinner if: no data AND not initial loading AND haven't checked yet
    const shouldShow = hasNoData && !loading && !hasCheckedOnce;

    setShouldShowSpinner(shouldShow);

    // If we should show spinner, do one check after 3 seconds
    if (shouldShow) {
      console.log("📡 Admin: Checking for call logs once...");
      const timeoutId = setTimeout(() => {
        console.log("🔄 Admin: Performing single check for call logs");
        fetchCallLogs();
        setHasCheckedOnce(true);
        setShouldShowSpinner(false);
      }, 3000);

      return () => clearTimeout(timeoutId);
    }
  }, [callLogs, loading, hasCheckedOnce, fetchCallLogs]);

  // Set up Socket.IO listeners for real-time updates
  useEffect(() => {
    console.log("🎧 Setting up Socket.IO listeners for call logs");

    socket.on("call_log_created", (newCallLog) => {
      console.log("📡 Received: call_log_created", newCallLog);
      clearCaches();
      setCallLogs((prev) => {
        const exists = prev.find(
          (cl) =>
            cl._id === newCallLog._id ||
            cl.omnidimensionId === newCallLog.omnidimensionId
        );
        if (exists) return prev;
        return [newCallLog, ...prev];
      });
    });

    socket.on("call_log_updated", (updatedCallLog) => {
      console.log("📡 Received: call_log_updated", updatedCallLog);
      clearCaches();
      setCallLogs((prev) =>
        prev.map((cl) =>
          cl._id === updatedCallLog._id ||
          cl.omnidimensionId === updatedCallLog.omnidimensionId
            ? updatedCallLog
            : cl
        )
      );
    });

    socket.on("call_log_deleted", ({ id }) => {
      console.log("📡 Received: call_log_deleted", id);
      clearCaches();
      setCallLogs((prev) => prev.filter((cl) => cl._id !== id));
      if (selectedCallLog && selectedCallLog._id === id) {
        setSelectedCallLog(null);
      }
    });

    return () => {
      socket.off("call_log_created");
      socket.off("call_log_updated");
      socket.off("call_log_deleted");
    };
  }, [selectedCallLog, clearCaches]);

  // Fetch voice assistants for agent filter
  const fetchVoiceAssistants = async () => {
    try {
      const response = await api.get("/admin/voice-assistants", {
        params: {
          page: 1,
          limit: 100, // Get all agents for filter
        },
      });

      if (response.data.success) {
        setAgents(response.data.data);
      }
    } catch (err) {
      console.error("Error fetching voice assistants:", err);
    }
  };

  // Fetch statistics
  const fetchStats = async () => {
    try {
      const params = {};
      if (filters.start_date) params.start_date = filters.start_date;
      if (filters.end_date) params.end_date = filters.end_date;

      const response = await api.get("/v1/calls/logs/stats", { params });

      if (response.data.success) {
        setStats(response.data.data);
      }
    } catch (err) {
      console.error("Error fetching stats:", err);
    }
  };

  // Handle filter change
  const handleFilterChange = (key, value) => {
    setFilters((prev) => ({
      ...prev,
      [key]: value,
    }));
    setPageno(1); // Reset to first page when filter changes
  };

  // Clear all filters
  const handleClearFilters = () => {
    setFilters({
      call_type: "all",
      call_status: "",
      phone_number: "",
      start_date: "",
      end_date: "",
    });
    setPageno(1);
  };

  // Format duration
  const formatDuration = (seconds) => {
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes.toString().padStart(2, "0")}:${secs
      .toString()
      .padStart(2, "0")}`;
  };

  // Format date
  const formatDate = (dateString) => {
    if (!dateString) return "";
    const date = new Date(dateString);
    return date.toLocaleDateString() + " " + date.toLocaleTimeString();
  };

  // Since filtering is now done in fetchCallLogs, just return the callLogs as-is
  const getFilteredCallLogs = () => {
    return callLogs;
  };

  // Parse transcript into chat messages
  const parseTranscript = (transcript) => {
    if (!transcript) return [];

    // Remove HTML tags
    let cleaned = transcript
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]*>/g, "");

    // Split by common patterns
    const messages = [];
    const lines = cleaned.split("\n").filter((line) => line.trim());

    let currentSpeaker = null;
    let currentText = "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Detect speaker
      let speaker = null;
      let text = trimmed;

      // Check for USER: prefix
      if (/^USER\s*:/i.test(trimmed)) {
        speaker = "user";
        text = trimmed.replace(/^USER\s*:\s*/i, "").trim();
      }
      // Check for LLM:, AGENT:, or AI: prefix
      else if (/^(LLM|AGENT|AI)\s*:\s*/i.test(trimmed)) {
        speaker = "agent";
        text = trimmed.replace(/^(LLM|AGENT|AI)\s*:\s*/i, "").trim();
      }
      // Check for Agent: prefix (without LLM)
      else if (/^Agent\s*:\s*/i.test(trimmed)) {
        speaker = "agent";
        text = trimmed.replace(/^Agent\s*:\s*/i, "").trim();
      }
      // If no prefix, continue with current speaker or default to agent
      else {
        speaker = currentSpeaker || "agent";
        text = trimmed;
      }

      // If same speaker, append to current message
      if (speaker === currentSpeaker && currentText) {
        currentText += "\n" + text;
      } else {
        // Save previous message if exists
        if (currentSpeaker && currentText) {
          messages.push({
            speaker: currentSpeaker,
            text: currentText.trim(),
          });
        }
        // Start new message
        currentSpeaker = speaker;
        currentText = text;
      }
    }

    // Add last message
    if (currentSpeaker && currentText) {
      messages.push({
        speaker: currentSpeaker,
        text: currentText.trim(),
      });
    }

    // If no messages found, return original as single agent message
    if (messages.length === 0) {
      return [
        {
          speaker: "agent",
          text: cleaned.trim(),
        },
      ];
    }

    return messages;
  };

  return (
    <div className="min-h-screen overflow-x-hidden">
      {/* Header */}
      <div className="mb-4 sm:mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">
              Call Logs
            </h1>
            <p className="text-sm sm:text-base text-gray-600 dark:text-gray-400 mt-1">
              View and analyze your call history
            </p>
          </div>
        </div>
      </div>

      {/* Filter Cards - Based on available endpoints */}
      <div className="mb-4 sm:mb-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
        {/* Filter by Call Type */}
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3 sm:p-4">
          <label className="block text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Filter by Call Type
          </label>
          <select
            value={filters.call_type}
            onChange={(e) => handleFilterChange("call_type", e.target.value)}
            className="w-full px-3 py-2 text-xs sm:text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:border-cyan-500 text-gray-900 dark:text-white"
          >
            <option value="all">All Calls</option>
            <option value="incoming">Incoming Calls</option>
            <option value="outgoing">Outgoing Calls</option>
          </select>
        </div>

        {/* Filter by Call Status */}
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3 sm:p-4">
          <label className="block text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Filter by Status
          </label>
          <select
            value={filters.call_status}
            onChange={(e) => handleFilterChange("call_status", e.target.value)}
            className="w-full px-3 py-2 text-xs sm:text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:border-cyan-500 text-gray-900 dark:text-white"
          >
            <option value="">All Statuses</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
            <option value="busy">Busy</option>
            <option value="no-answer">No Answer</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>

        {/* Filter by Phone Number */}
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3 sm:p-4">
          <label className="block text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Filter by Phone Number
          </label>
          <input
            type="text"
            placeholder="Phone number"
            value={filters.phone_number}
            onChange={(e) => handleFilterChange("phone_number", e.target.value)}
            className="w-full px-3 py-2 text-xs sm:text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:border-cyan-500 text-gray-900 dark:text-white"
          />
        </div>

        {/* Filter by Start Date */}
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3 sm:p-4">
          <label className="block text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Start Date
          </label>
          <input
            type="date"
            value={filters.start_date}
            onChange={(e) => handleFilterChange("start_date", e.target.value)}
            className="w-full px-3 py-2 text-xs sm:text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:border-cyan-500 text-gray-900 dark:text-white"
          />
        </div>

        {/* Filter by End Date */}
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3 sm:p-4">
          <label className="block text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            End Date
          </label>
          <input
            type="date"
            value={filters.end_date}
            onChange={(e) => handleFilterChange("end_date", e.target.value)}
            className="w-full px-3 py-2 text-xs sm:text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:border-cyan-500 text-gray-900 dark:text-white"
          />
        </div>
      </div>

      {/* Clear Filters Button */}
      {(filters.call_type !== "all" ||
        filters.call_status ||
        filters.phone_number ||
        filters.start_date ||
        filters.end_date) && (
        <div className="mb-4">
          <button
            onClick={handleClearFilters}
            className="px-3 sm:px-4 py-2 text-xs sm:text-sm bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-900 dark:text-white rounded-lg transition"
          >
            Clear All Filters
          </button>
        </div>
      )}

      {/* Statistics Cards */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4 mb-4 sm:mb-6">
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3 sm:p-4">
            <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 mb-1">
              Total Calls
            </p>
            <p className="text-lg sm:text-2xl font-bold text-gray-900 dark:text-white">
              {stats.totalCalls}
            </p>
          </div>
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3 sm:p-4">
            <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 mb-1">
              Completed
            </p>
            <p className="text-lg sm:text-2xl font-bold text-gray-900 dark:text-white">
              {stats.completedCalls}
            </p>
          </div>
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3 sm:p-4">
            <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 mb-1">
              Total Minutes
            </p>
            <p className="text-lg sm:text-2xl font-bold text-gray-900 dark:text-white">
              {(stats.totalMinutes / 60).toFixed(1)}
            </p>
          </div>
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3 sm:p-4">
            <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 mb-1">
              Avg CQS Score
            </p>
            <p className="text-lg sm:text-2xl font-bold text-gray-900 dark:text-white">
              {stats.avgCqsScore.toFixed(2)}
            </p>
          </div>
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3 sm:p-4">
            <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 mb-1">
              Total Cost
            </p>
            <p className="text-lg sm:text-2xl font-bold text-gray-900 dark:text-white">
              ${stats.totalCost.toFixed(2)}
            </p>
          </div>
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="mb-4 p-4 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 rounded-lg text-red-800 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Call Logs Table */}
      {loading ? (
        <div className="flex justify-center items-center py-20">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-cyan-500"></div>
        </div>
      ) : getFilteredCallLogs().length === 0 ? (
        <div className="text-center py-20 text-gray-600 dark:text-gray-400">
          {shouldShowSpinner ? (
            <div className="flex flex-col items-center gap-4">
              <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-cyan-500"></div>
              <div className="text-center">
                <p className="text-lg font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Loading call logs...
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Checking for call logs...
                </p>
              </div>
            </div>
          ) : (
            <div>
              <p className="text-xl">No call logs found</p>
              <p className="text-sm mt-2">
                Try adjusting your filters or wait for calls to be logged
              </p>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
          <div className="overflow-x-auto -mx-4 sm:mx-0">
            <div className="inline-block min-w-full align-middle px-4 sm:px-0">
              <table
                className="w-full divide-y divide-gray-200 dark:divide-gray-700"
                style={{ minWidth: "900px" }}
              >
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Source
                    </th>
                    <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Campaign
                    </th>
                    <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Phone Number
                    </th>
                    <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Duration
                    </th>

                    <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider hidden lg:table-cell">
                      Time
                    </th>
                    <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Cost
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                  {getFilteredCallLogs().map((callLog) => (
                    <tr
                      key={callLog._id}
                      onClick={() => setSelectedCallLog(callLog)}
                      className="hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer transition"
                    >
                      <td className="px-3 sm:px-6 py-4 whitespace-nowrap text-xs sm:text-sm text-gray-900 dark:text-white">
                        {callLog.source || "Unknown"}
                      </td>
                      <td className="px-3 sm:px-6 py-4 whitespace-nowrap text-xs sm:text-sm text-gray-900 dark:text-white">
                        {callLog.campaignName || "Incoming Call"}
                      </td>
                      <td className="px-3 sm:px-6 py-4 whitespace-nowrap text-xs sm:text-sm text-cyan-600 dark:text-cyan-400">
                        {getReceiverNumber(callLog)}
                      </td>
                      <td className="px-3 sm:px-6 py-4 whitespace-nowrap text-xs sm:text-sm text-gray-900 dark:text-white">
                        {formatDuration(callLog.duration || 0)}
                      </td>

                      <td className="px-3 sm:px-6 py-4 whitespace-nowrap">
                        <span
                          className={`inline-block px-2 py-1 rounded text-xs font-medium ${
                            callLog.status === "completed"
                              ? "bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-300"
                              : callLog.status === "failed"
                              ? "bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-300"
                              : callLog.status === "busy"
                              ? "bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-300"
                              : callLog.status === "no-answer"
                              ? "bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300"
                              : "bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-300"
                          }`}
                        >
                          {callLog.status || "completed"}
                        </span>
                      </td>
                      <td className="px-3 sm:px-6 py-4 whitespace-nowrap text-xs sm:text-sm text-gray-600 dark:text-gray-400 hidden lg:table-cell">
                        {formatDate(callLog.createdAt)}
                      </td>
                      <td className="px-3 sm:px-6 py-4 whitespace-nowrap text-xs sm:text-sm text-gray-900 dark:text-white">
                        ${(callLog.cost || 0).toFixed(3)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Call Details Modal */}
      {selectedCallLog && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50 overflow-y-auto"
          onClick={() => setSelectedCallLog(null)}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto my-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 sm:p-6">
              {/* Header */}
              <div className="flex justify-between items-center mb-4 sm:mb-6">
                <h2 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white">
                  Call Details
                </h2>
                <button
                  onClick={() => setSelectedCallLog(null)}
                  className="text-gray-400 hover:text-white text-2xl flex-shrink-0"
                >
                  ×
                </button>
              </div>

              {/* Details */}
              <div className="space-y-3 sm:space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">
                      Source
                    </label>
                    <p className="text-gray-900 dark:text-white">
                      {selectedCallLog.source || "Unknown"}
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">
                      Phone Number
                    </label>
                    <p className="text-cyan-600 dark:text-cyan-400">
                      {getReceiverNumber(selectedCallLog)}
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">
                      Duration
                    </label>
                    <p className="text-gray-900 dark:text-white">
                      {formatDuration(selectedCallLog.duration || 0)}
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">
                      Call Type
                    </label>
                    <p className="text-gray-900 dark:text-white">
                      {selectedCallLog.callType || "Call"}
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">
                      CQS Score
                    </label>
                    <p className="text-gray-900 dark:text-white">
                      {selectedCallLog.cqsScore
                        ? selectedCallLog.cqsScore.toFixed(2)
                        : "0.00"}
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">
                      Status
                    </label>
                    <span
                      className={`inline-block px-2 py-1 rounded text-xs font-medium ${
                        selectedCallLog.status === "completed"
                          ? "bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-300"
                          : selectedCallLog.status === "failed"
                          ? "bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-300"
                          : "bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-300"
                      }`}
                    >
                      {selectedCallLog.status || "completed"}
                    </span>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">
                      Agent
                    </label>
                    <p className="text-gray-900 dark:text-white">
                      {selectedCallLog.agentUsed?.name || "N/A"}
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">
                      Time
                    </label>
                    <p className="text-gray-900 dark:text-white text-sm">
                      {formatDate(selectedCallLog.createdAt)}
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">
                      Cost
                    </label>
                    <p className="text-gray-900 dark:text-white">
                      ${(selectedCallLog.cost || 0).toFixed(3)}
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">
                      Campaign Name
                    </label>
                    <p className="text-gray-900 dark:text-white">
                      {selectedCallLog.campaignName || "Incoming Call"}
                    </p>
                  </div>
                </div>

                {/* Transcript */}
                {selectedCallLog.transcript && (
                  <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
                    <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">
                      Transcript
                    </label>
                    <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4 space-y-3 max-h-96 overflow-y-auto">
                      {parseTranscript(selectedCallLog.transcript).map(
                        (message, idx) => (
                          <div
                            key={idx}
                            className={`flex ${
                              message.speaker === "user"
                                ? "justify-end"
                                : "justify-start"
                            }`}
                          >
                            <div
                              className={`max-w-[80%] rounded-lg px-4 py-2 ${
                                message.speaker === "user"
                                  ? "bg-cyan-600 text-white"
                                  : "bg-white dark:bg-gray-800 text-gray-900 dark:text-white border border-gray-200 dark:border-gray-700"
                              }`}
                            >
                              <p className="text-sm leading-relaxed whitespace-pre-wrap">
                                {message.text}
                              </p>
                            </div>
                          </div>
                        )
                      )}
                    </div>
                  </div>
                )}

                {/* Recording */}
                {selectedCallLog.recordingUrl && (
                  <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
                    <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">
                      Recording
                    </label>
                    <audio controls className="w-full">
                      <source
                        src={selectedCallLog.recordingUrl}
                        type="audio/mpeg"
                      />
                      Your browser does not support the audio element.
                    </audio>
                  </div>
                )}
              </div>

              {/* Close Button */}
              <div className="flex justify-end mt-4 sm:mt-6 pt-4 sm:pt-6 border-t border-gray-200 dark:border-gray-700">
                <button
                  onClick={() => setSelectedCallLog(null)}
                  className="w-full sm:w-auto px-4 sm:px-6 py-2 text-sm sm:text-base bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-900 dark:text-white rounded-lg transition"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4 mt-4 sm:mt-6 px-4 sm:px-6">
          <div className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 text-center sm:text-left">
            Page {pageno} of {totalPages}
          </div>
          <div className="flex items-center gap-3 sm:gap-4">
            <button
              onClick={() => setPageno((p) => Math.max(1, p - 1))}
              disabled={pageno === 1}
              className="flex-1 sm:flex-none px-4 py-2 text-xs sm:text-sm bg-gray-200 dark:bg-gray-800 hover:bg-gray-300 dark:hover:bg-gray-700 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed text-gray-900 dark:text-white"
            >
              Previous
            </button>
            <button
              onClick={() => setPageno((p) => Math.min(totalPages, p + 1))}
              disabled={pageno === totalPages}
              className="flex-1 sm:flex-none px-4 py-2 text-xs sm:text-sm bg-gray-200 dark:bg-gray-800 hover:bg-gray-300 dark:hover:bg-gray-700 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed text-gray-900 dark:text-white"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default CallLogs;
