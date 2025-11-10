import React, { useState, useEffect, useRef } from "react";
import api from "../../utils/api";
import config from "../../utils/env";

// Recording Player Component - handles authentication and blob URL creation (same as incoming calls)
const RecordingPlayer = ({ callId, recordingUrl }) => {
  const [blobUrl, setBlobUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const audioRef = useRef(null);

  const loadRecording = async () => {
    if (!callId || !recordingUrl || blobUrl || loading) return;

    setLoading(true);
    try {
      const token = localStorage.getItem("token");
      // Pass recordingUrl as query parameter so backend can use it directly if call not in DB
      const url = `${
        config.api.baseUrl
      }/api/user/calls/logs/${callId}/recording?recordingUrl=${encodeURIComponent(
        recordingUrl
      )}`;
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        setBlobUrl(blobUrl);
        // Update audio src directly
        if (audioRef.current) {
          audioRef.current.src = blobUrl;
          // Load the new source
          audioRef.current.load();
        }
        return blobUrl;
      } else {
        console.error("Failed to load recording:", response.status);
        return null;
      }
    } catch (err) {
      console.error("Error loading recording:", err);
      return null;
    } finally {
      setLoading(false);
    }
  };

  // Load recording on mount if recordingUrl exists
  useEffect(() => {
    if (recordingUrl && callId && !blobUrl && !loading) {
      // Load recording in background when component mounts
      loadRecording();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordingUrl, callId]); // Only load when component mounts or recordingUrl/callId changes

  // Cleanup blob URL on unmount
  useEffect(() => {
    return () => {
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
      }
    };
  }, [blobUrl]);

  // Load recording when user clicks play (if not already loaded)
  const handlePlay = async () => {
    if (!blobUrl && !loading) {
      await loadRecording();
    }
  };

  return (
    <audio
      ref={audioRef}
      controls
      preload="none"
      className="w-full h-8"
      src={blobUrl || undefined}
      onPlay={handlePlay}
      onError={(e) => {
        // If loading fails, try loading again
        if (!blobUrl && !loading) {
          loadRecording();
        }
      }}
    >
      Your browser does not support the audio element.
    </audio>
  );
};

const IncomingCalls = () => {
  const [callLogs, setCallLogs] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pageno, setPageno] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [selectedCallLog, setSelectedCallLog] = useState(null);

  // Filter states
  const [filters, setFilters] = useState({
    call_status: "", // Filter by call status
    start_date: "", // Date range start
    end_date: "", // Date range end
  });

  // Fetch call logs and stats on component mount
  useEffect(() => {
    fetchCallLogs();
    fetchStats();
  }, [pageno, filters]);

  // Fetch call logs from API
  const fetchCallLogs = async () => {
    try {
      setLoading(true);
      setError(null);

      const params = {
        pageno: pageno,
        pagesize: 10,
      };

      // Add filters if provided
      if (filters.call_status) params.call_status = filters.call_status;
      if (filters.start_date) params.start_date = filters.start_date;
      if (filters.end_date) params.end_date = filters.end_date;

      console.log("📞 Fetching call logs with params:", params);
      const response = await api.get("/user/calls/logs", { params });

      console.log("📦 Call logs response:", response.data);

      if (response.data.success) {
        setCallLogs(response.data.data || []);
        setTotalPages(response.data.pagination?.pages || 1);
        console.log("✅ Call logs fetched:", response.data.data?.length || 0);
      } else {
        console.error("❌ API returned success: false", response.data);
        setError(response.data.message || "Failed to fetch call logs");
      }
    } catch (err) {
      console.error("❌ Error fetching call logs:", err);
      console.error("❌ Error response:", err.response?.data);
      setError(
        err.response?.data?.message ||
          err.message ||
          "Failed to fetch call logs"
      );
    } finally {
      setLoading(false);
    }
  };

  // Fetch statistics
  const fetchStats = async () => {
    try {
      const params = {};
      if (filters.start_date) params.start_date = filters.start_date;
      if (filters.end_date) params.end_date = filters.end_date;
      if (filters.call_status) params.call_status = filters.call_status;

      console.log("📊 Fetching stats with params:", params);
      const response = await api.get("/user/calls/logs/stats", { params });

      console.log("📊 Stats response:", response.data);

      if (response.data.success) {
        setStats(response.data.data);
      }
    } catch (err) {
      console.error("❌ Error fetching stats:", err);
      console.error("❌ Error response:", err.response?.data);
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
      call_status: "",
      start_date: "",
      end_date: "",
    });
    setPageno(1);
  };

  // Format duration
  const formatDuration = (seconds) => {
    if (!seconds) return "0:00";
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
              Incoming Calls
            </h1>
            <p className="text-sm sm:text-base text-gray-600 dark:text-gray-400 mt-1">
              View your incoming calls
            </p>
          </div>
        </div>
      </div>

      {/* Filter Cards */}
      <div className="mb-4 sm:mb-6 grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
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
      {(filters.call_status || filters.start_date || filters.end_date) && (
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
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 gap-3 sm:gap-4 mb-4 sm:mb-6">
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
              Total Hours
            </p>
            <p className="text-lg sm:text-2xl font-bold text-gray-900 dark:text-white">
              {(stats.totalMinutes / 60).toFixed(1)}
            </p>
          </div>
          {/* <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3 sm:p-4">
            <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 mb-1">
              Avg CQS Score
            </p>
            <p className="text-lg sm:text-2xl font-bold text-gray-900 dark:text-white">
              {stats.avgCqsScore.toFixed(2)}
            </p>
          </div> */}
          {/* <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3 sm:p-4">
            <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 mb-1">
              Total Cost
            </p>
            <p className="text-lg sm:text-2xl font-bold text-gray-900 dark:text-white">
              ${stats.totalCost.toFixed(3)}
            </p>
          </div> */}
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
      ) : callLogs.length === 0 ? (
        <div className="text-center py-20 text-gray-600 dark:text-gray-400">
          <p className="text-xl">No call logs found</p>
          <p className="text-sm mt-2">
            Try adjusting your filters or wait for calls to be logged
          </p>
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
                      Phone Number
                    </th>
                    <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Duration
                    </th>
                    <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Call Type
                    </th>
                    {/* <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      CQS Score
                    </th> */}
                    <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider hidden lg:table-cell">
                      Time
                    </th>
                    {/* <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Cost
                    </th> */}
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                  {callLogs.map((callLog, index) => (
                    <tr
                      key={
                        callLog._id ||
                        callLog.omnidimensionId ||
                        `call-${index}`
                      }
                      onClick={() => setSelectedCallLog(callLog)}
                      className="hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer transition"
                    >
                      <td className="px-3 sm:px-6 py-4 whitespace-nowrap text-xs sm:text-sm text-gray-900 dark:text-white">
                        {callLog.source || "Unknown"}
                      </td>
                      <td className="px-3 sm:px-6 py-4 whitespace-nowrap text-xs sm:text-sm text-cyan-600 dark:text-cyan-400">
                        {callLog.phoneNumber}
                      </td>
                      <td className="px-3 sm:px-6 py-4 whitespace-nowrap text-xs sm:text-sm text-gray-900 dark:text-white">
                        {formatDuration(callLog.duration || 0)}
                      </td>
                      <td className="px-3 sm:px-6 py-4 whitespace-nowrap text-xs sm:text-sm text-gray-900 dark:text-white">
                        {"Incoming Call"}
                      </td>
                      {/* <td className="px-3 sm:px-6 py-4 whitespace-nowrap text-xs sm:text-sm text-gray-900 dark:text-white">
                        {callLog.cqsScore
                          ? callLog.cqsScore.toFixed(2)
                          : "0.00"}
                      </td> */}
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
                      {/* <td className="px-3 sm:px-6 py-4 whitespace-nowrap text-xs sm:text-sm text-gray-900 dark:text-white">
                        ${(callLog.cost || 0).toFixed(3)}
                      </td> */}
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
                      {selectedCallLog.phoneNumber}
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
                      { "Incoming Call"}
                    </p>
                  </div>

                  {/* <div>
                    <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">
                      CQS Score
                    </label>
                    <p className="text-gray-900 dark:text-white">
                      {selectedCallLog.cqsScore
                        ? selectedCallLog.cqsScore.toFixed(2)
                        : "0.00"}
                    </p>
                  </div> */}

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
                            key={`${
                              selectedCallLog._id ||
                              selectedCallLog.omnidimensionId ||
                              "transcript"
                            }-${idx}-${
                              message.speaker
                            }-${message.text.substring(0, 20)}`}
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
                    <RecordingPlayer
                      callId={
                        selectedCallLog._id || selectedCallLog.omnidimensionId
                      }
                      recordingUrl={selectedCallLog.recordingUrl}
                    />
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

export default IncomingCalls;
