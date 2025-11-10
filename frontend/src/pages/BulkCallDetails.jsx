import React, { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import api from "../utils/api";
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
import AudioPlayer from "../components/AudioPlayer";
import { useToast } from "../contexts/ToastContext";

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
      const url = `${api.defaults.baseURL}/v1/calls/bulk_call/recording/${lineId}`;
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
              const downloadUrl = `${api.defaults.baseURL}/v1/calls/bulk_call/recording/${lineId}/download`;
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
      const response = await api.get(`/v1/calls/bulk_call/${id}`);
      if (response.data.success) {
        setCampaign(response.data.data);

        // Trigger campaign enhancement in background
        enhanceCampaignData(id);
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

  // User-triggered campaign enhancement
  const enhanceCampaignData = async (campaignId) => {
    try {
      console.log(`🚀 Triggering enhancement for campaign ${campaignId}`);

      const response = await api.post(
        `/v1/calls/bulk_call/${campaignId}/enhance`
      );

      if (response.data.success) {
        console.log(`✅ Campaign enhancement started:`, response.data);
        console.log(
          `📊 Processing ${response.data.totalLines} call lines in background`
        );

        // Optional: Show a subtle notification
        // showToast?.("Campaign data enhancement started in background", "info");
      }
    } catch (error) {
      console.error("❌ Error starting campaign enhancement:", error);
      // Don't show error to user since this is background process
    }
  };

  const getStatusBadgeClass = (status) => {
    switch (status) {
      case "completed":
        return "bg-cyan-600 text-white";
      case "in_progress":
        return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300";
      case "pending":
        return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300";
      case "failed":
        return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300";
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
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate("/bulk-call")}
              className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white text-2xl"
            >
              ←
            </button>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
              Bulk Call Campaign Details
            </h1>
          </div>
          {/* <div className="flex items-center gap-4">
            <button className="px-4 py-2 bg-gray-200 dark:bg-gray-800 hover:bg-gray-300 dark:hover:bg-gray-700 rounded-lg transition flex items-center gap-2 text-gray-900 dark:text-white">
              <span>✏️</span>
              <span>Auto Retry Settings</span>
            </button>
            <button className="px-4 py-2 bg-gray-200 dark:bg-gray-800 hover:bg-gray-300 dark:hover:bg-gray-700 rounded-lg transition flex items-center gap-2 text-gray-900 dark:text-white">
              <span>⚙️</span>
              <span>Reschedule Settings</span>
            </button>
          </div> */}
        </div>

        {/* Tabs */}
        <div className="flex gap-2 border-b border-gray-200 dark:border-gray-700">
          {[
            {
              id: "overview",
              label: "Overview",
              icon: (active) => (
                <svg
                  className={`w-5 h-5 ${
                    active
                      ? "text-cyan-600 dark:text-cyan-400"
                      : "text-gray-500 dark:text-gray-400"
                  }`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.8}
                    d="M3 12l2-2m0 0l7-7 7 7m-9 5v6m-4 0h8a2 2 0 002-2v-5a2 2 0 012-2h1m-3 0v-3m0 0l2 2m-2-2l-2 2"
                  />
                </svg>
              ),
            },
            {
              id: "analytics",
              label: "Analytics",
              icon: (active) => (
                <svg
                  className={`w-5 h-5 ${
                    active
                      ? "text-cyan-600 dark:text-cyan-400"
                      : "text-gray-500 dark:text-gray-400"
                  }`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.8}
                    d="M3 3v18h18M7 16l3-3 4 4 5-7"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.8}
                    d="M16 6a1 1 0 112 0 1 1 0 01-2 0z"
                  />
                </svg>
              ),
            },
          ].map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-2 flex items-center gap-2 border-b-2 transition ${
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
      <div className="mb-6 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">
            Campaign: {campaign.name}
          </h2>
          <span
            className={`inline-flex px-3 py-1 text-sm font-semibold rounded-full ${getStatusBadgeClass(
              campaign.status
            )}`}
          >
            {campaign.status}
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <p className="text-sm text-gray-600 dark:text-gray-400">Bot</p>
            <p className="text-gray-900 dark:text-white">
              {campaign.bot?.name || campaign.botName || "N/A"}
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Concurrent Calls
            </p>
            <p className="text-gray-900 dark:text-white">
              {campaign.concurrentCalls || 1}
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-600 dark:text-gray-400">Number</p>
            <p className="text-cyan-600 dark:text-cyan-400">
              {campaign.fromNumber}
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Created By
            </p>
            <p className="text-gray-900 dark:text-white">
              {campaign.createdByName || campaign.createdBy || "System"}
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Created On
            </p>
            <p className="text-gray-900 dark:text-white">
              {campaign.createdAt
                ? new Date(campaign.createdAt).toLocaleString()
                : "N/A"}
            </p>
          </div>
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === "overview" && <OverviewTab campaign={campaign} />}
      {activeTab === "analytics" && <AnalyticsTab campaign={campaign} />}
      {/* {activeTab === "call-lines" && <CallLinesTab campaignId={id} />} */}
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
        <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
          Campaign Overview
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
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
            label="Calls picked up"
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
        <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
          Campaign Outcomes
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
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
const AnalyticsTab = ({ campaign }) => {
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const campaignId = campaign?.omnidimensionId || campaign?._id;

  useEffect(() => {
    if (campaignId) {
      fetchAnalytics();
    }
  }, [campaignId]);

  const fetchAnalytics = async () => {
    try {
      setLoading(true);
      const response = await api.get(
        `/v1/calls/bulk_call/${campaignId}/analytics`
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
    campaign.totalCalls ??
    0;
  const completedCalls =
    analytics?.completedCalls ?? campaign.completedCalls ?? 0;
  const pickupRate =
    analytics?.pickupRate ??
    (totalCalls > 0 ? (completedCalls / totalCalls) * 100 : 0);
  const pickupRateDisplay = `${Number(pickupRate || 0).toFixed(1)}%`;
  const averageP50Value =
    analytics?.p50Distribution?.percentile ??
    campaign.avgP50Time ??
    (campaign.progress?.averageDuration || 0);
  const averageP50Display = `${Number(averageP50Value || 0).toFixed(0)}ms`;
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
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6">
          <h4 className="text-lg font-bold text-gray-900 dark:text-white mb-4">
            Call Status Distribution
          </h4>
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
        </div>

     { /*  <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6">
          <h4 className="text-lg font-bold text-gray-900 dark:text-white mb-4">
            Interaction End-Call Distribution
          </h4>
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
        </div>  */}

        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6">
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

        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6">
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

// Call Lines Tab Component
const CallLinesTab = ({ campaignId }) => {
  const [callLines, setCallLines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fetchingRecordings, setFetchingRecordings] = useState(false);
  const [pagination, setPagination] = useState({
    pageno: 1,
    pagesize: 50,
    total: 0,
  });
  const [filters, setFilters] = useState({ call_status: "", interaction: "" });
  const [selectedTranscript, setSelectedTranscript] = useState(null);
  const { showToast } = useToast();

  useEffect(() => {
    if (campaignId) {
      fetchCallLines();
    }
  }, [campaignId, pagination.pageno, filters]);

  const fetchCallLines = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        pageno: pagination.pageno,
        pagesize: pagination.pagesize,
        ...(filters.call_status && { call_status: filters.call_status }),
        ...(filters.interaction && { interaction: filters.interaction }),
      });
      const response = await api.get(
        `/v1/calls/bulk_call/${campaignId}/lines?${params}`
      );

      // Debug: Log what we're receiving from backend
      console.log("🔍 Bulk Call Lines - Backend Response:", response.data);
      if (
        response.data.success &&
        response.data.data &&
        response.data.data.length > 0
      ) {
        console.log(
          "🔍 Sample Call Line Data:",
          JSON.stringify(response.data.data[0], null, 2)
        );
        console.log("🔍 Recording Structure:", {
          hasRecording: !!response.data.data[0].recording,
          recordingAvailable: response.data.data[0].recording?.available,
          recordingUrl: response.data.data[0].recording?.url,
          allKeys: Object.keys(response.data.data[0]),
        });
      }

      if (response.data.success) {
        setCallLines(response.data.data);
        setPagination((prev) => ({ ...prev, ...response.data.pagination }));
      }
    } catch (err) {
      console.error("Error fetching call lines:", err);
      showToast("Failed to fetch call lines", "error");
    } finally {
      setLoading(false);
    }
  };

  const handleFetchRecordings = async () => {
    try {
      setFetchingRecordings(true);
      const response = await api.post(
        `/v1/calls/bulk_call/${campaignId}/fetch-recordings`
      );
      if (response.data.success) {
        const { fetched, failed, alreadyAvailable } = response.data.data;
        showToast(
          `Fetched recordings: ${fetched} new, ${alreadyAvailable} already available, ${failed} failed`,
          fetched > 0 ? "success" : "info"
        );
        // Refresh call lines to show updated recordings
        await fetchCallLines();
      }
    } catch (err) {
      console.error("Error fetching recordings:", err);
      showToast(
        err.response?.data?.message || "Failed to fetch recordings",
        "error"
      );
    } finally {
      setFetchingRecordings(false);
    }
  };

  const formatDuration = (seconds) => {
    if (!seconds) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const getStatusBadge = (status) => {
    const classes = {
      completed:
        "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
      failed: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
      pending:
        "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
      busy: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300",
      "no-answer":
        "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300",
    };
    return classes[status] || classes.pending;
  };

  // Hybrid approach: Fetch complete call details using stored call ID
  const handleViewTranscript = async (line) => {
    console.log("🔍 handleViewTranscript called with line:", line);

    try {
      // Check if call line has ID
      if (!line._id) {
        console.log("❌ No line ID found");
        setSelectedTranscript({
          ...line,
          loading: false,
          error: "Call line ID not available",
        });
        return;
      }

      console.log("🔍 Using line ID:", line._id);

      // Set loading state
      setSelectedTranscript({ ...line, loading: true });

      console.log("📞 Calling hybrid fetch-call-line API");

      // Call the hybrid fetch call line API endpoint
      const response = await api.post(`/calls/bulk_call/fetch-call-line`, {
        lineId: line._id,
      });

      console.log("✅ Hybrid call line API response:", response.data);

      if (response.data.success && response.data.data) {
        const callData = response.data.data;
        setSelectedTranscript({
          ...line,
          // Core call data
          transcript: callData.transcript,
          callId: callData.callId,
          duration: callData.duration,
          callStatus: callData.callStatus,
          interaction: callData.interaction,

          // Enhanced metadata from individual call
          metadata: {
            ...callData.metadata,
            p50Latency: callData.metadata?.p50Latency || 0,
            p99Latency: callData.metadata?.p99Latency || 0,
            cqsScore: callData.metadata?.cqsScore || 0,
            sentimentScore: callData.metadata?.sentimentScore,
            callCost: callData.metadata?.callCost || 0,
            totalTokens: callData.metadata?.totalTokens || 0,
          },

          // Bot and interaction details
          botName: callData.botName,
          channelType: callData.channelType,
          interactions: callData.interactions || [],

          // Additional details
          amdDetected: callData.amdDetected,
          isVoicemail: callData.isVoicemail,
          fromNumber: callData.fromNumber,

          loading: false,
        });
        console.log("✅ Hybrid call details updated successfully");
      } else {
        console.log("❌ No call data in response");
        const errorMsg = response.data.message || "No call data found";
        setSelectedTranscript({ ...line, loading: false, error: errorMsg });
      }
    } catch (error) {
      console.error("❌ Error fetching hybrid call details:", error);
      let errorMsg =
        error.response?.data?.message || "Failed to fetch call details";

      // Check if it's a 404 or missing call ID error
      if (
        error.response?.status === 404 ||
        errorMsg.includes("Route not found")
      ) {
        errorMsg =
          "Please restart the backend server to register new endpoints";
      } else if (
        errorMsg.includes("No call ID available") ||
        errorMsg.includes("fetch recordings first")
      ) {
        errorMsg = "Please click 'Fetch Recordings' first to get call IDs";
      }

      setSelectedTranscript({
        ...line,
        loading: false,
        error: errorMsg,
      });
    }
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

  if (loading && callLines.length === 0) {
    return (
      <div className="flex justify-center items-center py-20">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-cyan-500"></div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-4">
        <div className="flex items-center gap-4">
          <h3 className="text-xl font-bold text-gray-900 dark:text-white">
            Call Lines
          </h3>
          <span className="text-sm text-gray-600 dark:text-gray-400">
            {pagination.total} call{pagination.total !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-4 flex gap-4">
        <select
          value={filters.call_status}
          onChange={(e) =>
            setFilters({ ...filters, call_status: e.target.value })
          }
          className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
        >
          <option value="">All Status</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
          <option value="pending">Pending</option>
          <option value="busy">Busy</option>
          <option value="no-answer">No Answer</option>
        </select>
        <select
          value={filters.interaction}
          onChange={(e) =>
            setFilters({ ...filters, interaction: e.target.value })
          }
          className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
        >
          <option value="">All Interactions</option>
          <option value="completed">Completed</option>
          <option value="low_interaction">Low Interaction</option>
          <option value="no_interaction">No Interaction</option>
          <option value="transfer">Transfer</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-gray-900">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Call Date
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Phone Number
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Call Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Interaction
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Duration
                </th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              {callLines.length === 0 ? (
                <tr>
                  <td
                    colSpan="7"
                    className="px-6 py-4 text-center text-gray-500 dark:text-gray-400"
                  >
                    No call lines found
                  </td>
                </tr>
              ) : (
                callLines.map((line, idx) => (
                  <tr
                    key={idx}
                    className="hover:bg-gray-50 dark:hover:bg-gray-700"
                  >
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                      {line.callDate
                        ? new Date(line.callDate).toLocaleString()
                        : "N/A"}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                      {line.toNumber}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span
                        className={`px-2 py-1 text-xs font-semibold rounded-full ${getStatusBadge(
                          line.callStatus
                        )}`}
                      >
                        {line.callStatus || "pending"}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                      {line.interaction || "no_interaction"}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                      {formatDuration(line.duration)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pagination.pages > 1 && (
          <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <div className="text-sm text-gray-600 dark:text-gray-400">
              Showing {(pagination.pageno - 1) * pagination.pagesize + 1} to{" "}
              {Math.min(
                pagination.pageno * pagination.pagesize,
                pagination.total
              )}{" "}
              of {pagination.total}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() =>
                  setPagination({
                    ...pagination,
                    pageno: pagination.pageno - 1,
                  })
                }
                disabled={pagination.pageno === 1}
                className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white disabled:opacity-50"
              >
                Previous
              </button>
              <button
                onClick={() =>
                  setPagination({
                    ...pagination,
                    pageno: pagination.pageno + 1,
                  })
                }
                disabled={pagination.pageno >= pagination.pages}
                className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Transcript Modal */}
      {selectedTranscript && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4"
          onClick={() => setSelectedTranscript(null)}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
              <div>
                <h3 className="text-xl font-bold text-gray-900 dark:text-white">
                  Call Transcript
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                  {selectedTranscript.toNumber} •{" "}
                  {formatDuration(selectedTranscript.duration)} •{" "}
                  {new Date(
                    selectedTranscript.callDate || selectedTranscript.createdAt
                  ).toLocaleString()}
                </p>
              </div>
              <button
                onClick={() => setSelectedTranscript(null)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition"
              >
                <svg
                  className="w-6 h-6"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-6">
              {selectedTranscript.loading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-600"></div>
                  <span className="ml-3 text-gray-600 dark:text-gray-400">
                    Fetching transcript...
                  </span>
                </div>
              ) : selectedTranscript.transcript ? (
                <div className="space-y-4">
                  <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4">
                    <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                      Call Details
                    </h4>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <span className="text-gray-600 dark:text-gray-400">
                          Status:
                        </span>
                        <span
                          className={`ml-2 px-2 py-1 rounded text-xs ${getStatusBadge(
                            selectedTranscript.callStatus
                          )}`}
                        >
                          {selectedTranscript.callStatus || "pending"}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-600 dark:text-gray-400">
                          Interaction:
                        </span>
                        <span className="ml-2 text-gray-900 dark:text-white">
                          {selectedTranscript.interaction || "no_interaction"}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-600 dark:text-gray-400">
                          Duration:
                        </span>
                        <span className="ml-2 text-gray-900 dark:text-white">
                          {formatDuration(selectedTranscript.duration)}
                        </span>
                      </div>
                      {selectedTranscript.metadata?.cqsScore && (
                        <div>
                          <span className="text-gray-600 dark:text-gray-400">
                            CQS Score:
                          </span>
                          <span className="ml-2 text-gray-900 dark:text-white">
                            {selectedTranscript.metadata.cqsScore.toFixed(2)}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div>
                    <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                      Transcript
                    </h4>
                    <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4 space-y-3 max-h-96 overflow-y-auto">
                      {parseTranscript(selectedTranscript.transcript).map(
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
                </div>
              ) : (
                <div className="text-center py-12">
                  <svg
                    className="w-16 h-16 mx-auto text-gray-400 dark:text-gray-600 mb-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                  </svg>
                  <p className="text-gray-600 dark:text-gray-400 text-lg mb-2">
                    No Transcript Available
                  </p>
                  <p className="text-gray-500 dark:text-gray-500 text-sm">
                    This call does not have a transcript.{" "}
                    {selectedTranscript.interaction === "no_interaction" ||
                    selectedTranscript.interaction === "low_interaction"
                      ? "The call had no or low interaction."
                      : "The transcript may not have been generated yet."}
                  </p>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            {selectedTranscript.transcript && (
              <div className="border-t border-gray-200 dark:border-gray-700 p-4 flex justify-end gap-2">
                <button
                  onClick={() => {
                    const blob = new Blob([selectedTranscript.transcript], {
                      type: "text/plain",
                    });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `transcript-${selectedTranscript.toNumber}-${
                      new Date(
                        selectedTranscript.callDate ||
                          selectedTranscript.createdAt
                      )
                        .toISOString()
                        .split("T")[0]
                    }.txt`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                  }}
                  className="px-4 py-2 text-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition"
                >
                  Download Transcript
                </button>
                <button
                  onClick={() => setSelectedTranscript(null)}
                  className="px-4 py-2 text-sm bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 transition"
                >
                  Close
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// // Logs Tab Component
// const LogsTab = ({ campaignId }) => {
//   const [logs, setLogs] = useState([]);
//   const [loading, setLoading] = useState(true);

//   useEffect(() => {
//     if (campaignId) {
//       fetchLogs();
//     }
//   }, [campaignId]);

//   const fetchLogs = async () => {
//     try {
//       setLoading(true);
//       const response = await api.get(`/v1/calls/bulk_call/${campaignId}/logs`);
//       if (response.data.success) {
//         setLogs(response.data.data);
//       }
//     } catch (err) {
//       console.error("Error fetching logs:", err);
//     } finally {
//       setLoading(false);
//     }
//   };

//   const getActivityTypeBadge = (type) => {
//     const classes = {
//       created: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
//       completed:
//         "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
//       updated:
//         "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
//       started: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-300",
//       cancelled: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
//     };
//     return (
//       classes[type] ||
//       "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300"
//     );
//   };

//   if (loading) {
//     return (
//       <div className="flex justify-center items-center py-20">
//         <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-cyan-500"></div>
//       </div>
//     );
//   }

//   return (
//     <div>
//       <div className="flex items-center justify-between mb-4">
//         <h3 className="text-xl font-bold text-gray-900 dark:text-white">
//           Activity Logs
//         </h3>
//         <div className="flex items-center gap-4">
//           <p className="text-sm text-gray-600 dark:text-gray-400">
//             {logs.length} log{logs.length !== 1 ? "s" : ""}
//           </p>
//           <button
//             onClick={fetchLogs}
//             className="px-3 py-1 bg-gray-200 dark:bg-gray-800 hover:bg-gray-300 dark:hover:bg-gray-700 rounded-lg transition"
//           >
//             🔄 Refresh
//           </button>
//         </div>
//       </div>

//       {/* Table */}
//       <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
//         <div className="overflow-x-auto">
//           <table className="w-full">
//             <thead className="bg-gray-50 dark:bg-gray-900">
//               <tr>
//                 <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
//                   Date & Time
//                 </th>
//                 <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
//                   Activity Type
//                 </th>
//                 <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
//                   Initiated By
//                 </th>
//                 <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
//                   Description
//                 </th>
//               </tr>
//             </thead>
//             <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
//               {logs.length === 0 ? (
//                 <tr>
//                   <td
//                     colSpan="4"
//                     className="px-6 py-4 text-center text-gray-500 dark:text-gray-400"
//                   >
//                     No activity logs found
//                   </td>
//                 </tr>
//               ) : (
//                 logs.map((log, idx) => (
//                   <tr
//                     key={idx}
//                     className="hover:bg-gray-50 dark:hover:bg-gray-700"
//                   >
//                     <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
//                       {log.createdAt
//                         ? new Date(log.createdAt).toLocaleString()
//                         : "N/A"}
//                     </td>
//                     <td className="px-6 py-4 whitespace-nowrap">
//                       <span
//                         className={`px-2 py-1 text-xs font-semibold rounded-full ${getActivityTypeBadge(
//                           log.activityType
//                         )}`}
//                       >
//                         {log.activityType}
//                       </span>
//                     </td>
//                     <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
//                       {log.initiatedBy?.userName ||
//                         log.initiatedBy?.type ||
//                         "System"}
//                     </td>
//                     <td className="px-6 py-4 text-sm text-gray-900 dark:text-white">
//                       {log.description}
//                     </td>
//                   </tr>
//                 ))
//               )}
//             </tbody>
//           </table>
//         </div>
//       </div>
//     </div>
//   );
// };

// Helper Components
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
};

const StatCard = ({ icon, value, label, info, valueColor = "" }) => (
  <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
    <div className="flex items-center justify-between mb-2">
      <span className="text-2xl">
        {typeof icon === "function"
          ? icon("w-6 h-6 text-cyan-600 dark:text-cyan-400")
          : icon}
      </span>
      <span className="text-xs text-gray-500 dark:text-gray-400">ℹ️</span>
    </div>
    <p
      className={`text-2xl font-bold mb-1 ${
        valueColor || "text-gray-900 dark:text-white"
      }`}
    >
      {value}
    </p>
    <p className="text-sm text-gray-600 dark:text-gray-400">{label}</p>
    <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">{info}</p>
  </div>
);

const OutcomeCard = ({
  icon,
  value,
  label,
  info,
  valueColor = "",
  subItems = [],
}) => (
  <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
    <div className="flex items-center justify-between mb-2">
      <span className="text-2xl">
        {typeof icon === "function"
          ? icon("w-6 h-6 text-cyan-600 dark:text-cyan-400")
          : icon}
      </span>
      <span className="text-xs text-gray-500 dark:text-gray-400">ℹ️</span>
    </div>
    <p
      className={`text-2xl font-bold mb-1 ${
        valueColor || "text-gray-900 dark:text-white"
      }`}
    >
      {value}
    </p>
    <p className="text-sm text-gray-600 dark:text-gray-400">{label}</p>
    <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">{info}</p>
    {subItems && subItems.length > 0 && (
      <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700 space-y-1">
        {subItems.map((item, idx) => (
          <div key={idx} className="flex justify-between text-xs">
            <span className="text-gray-600 dark:text-gray-400">
              {item.label}:
            </span>
            <span className="text-gray-900 dark:text-white">{item.value}</span>
          </div>
        ))}
      </div>
    )}
  </div>
);

const KPICard = ({ icon, value, label, valueColor }) => (
  <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6">
    <div className="flex items-center justify-between mb-4">
      <span className="text-3xl">
        {typeof icon === "function"
          ? icon("w-8 h-8 text-cyan-600 dark:text-cyan-400")
          : icon}
      </span>
    </div>
    <p className={`text-4xl font-bold mb-2 ${valueColor}`}>{value}</p>
    <p className="text-sm text-gray-600 dark:text-gray-400">{label}</p>
  </div>
);

export default BulkCallDetails;
