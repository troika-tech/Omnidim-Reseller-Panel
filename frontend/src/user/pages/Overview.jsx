import React, { useState, useEffect, useRef } from "react";
import api from "../../utils/api";
import socket from "../../utils/socket";
import { useAuth } from "../../contexts/AuthContext";

const OutlineIcon = ({
  children,
  className = "",
  sizeClass = "w-6 h-6 sm:w-7 sm:h-7",
}) => (
  <svg
    className={`${sizeClass} ${className}`}
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    viewBox="0 0 24 24"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {children}
  </svg>
);

const Overview = () => {
  const { user } = useAuth();
  const [stats, setStats] = useState({
    totalCampaigns: 0,
    incomingCalls: 0,
    outgoingCalls: 0,
  });
  const [callLogs, setCallLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [callLogsLoading, setCallLogsLoading] = useState(true);

  // Individual loading states for each card
  const [cardLoading, setCardLoading] = useState({
    totalCampaigns: true,
    incomingCalls: true,
    outgoingCalls: true,
  });

  // Track which cards have completed their timeout using refs to avoid infinite loops
  const timeoutCompletedRef = useRef({
    totalCampaigns: false,
    incomingCalls: false,
    outgoingCalls: false,
  });

  // Intervals for periodic checking
  const checkIntervalsRef = useRef({});

  useEffect(() => {
    fetchStats();
    fetchCallLogs();
  }, []);

  useEffect(() => {
    if (!user?._id) return;

    const resolveUserId = (value) => {
      if (!value) return null;
      if (typeof value === "string") return value;
      if (typeof value === "object") {
        if (value._id) return value._id;
        if (value.id) return value.id;
        if (typeof value.toString === "function") {
          const strValue = value.toString();
          if (strValue && strValue !== "[object Object]") {
            return strValue;
          }
        }
      }
      return null;
    };

    const matchesCurrentUser = (resourceUserId) => {
      const resolved = resolveUserId(resourceUserId);
      if (!resolved || !user?._id) return false;
      return String(resolved) === String(user._id);
    };

    const handleCallLogCreated = (newCallLog) => {
      if (!matchesCurrentUser(newCallLog?.userId)) return;

      setCallLogs((prev) => {
        if (!Array.isArray(prev)) return [newCallLog];

        const exists = prev.find(
          (log) =>
            log._id === newCallLog._id ||
            log.omnidimensionId === newCallLog.omnidimensionId
        );

        if (exists) {
          return prev.map((log) =>
            log._id === newCallLog._id ||
            log.omnidimensionId === newCallLog.omnidimensionId
              ? newCallLog
              : log
          );
        }

        return [newCallLog, ...prev].slice(0, 10);
      });

      fetchStats();
    };

    const handleCallLogUpdated = (updatedCallLog) => {
      if (!matchesCurrentUser(updatedCallLog?.userId)) return;

      setCallLogs((prev) =>
        prev.map((log) =>
          log._id === updatedCallLog._id ||
          log.omnidimensionId === updatedCallLog.omnidimensionId
            ? { ...log, ...updatedCallLog }
            : log
        )
      );

      fetchStats();
    };

    const handleCallLogDeleted = ({ id }) => {
      setCallLogs((prev) =>
        prev.filter((log) => log._id !== id && log.id !== id)
      );
      fetchStats();
    };

    const handleIncomingCallEvent = (incomingCall) => {
      if (matchesCurrentUser(incomingCall?.userId)) {
        fetchStats();
      }
    };

    const handleIncomingCallDeleted = ({ userId }) => {
      if (!userId || matchesCurrentUser(userId)) {
        fetchStats();
      }
    };

    socket.on("call_log_created", handleCallLogCreated);
    socket.on("call_log_updated", handleCallLogUpdated);
    socket.on("call_log_deleted", handleCallLogDeleted);
    socket.on("incoming_call_created", handleIncomingCallEvent);
    socket.on("incoming_call_updated", handleIncomingCallEvent);
    socket.on("incoming_call_deleted", handleIncomingCallDeleted);

    return () => {
      socket.off("call_log_created", handleCallLogCreated);
      socket.off("call_log_updated", handleCallLogUpdated);
      socket.off("call_log_deleted", handleCallLogDeleted);
      socket.off("incoming_call_created", handleIncomingCallEvent);
      socket.off("incoming_call_updated", handleIncomingCallEvent);
      socket.off("incoming_call_deleted", handleIncomingCallDeleted);
    };
  }, [user]);

  useEffect(() => {
    const interval = setInterval(() => {
      fetchStats();
      fetchCallLogs();
    }, 30000);

    return () => clearInterval(interval);
  }, []);

  // Manage timeouts whenever card loading state changes
  useEffect(() => {
    Object.keys(cardLoading).forEach((key) => {
      const isLoading = cardLoading[key];

      if (isLoading) {
        // Start timeout if not already running and no completed timeout
        if (
          !checkIntervalsRef.current[key] &&
          !timeoutCompletedRef.current[key]
        ) {
          console.log(`⏰ Starting 30-second timeout for ${key}...`);

          const timeoutId = setTimeout(() => {
            console.log(
              `⏰ ${key} timeout reached - showing 0 instead of spinner`
            );
            setCardLoading((prev) => ({ ...prev, [key]: false }));
            timeoutCompletedRef.current[key] = true;
            delete checkIntervalsRef.current[key];
          }, 30000);

          checkIntervalsRef.current[key] = timeoutId;
        }
      } else if (checkIntervalsRef.current[key]) {
        // Clear any existing timeout if loading finished early
        clearTimeout(checkIntervalsRef.current[key]);
        delete checkIntervalsRef.current[key];
      }
    });
  }, [cardLoading]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      Object.values(checkIntervalsRef.current).forEach((timeoutId) => {
        if (timeoutId) clearTimeout(timeoutId);
      });
    };
  }, []);

  const fetchStats = async () => {
    try {
      const response = await api.get("/users/overview/stats");
      if (response.data.success) {
        const newStats = {
          totalCampaigns: response.data.data.totalCampaigns || 0,
          incomingCalls: response.data.data.incomingCalls || 0,
          outgoingCalls: response.data.data.outgoingCalls || 0,
        };

        setStats(newStats);

        // Update individual card loading states - but don't reset if timeout completed
        setCardLoading({
          totalCampaigns: false,
          incomingCalls: false,
          outgoingCalls: false,
        });

        // Clear timeouts for cards that now have data
        Object.keys(newStats).forEach((key) => {
          if (checkIntervalsRef.current[key]) {
            console.log(`✅ ${key} data found - stopping timeout`);
            clearTimeout(checkIntervalsRef.current[key]);
            delete checkIntervalsRef.current[key];
          }
          timeoutCompletedRef.current[key] = false;
        });
      }
    } catch (err) {
      console.error("Error fetching stats:", err);
    } finally {
      setLoading(false);
    }
  };

  const fetchCallLogs = async () => {
    try {
      const response = await api.get("/users/overview/call-logs", {
        params: { page: 1, limit: 10 },
      });
      if (response.data.success) {
        setCallLogs(response.data.data || []);
      }
    } catch (err) {
      console.error("Error fetching call logs:", err);
      setCallLogs([]);
    } finally {
      setCallLogsLoading(false);
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return "N/A";
    try {
      let date;
      // Handle Omnidimension format: "11/03/2025 09:52:34" (MM/DD/YYYY HH:MM:SS)
      if (
        typeof dateString === "string" &&
        dateString.includes("/") &&
        dateString.includes(" ")
      ) {
        // Parse "MM/DD/YYYY HH:MM:SS" format
        const [datePart, timePart] = dateString.split(" ");
        const [month, day, year] = datePart.split("/");
        const [hours, minutes, seconds] = timePart.split(":");
        date = new Date(
          year,
          parseInt(month) - 1,
          day,
          hours,
          minutes,
          seconds
        );
      } else {
        date = new Date(dateString);
      }

      if (isNaN(date.getTime())) return "N/A";

      // Format like "November 3, 2025 at 04:37 PM"
      const month = date.toLocaleString("en-US", { month: "long" });
      const day = date.getDate();
      const year = date.getFullYear();
      const time = date.toLocaleString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      });

      return `${month} ${day}, ${year} at ${time}`;
    } catch (err) {
      return "N/A";
    }
  };

  const formatDuration = (seconds) => {
    if (!seconds && seconds !== 0) return "00:00";
    const totalSeconds =
      typeof seconds === "string" ? parseInt(seconds) : seconds;
    if (isNaN(totalSeconds)) return "00:00";
    const mins = Math.floor(totalSeconds / 60);
    const secs = Math.floor(totalSeconds % 60);
    return `${mins.toString().padStart(2, "0")}:${secs
      .toString()
      .padStart(2, "0")}`;
  };

  // Calculate bar chart data
  const total =
    stats.totalCampaigns + stats.incomingCalls + stats.outgoingCalls;
  const maxValue = Math.max(
    stats.totalCampaigns,
    stats.incomingCalls,
    stats.outgoingCalls,
    1
  );

  // Bar chart dimensions
  const chartHeight = 200;
  const barWidth = 60;
  const barSpacing = 120; // Increased spacing to prevent text overlap

  if (loading) {
    return (
      <div className="flex justify-center items-center py-20">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-cyan-500"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header Section - Matching Analytics/Call Logs Style */}
      <div className="mb-4 sm:mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white mb-2">
          Overview
        </h1>
        <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 font-medium">
          Your campaign statistics and summary
        </p>
      </div>

      {/* Stats Cards - Responsive Layout */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 mb-4 sm:mb-6">
        {/* Total Campaigns Card */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 sm:p-6 flex items-center justify-between shadow-sm hover:shadow-md transition-all duration-200">
          <div className="flex-1">
            <h3 className="text-sm sm:text-base font-semibold text-gray-900 dark:text-white mb-1 sm:mb-2">
              Total Campaigns
            </h3>
            {cardLoading.totalCampaigns ? (
              <div className="flex items-center gap-2 mb-1">
                <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-b-2 border-cyan-500"></div>
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  Loading...
                </span>
              </div>
            ) : (
              <p className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white mb-1">
                {stats.totalCampaigns}
              </p>
            )}
            {/* <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400">
              Active campaigns
            </p> */}
          </div>
          <div className="w-10 h-10 sm:w-12 sm:h-12 bg-cyan-100 dark:bg-cyan-900/30 rounded-lg flex items-center justify-center flex-shrink-0 text-cyan-600 dark:text-cyan-400">
            <OutlineIcon>
              <line x1="5" y1="17" x2="19" y2="17" />
              <line x1="8" y1="17" x2="8" y2="9" />
              <line x1="12" y1="17" x2="12" y2="5" />
              <line x1="16" y1="17" x2="16" y2="12" />
            </OutlineIcon>
          </div>
        </div>

        {/* Incoming Calls Card */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 sm:p-6 flex items-center justify-between shadow-sm hover:shadow-md transition-all duration-200">
          <div className="flex-1">
            <h3 className="text-sm sm:text-base font-semibold text-gray-900 dark:text-white mb-1 sm:mb-2">
              Incoming Calls
            </h3>
            {cardLoading.incomingCalls ? (
              <div className="flex items-center gap-2 mb-1">
                <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-b-2 border-green-500"></div>
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  Loading...
                </span>
              </div>
            ) : (
              <p className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white mb-1">
                {stats.incomingCalls}
              </p>
            )}
            <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400">
              Received calls
            </p>
          </div>
          <div className="w-10 h-10 sm:w-12 sm:h-12 bg-green-100 dark:bg-green-900/30 rounded-lg flex items-center justify-center flex-shrink-0 text-green-600 dark:text-green-400">
            <OutlineIcon>
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
              <polyline points="10 3 14 7 12 9" />
              <polyline points="12 9 12 3" />
            </OutlineIcon>
          </div>
        </div>

        {/* Outgoing Calls Card */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 sm:p-6 flex items-center justify-between shadow-sm hover:shadow-md transition-all duration-200">
          <div className="flex-1">
            <h3 className="text-sm sm:text-base font-semibold text-gray-900 dark:text-white mb-1 sm:mb-2">
              Outgoing Calls
            </h3>
            {cardLoading.outgoingCalls ? (
              <div className="flex items-center gap-2 mb-1">
                <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-b-2 border-purple-500"></div>
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  Loading...
                </span>
              </div>
            ) : (
              <p className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white mb-1">
                {stats.outgoingCalls}
              </p>
            )}
            <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400">
              Made calls
            </p>
          </div>
          <div className="w-10 h-10 sm:w-12 sm:h-12 bg-purple-100 dark:bg-purple-900/30 rounded-lg flex items-center justify-center flex-shrink-0 text-purple-600 dark:text-purple-400">
            <OutlineIcon>
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
              <polyline points="14 21 10 17 12 15" />
              <polyline points="12 15 12 21" />
            </OutlineIcon>
          </div>
        </div>
      </div>

      {/* Analytics Graph and Call Logs Section - Responsive Layout */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 sm:gap-4">
        {/* Analytics Graph - Responsive width */}
        <div className="w-full bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 sm:p-6 shadow-sm hover:shadow-md transition-shadow duration-200 flex flex-col min-h-[420px]">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-lg sm:text-xl lg:text-2xl font-bold text-gray-900 dark:text-white mb-2">
                Analytics
              </h3>
              <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 font-medium">
                Campaign and call performance overview
              </p>
            </div>
            <div className="w-10 h-10 sm:w-12 sm:h-12 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center text-blue-600 dark:text-blue-400">
              <OutlineIcon>
                <polyline points="3 17 9 11 13 15 21 7" />
                <polyline points="14 7 21 7 21 14" />
              </OutlineIcon>
            </div>
          </div>

          {/* Bar Chart */}
          <div className="flex flex-col gap-6 h-full">
            {/* Bar Chart SVG */}
            <div className="w-full flex-1 min-h-[200px] flex items-center justify-center">
              <svg
                width="100%"
                height={chartHeight + 50}
                viewBox={`0 0 ${barSpacing * 3} ${chartHeight + 50}`}
                className="overflow-visible"
              >
                {/* Y-axis grid lines */}
                {[0, 0.25, 0.5, 0.75, 1].map((ratio, idx) => (
                  <line
                    key={idx}
                    x1="0"
                    y1={chartHeight - ratio * chartHeight}
                    x2={barSpacing * 3}
                    y2={chartHeight - ratio * chartHeight}
                    stroke="#e5e7eb"
                    strokeWidth="1"
                    strokeDasharray="2,2"
                  />
                ))}

                {/* Total Campaigns Bar */}
                <g>
                  <rect
                    x={barSpacing - barWidth / 2}
                    y={
                      chartHeight -
                      (stats.totalCampaigns / maxValue) * chartHeight
                    }
                    width={barWidth}
                    height={(stats.totalCampaigns / maxValue) * chartHeight}
                    fill="#06b6d4"
                    rx="4"
                    className="transition-all hover:opacity-90 cursor-pointer"
                  />
                  <text
                    x={barSpacing}
                    y={
                      chartHeight -
                      (stats.totalCampaigns / maxValue) * chartHeight -
                      5
                    }
                    textAnchor="middle"
                    className="text-xs font-semibold fill-gray-700 dark:fill-gray-300"
                  >
                    {stats.totalCampaigns}
                  </text>
                  <text
                    x={barSpacing}
                    y={chartHeight + 20}
                    textAnchor="middle"
                    className="text-xs font-medium fill-gray-600 dark:fill-gray-400"
                  >
                    Total
                  </text>
                  <text
                    x={barSpacing}
                    y={chartHeight + 35}
                    textAnchor="middle"
                    className="text-xs font-medium fill-gray-600 dark:fill-gray-400"
                  >
                    Campaigns
                  </text>
                </g>

                {/* Incoming Calls Bar */}
                <g>
                  <rect
                    x={barSpacing * 2 - barWidth / 2}
                    y={
                      chartHeight -
                      (stats.incomingCalls / maxValue) * chartHeight
                    }
                    width={barWidth}
                    height={(stats.incomingCalls / maxValue) * chartHeight}
                    fill="#10b981"
                    rx="4"
                    className="transition-all hover:opacity-90 cursor-pointer"
                  />
                  <text
                    x={barSpacing * 2}
                    y={
                      chartHeight -
                      (stats.incomingCalls / maxValue) * chartHeight -
                      5
                    }
                    textAnchor="middle"
                    className="text-xs font-semibold fill-gray-700 dark:fill-gray-300"
                  >
                    {stats.incomingCalls}
                  </text>
                  <text
                    x={barSpacing * 2}
                    y={chartHeight + 20}
                    textAnchor="middle"
                    className="text-xs font-medium fill-gray-600 dark:fill-gray-400"
                  >
                    Incoming
                  </text>
                  <text
                    x={barSpacing * 2}
                    y={chartHeight + 35}
                    textAnchor="middle"
                    className="text-xs font-medium fill-gray-600 dark:fill-gray-400"
                  >
                    Calls
                  </text>
                </g>

                {/* Outgoing Calls Bar */}
                <g>
                  <rect
                    x={barSpacing * 3 - barWidth / 2}
                    y={
                      chartHeight -
                      (stats.outgoingCalls / maxValue) * chartHeight
                    }
                    width={barWidth}
                    height={(stats.outgoingCalls / maxValue) * chartHeight}
                    fill="#3b82f6"
                    rx="4"
                    className="transition-all hover:opacity-90 cursor-pointer"
                  />
                  <text
                    x={barSpacing * 3}
                    y={
                      chartHeight -
                      (stats.outgoingCalls / maxValue) * chartHeight -
                      5
                    }
                    textAnchor="middle"
                    className="text-xs font-semibold fill-gray-700 dark:fill-gray-300"
                  >
                    {stats.outgoingCalls}
                  </text>
                  <text
                    x={barSpacing * 3}
                    y={chartHeight + 20}
                    textAnchor="middle"
                    className="text-xs font-medium fill-gray-600 dark:fill-gray-400"
                  >
                    Outgoing
                  </text>
                  <text
                    x={barSpacing * 3}
                    y={chartHeight + 35}
                    textAnchor="middle"
                    className="text-xs font-medium fill-gray-600 dark:fill-gray-400"
                  >
                    Calls
                  </text>
                </g>
              </svg>
            </div>

            {/* Legend - Bottom aligned */}
            <div className="flex flex-wrap justify-center gap-2 sm:gap-4 md:gap-6 w-full mt-2">
              {/* Total Campaigns Legend */}
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded bg-cyan-600 flex-shrink-0"></div>
                <span className="text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300">
                  Total Campaigns ({stats.totalCampaigns})
                </span>
              </div>

              {/* Incoming Calls Legend */}
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded bg-green-600 flex-shrink-0"></div>
                <span className="text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300">
                  Incoming Calls ({stats.incomingCalls})
                </span>
              </div>

              {/* Outgoing Calls Legend */}
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded bg-blue-600 flex-shrink-0"></div>
                <span className="text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300">
                  Outgoing Calls ({stats.outgoingCalls})
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Call Logs - Responsive width */}
        <div className="w-full bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 sm:p-6 flex flex-col shadow-sm hover:shadow-md transition-shadow duration-200">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="text-lg sm:text-xl lg:text-2xl font-bold text-gray-900 dark:text-white mb-2">
                Call Logs
              </h3>
              <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 font-medium">
                Recent call history
              </p>
            </div>
            <div className="w-10 h-10 sm:w-12 sm:h-12 bg-purple-100 dark:bg-purple-900/30 rounded-lg flex items-center justify-center text-purple-600 dark:text-purple-400">
              <OutlineIcon>
                <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
                <rect x="8" y="2" width="8" height="4" rx="1" />
                <line x1="9" y1="12" x2="15" y2="12" />
                <line x1="9" y1="16" x2="15" y2="16" />
              </OutlineIcon>
            </div>
          </div>

          {callLogsLoading ? (
            <div className="flex justify-center items-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-cyan-500"></div>
            </div>
          ) : callLogs.length > 0 ? (
            <div className="overflow-y-auto max-h-[470px] -mx-4 sm:-mx-6 px-4 sm:px-6">
              <div className="space-y-2 sm:space-y-3">
                {callLogs.slice(0, 10).map((log, index) => {
                  // Parse duration
                  let durationDisplay = "0:00";
                  if (log.call_duration_in_seconds) {
                    durationDisplay = formatDuration(
                      log.call_duration_in_seconds
                    );
                  } else if (log.call_duration) {
                    durationDisplay = log.call_duration;
                  } else if (log.duration) {
                    durationDisplay = formatDuration(log.duration);
                  }

                  return (
                    <div
                      key={index}
                      className="border border-gray-200 dark:border-gray-600 rounded-lg p-3 sm:p-4 hover:border-gray-300 dark:hover:border-gray-500 hover:shadow-sm transition-all duration-200 bg-white dark:bg-gray-800"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-xs sm:text-sm font-semibold text-gray-900 dark:text-white">
                              {log.bot_name ||
                                log.agent_name ||
                                log.source ||
                                "N/A"}
                            </span>
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                                log.call_status === "completed" ||
                                log.status === "completed"
                                  ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                                  : log.call_status === "failed" ||
                                    log.status === "failed"
                                  ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                                  : "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                              }`}
                            >
                              {log.call_status || log.status || "pending"}
                            </span>
                          </div>
                          <p className="text-xs sm:text-sm text-gray-700 dark:text-gray-300">
                            {log.to_number || log.phone_number || "N/A"}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 sm:gap-3 text-xs text-gray-600 dark:text-gray-400 mt-2 mb-2">
                        <span className="flex items-center gap-1.5">
                          <OutlineIcon sizeClass="w-4 h-4 sm:w-4 sm:h-4">
                            <circle cx="12" cy="12" r="9" />
                            <polyline points="12 7 12 12 15 15" />
                          </OutlineIcon>
                          <span className="font-medium">{durationDisplay}</span>
                        </span>
                        <span className="flex items-center gap-1.5">
                          <OutlineIcon sizeClass="w-4 h-4 sm:w-4 sm:h-4">
                            <line x1="12" y1="2" x2="12" y2="22" />
                            <path d="M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H7" />
                          </OutlineIcon>
                          <span className="font-medium">
                            ${(log.call_cost || log.cost || 0).toFixed(3)}
                          </span>
                        </span>
                        <span className="flex items-center gap-1.5">
                          <OutlineIcon sizeClass="w-4 h-4 sm:w-4 sm:h-4">
                            <polygon points="12 3 14.5 8.5 20.5 9.3 16 13.4 17.2 19.4 12 16.2 6.8 19.4 8 13.4 3.5 9.3 9.5 8.5 12 3" />
                          </OutlineIcon>
                          <span className="font-medium">
                            {(log.cqs_score || log.cqsScore || 0).toFixed(1)}
                          </span>
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-2 flex items-center gap-1 break-all">
                        <span>🕐</span>
                        {formatDate(
                          log.time_of_call ||
                            log.created_at ||
                            log.date ||
                            log.timestamp ||
                            log.time
                        )}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="text-center py-12 flex-1 flex items-center justify-center">
              <div>
                <p className="text-gray-500 dark:text-gray-400 mb-2">
                  No call logs found
                </p>
                <p className="text-xs text-gray-400 dark:text-gray-500">
                  Recent call history will appear here
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Overview;
