import React, { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import api from "../../utils/api";
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { useToast } from "../../contexts/ToastContext";

// Recording Player Component for Call Lines - handles authentication and blob URL creation
const CallLineRecordingPlayer = ({ lineId, recordingUrl }) => {
  const { showToast } = useToast();
  const [blobUrl, setBlobUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const audioRef = useRef(null);

  const loadRecording = async () => {
    if (!lineId || !recordingUrl || blobUrl || loading) return;

    setLoading(true);
    try {
      const token = localStorage.getItem("token");
      const url = `${api.defaults.baseURL}/user/calls/bulk_call/recording/${lineId}`;
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
    if (recordingUrl && lineId && !blobUrl && !loading) {
      // Load recording in background when component mounts
      loadRecording();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordingUrl, lineId]); // Only load when component mounts or recordingUrl/lineId changes

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

  // Show error if no recording available
  if (!recordingUrl || !lineId) {
    return (
      <span className="text-red-700 dark:text-red-500 text-xs sm:text-sm font-medium">
        failed call
      </span>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {loading && (
        <div className="flex items-center gap-1">
          <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-cyan-500"></div>
        </div>
      )}
      <audio
        ref={audioRef}
        controls
        preload="none"
        className="h-8 w-32 sm:w-40"
        src={blobUrl || undefined}
        onPlay={handlePlay}
        onError={(e) => {
          console.error("Audio playback error:", e);
          // If loading fails, try loading again
          if (!blobUrl && !loading) {
            loadRecording();
          }
        }}
        onLoadStart={() => {
          // Auto-load when audio element tries to load
          if (!blobUrl && !loading && recordingUrl) {
            loadRecording();
          }
        }}
      >
        Your browser does not support the audio element.
      </audio>
      {recordingUrl && (
        <button
          onClick={async () => {
            try {
              const token = localStorage.getItem("token");
              const downloadUrl = `${api.defaults.baseURL}/user/calls/bulk_call/recording/${lineId}/download`;
              const response = await fetch(downloadUrl, {
                headers: {
                  Authorization: `Bearer ${token}`,
                },
              });
              if (response.ok) {
                const blob = await response.blob();
                const url = window.URL.createObjectURL(blob);
                const link = document.createElement("a");
                link.href = url;
                link.download = `recording-${lineId}.mp3`;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                window.URL.revokeObjectURL(url);
              } else {
                showToast("Failed to download recording", "error");
              }
            } catch (err) {
              console.error("Download error:", err);
              showToast("Failed to download recording", "error");
            }
          }}
          className="px-2 py-1 text-xs bg-cyan-600 hover:bg-cyan-700 text-white rounded transition"
          title="Download as MP3"
        >
          ⬇️
        </button>
      )}
    </div>
  );
};

const BulkCallDetails = () => {
  const { showToast } = useToast();
  const { id } = useParams();
  const navigate = useNavigate();
  const [campaign, setCampaign] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState("overview");

  useEffect(() => {
    if (id) {
      fetchCampaignDetails();
    }
  }, [id]);

  const fetchCampaignDetails = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await api.get(`/user/calls/bulk_call/${id}`);
      if (response.data.success) {
        setCampaign(response.data.data);
      }
    } catch (err) {
      console.error("Error fetching campaign details:", err);
      setError(
        err.response?.data?.message || "Failed to fetch campaign details"
      );
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadgeClass = (status) => {
    switch (status) {
      case "completed":
      case "COMPLETED":
        return "bg-cyan-600 text-white";
      case "in_progress":
      case "active":
        return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300";
      case "pending":
        return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300";
      case "failed":
      case "cancelled":
        return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300";
      case "retry_scheduled":
        return "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300";
      case "paused":
        return "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300";
      default:
        return "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300";
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center py-20">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-cyan-500"></div>
      </div>
    );
  }

  if (error || !campaign) {
    return (
      <div className="p-6">
        <div className="bg-red-100 dark:bg-red-900/30 border border-red-400 dark:border-red-700 rounded-lg p-4 text-red-700 dark:text-red-300">
          {error || "Campaign not found"}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white">
      {/* Header */}
      <div className="mb-4 sm:mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 mb-4">
          <div className="flex items-center gap-2 sm:gap-4">
            <button
              onClick={() => navigate("/user/bulk-calls")}
              className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white text-xl sm:text-2xl flex-shrink-0"
            >
              ←
            </button>
            <h1 className="text-lg sm:text-2xl lg:text-3xl font-bold text-gray-900 dark:text-white">
              Campaign Details
            </h1>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 sm:gap-2 border-b border-gray-200 dark:border-gray-700 overflow-x-auto">
          {[
            {
              id: "overview",
              label: "Overview",
              icon: (active) =>
                iconVariants.overview(
                  `w-5 h-5 ${
                    active
                      ? "text-cyan-600 dark:text-cyan-400"
                      : "text-gray-500 dark:text-gray-400"
                  }`
                ),
            },
            {
              id: "analytics",
              label: "Analytics",
              icon: (active) =>
                iconVariants.analytics(
                  `w-5 h-5 ${
                    active
                      ? "text-cyan-600 dark:text-cyan-400"
                      : "text-gray-500 dark:text-gray-400"
                  }`
                ),
            },
          ].map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-3 sm:px-4 py-2 flex items-center gap-1 sm:gap-2 border-b-2 transition whitespace-nowrap text-sm sm:text-base ${
                  isActive
                    ? "border-cyan-600 text-cyan-600 dark:text-cyan-400"
                    : "border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                }`}
              >
                {tab.icon(isActive)}
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Campaign Summary */}
      <div className="mb-4 sm:mb-6 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 mb-4">
          <h2 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white">
            {campaign.name}
          </h2>
          <span
            className={`inline-flex px-2 sm:px-3 py-1 text-xs sm:text-sm font-semibold rounded-full ${getStatusBadgeClass(
              campaign.status
            )}`}
          >
            {campaign.status}
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          <div>
            <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">Bot</p>
            <p className="text-sm sm:text-base text-gray-900 dark:text-white truncate">
              {campaign.bot?.name || campaign.botName || "N/A"}
            </p>
          </div>
          <div>
            <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">
              Concurrent Calls
            </p>
            <p className="text-sm sm:text-base text-gray-900 dark:text-white">
              {campaign.concurrentCalls || 1}
            </p>
          </div>
          <div>
            <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">Number</p>
            <p className="text-sm sm:text-base text-cyan-600 dark:text-cyan-400 truncate">
              {campaign.fromNumber}
            </p>
          </div>
          <div>
            <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">
              Created By
            </p>
            <p className="text-sm sm:text-base text-gray-900 dark:text-white truncate">
              {campaign.createdByName || campaign.createdBy || "System"}
            </p>
          </div>
          <div className="sm:col-span-2 lg:col-span-1">
            <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">
              Created On
            </p>
            <p className="text-sm sm:text-base text-gray-900 dark:text-white">
              {campaign.createdAt
                ? new Date(campaign.createdAt).toLocaleString()
                : "N/A"}
            </p>
          </div>
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === "overview" && <OverviewTab campaign={campaign} />}
      {activeTab === "analytics" && (
        <AnalyticsTab campaign={campaign} campaignId={id} />
      )}
      {activeTab === "call-lines" && <CallLinesTab campaignId={id} />}
      {/* {activeTab === "logs" && <LogsTab campaignId={id} />} */}
    </div>
  );
};

// Overview Tab Component
const OverviewTab = ({ campaign }) => {
  return (
    <div className="space-y-6">
      {/* Campaign Overview */}
      <div>
        <h3 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white mb-3 sm:mb-4">
          Campaign Overview
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard
          icon={iconVariants.total}
            value={campaign.progress?.total || campaign.totalCalls || 0}
            label="Campaign target"
            info="Total Calls to Dispatch"
          />
        <StatCard
          icon={iconVariants.attempts}
            value={
              campaign.totalCallsMade ??
              campaign.completedCalls ??
              campaign.progress?.completed ??
              0
            }
            label="Attempts made"
            info="Total Calls Made"
          />
        <StatCard
          icon={iconVariants.pickupRate}
            value={campaign.callsPickedUp ?? campaign.completedCalls ?? 0}
            label="Calls Picked Up"
          info="Calls Picked Up"
            valueColor="text-green-600 dark:text-green-400"
          />
        <StatCard
          icon={iconVariants.cost}
            value={`$${(campaign.totalCost || 0).toFixed(3)}`}
            label="Campaign cost"
            info="Total Call Cost"
          />
        </div>
      </div>

      {/* Campaign Outcomes */}
      <div>
        <h3 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white mb-3 sm:mb-4">
          Campaign Outcomes
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <OutcomeCard
            icon={iconVariants.engagement}
            value={
              campaign.highEngagementCalls ??
              campaign.completedCalls ??
              campaign.callsPickedUp ??
              0
            }
            label="High engagement"
            info="Completed Calls"
            valueColor="text-green-600 dark:text-green-400"
          />
          <OutcomeCard
            icon={iconVariants.minimal}
            value={campaign.noLowInteractionCalls || 0}
            label="No or Minimal engagement"
            info="No/Low Interaction"
            valueColor="text-yellow-600 dark:text-yellow-400"
          />
          <OutcomeCard
            icon={iconVariants.pending}
            value={campaign.pendingCalls || 0}
            label="0% remaining"
            info="Pending Calls"
            valueColor="text-blue-600 dark:text-blue-400"
          />
          <OutcomeCard
            icon={iconVariants.unreachable}
            value={campaign.notReachableCalls || 0}
            label="Not Reachable"
            info="Not Reachable Calls"
            subItems={[
              { label: "No-answer", value: campaign.noAnswerCalls || 0 },
              { label: "Busy", value: campaign.busyCalls || 0 },
              { label: "Failed", value: campaign.failedCalls || 0 },
            ]}
          />
        </div>
      </div>


    </div>
  );
};

// Analytics Tab Component
const AnalyticsTab = ({ campaign, campaignId }) => {
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (campaignId) {
      fetchAnalytics();
    }
  }, [campaignId]);

  const fetchAnalytics = async () => {
    try {
      setLoading(true);
      const response = await api.get(
        `/user/calls/bulk_call/${campaignId}/analytics`
      );
      if (response.data.success) {
        setAnalytics(response.data.data);
      }
    } catch (err) {
      console.error("Error fetching analytics:", err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center py-20">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-cyan-500"></div>
      </div>
    );
  }

  const statusData = analytics?.statusDistribution
    ? Object.entries(analytics.statusDistribution)
        .filter(([, value]) => value > 0)
        .map(([name, value]) => ({
          name,
          value,
        }))
    : [];
  const interactionData = analytics?.interactionDistribution
    ? Object.entries(analytics.interactionDistribution)
        .filter(([, value]) => value > 0)
        .map(([name, value]) => ({ name, value }))
    : [];

  const COLORS = [
    "#06b6d4",
    "#3b82f6",
    "#10b981",
    "#f59e0b",
    "#ef4444",
    "#8b5cf6",
  ];

  const totalCalls =
    analytics?.totalCalls ??
    campaign.progress?.total ??
    campaign.totalCallsMade ??
    campaign.totalCalls ??
    0;
  const completedCalls =
    analytics?.completedCalls ??
    campaign.highEngagementCalls ??
    campaign.callsPickedUp ??
    campaign.completedCalls ??
    0;
  const pickupRate =
    analytics?.pickupRate ??
    (totalCalls > 0 ? (completedCalls / totalCalls) * 100 : 0);
  const pickupRateDisplay = `${Number(pickupRate || 0).toFixed(1)}%`;
  const totalCostValue =
    analytics?.totalCost ?? campaign.totalCost ?? campaign.progress?.cost ?? 0;

  const p50ChartData =
    analytics?.p50Distribution?.values
      ?.filter((val) => Number(val) > 0)
      .map((val, idx) => ({
        index: idx + 1,
        value: val,
      })) || [];

  const p99ChartData =
    analytics?.p99Distribution?.values
      ?.filter((val) => Number(val) > 0)
      .map((val, idx) => ({
        index: idx + 1,
        value: val,
      })) || [];

  const averageP50Value =
    analytics?.p50Distribution?.percentile ??
    campaign.avgP50Time ??
    (campaign.progress?.averageDuration || 0);
  const averageP50Display = `${Number(averageP50Value || 0).toFixed(0)}ms`;

  const renderEmptyChart = (message) => (
    <div className="flex h-[300px] items-center justify-center text-sm text-gray-500 dark:text-gray-400">
      {message}
    </div>
  );

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <KPICard
          icon={iconVariants.total}
          value={totalCalls}
          label="Total Calls"
          valueColor="text-blue-600 dark:text-blue-400"
        />
        <KPICard
          icon={iconVariants.pickupRate}
          value={pickupRateDisplay}
          label="Pickup Rate"
          valueColor="text-green-600 dark:text-green-400"
        />
        <KPICard
          icon={iconVariants.duration}
          value={averageP50Display}
          label="Average p50 Time"
          valueColor="text-yellow-600 dark:text-yellow-400"
        />
        <KPICard
          icon={iconVariants.cost}
          value={`$${Number(totalCostValue || 0).toFixed(4)}`}
          label="Total Cost"
          valueColor="text-purple-600 dark:text-purple-400"
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 sm:p-6">
          <h4 className="text-lg font-bold text-gray-900 dark:text-white mb-4">
            Call Status Distribution
          </h4>
          {statusData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={statusData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) =>
                    `${name} ${(percent * 100).toFixed(0)}%`
                  }
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {statusData.map((entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={COLORS[index % COLORS.length]}
                    />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            renderEmptyChart("No status data available yet")
          )}
        </div>

        {/* <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 sm:p-6">
          <h4 className="text-lg font-bold text-gray-900 dark:text-white mb-4">
            Interaction End-Call Distribution
          </h4>
          {interactionData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={interactionData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="value" fill="#06b6d4" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            renderEmptyChart("No interaction data available yet")
          )}
        </div> */}

        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 sm:p-6">
          <h4 className="text-lg font-bold text-gray-900 dark:text-white mb-4">
            p50 Response Time Distribution
          </h4>
          {p50ChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={p50ChartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="index" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="value" fill="#f59e0b" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            renderEmptyChart("No p50 latency data available yet")
          )}
        </div>

        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 sm:p-6">
          <h4 className="text-lg font-bold text-gray-900 dark:text-white mb-4">
            p99 Response Time Distribution
          </h4>
          {p99ChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={p99ChartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="index" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="value" fill="#ef4444" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            renderEmptyChart("No p99 latency data available yet")
          )}
        </div>
      </div>
    </div>
  );
};

const iconVariants = {
  total: (className = "w-6 h-6") => (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.8}
        d="M3 18v-7a2 2 0 012-2h0a2 2 0 012 2v7m9 0v-4a2 2 0 012-2h0a2 2 0 012 2v4M7 18v-4a2 2 0 012-2h6a2 2 0 012 2v4"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.8}
        d="M3 18h18"
      />
    </svg>
  ),
  pickupRate: (className = "w-6 h-6") => (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.8}
        d="M4 12l4 4 8-8m-9 8h10"
      />
    </svg>
  ),
  duration: (className = "w-6 h-6") => (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <circle cx="12" cy="12" r="8" strokeWidth={1.8} />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.8}
        d="M12 8v4l2.5 2.5"
      />
    </svg>
  ),
  cost: (className = "w-6 h-6") => (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.8}
        d="M12 6v12m-4-2a4 4 0 004 0m0 0a4 4 0 004 0M8 8a4 4 0 004 0m0 0a4 4 0 004 0"
      />
    </svg>
  ),
  overview: (className = "w-6 h-6") => (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.8}
        d="M3 12l2-2m0 0l7-7 7 7m-9 5v6m-4 0h8a2 2 0 002-2v-5a2 2 0 012-2h1"
      />
    </svg>
  ),
  analytics: (className = "w-6 h-6") => (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.8}
        d="M4 4v16h16M8 14l3-3 4 4 5-7"
      />
      <circle cx="16" cy="8" r="1.2" strokeWidth={1.2} fill="currentColor" />
    </svg>
  ),
  attempts: (className = "w-6 h-6") => (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.8}
        d="M12 5v14m0-14l4 4m-4-4l-4 4"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.8}
        d="M6 19a6 6 0 0112 0"
      />
    </svg>
  ),
  engagement: (className = "w-6 h-6") => (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.8}
        d="M5 13l4 4L19 7"
      />
    </svg>
  ),
  minimal: (className = "w-6 h-6") => (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.8}
        d="M12 9v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  ),
  pending: (className = "w-6 h-6") => (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <circle cx="12" cy="12" r="9" strokeWidth={1.8} />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.8}
        d="M12 7v5l3 3"
      />
    </svg>
  ),
  unreachable: (className = "w-6 h-6") => (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.8}
        d="M6.343 6.343l11.314 11.314M6.343 17.657L17.657 6.343"
      />
    </svg>
  ),
};

const KPICard = ({ icon, value, label, valueColor }) => (
  <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3 sm:p-4 lg:p-6">
    <div className="flex items-center justify-between mb-2 sm:mb-4">
      <div className="flex items-center gap-2 sm:gap-3">
        <span className="text-lg sm:text-xl lg:text-2xl">
          {typeof icon === "function"
            ? icon("w-6 h-6 text-cyan-600 dark:text-cyan-400")
            : icon}
        </span>
        <div>
          <p className={`text-lg sm:text-xl lg:text-2xl font-bold ${valueColor || 'text-gray-900 dark:text-white'}`}>
            {value}
          </p>
          <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">{label}</p>
        </div>
      </div>
    </div>
  </div>
);

const StatCard = ({ icon, value, label, info, valueColor }) => (
  <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3 sm:p-4 lg:p-6">
    <div className="flex items-center justify-between mb-2 sm:mb-4">
      <div className="flex items-center gap-2 sm:gap-3">
        <span className="text-lg sm:text-xl lg:text-2xl">
          {typeof icon === "function"
            ? icon("w-6 h-6 text-cyan-600 dark:text-cyan-400")
            : icon}
        </span>
        <div>
          <p className={`text-lg sm:text-xl lg:text-2xl font-bold ${valueColor || 'text-gray-900 dark:text-white'}`}>
            {value}
          </p>
          <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">{label}</p>
          {info && <p className="text-xs text-gray-500 dark:text-gray-500">{info}</p>}
        </div>
      </div>
    </div>
  </div>
);

const OutcomeCard = ({ icon, value, label, info, valueColor, subItems }) => (
  <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3 sm:p-4 lg:p-6">
    <div className="flex items-center justify-between mb-2 sm:mb-4">
      <div className="flex items-center gap-2 sm:gap-3">
        <span className="text-lg sm:text-xl lg:text-2xl">
          {typeof icon === "function"
            ? icon("w-6 h-6 text-cyan-600 dark:text-cyan-400")
            : icon}
        </span>
        <div>
          <p className={`text-lg sm:text-xl lg:text-2xl font-bold ${valueColor || 'text-gray-900 dark:text-white'}`}>
            {value}
          </p>
          <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">{label}</p>
          {info && <p className="text-xs text-gray-500 dark:text-gray-500">{info}</p>}
          {subItems && (
            <div className="mt-2 space-y-1">
              {subItems.map((item, index) => (
                <div key={index} className="flex justify-between text-xs">
                  <span className="text-gray-500 dark:text-gray-400">{item.label}:</span>
                  <span className="text-gray-700 dark:text-gray-300">{item.value}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  </div>
);

export default BulkCallDetails;
