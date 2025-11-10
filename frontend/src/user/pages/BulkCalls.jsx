import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import api from "../../utils/api";
import CampaignWizard from "../components/CampaignWizard";

const BulkCalls = () => {
  const navigate = useNavigate();
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pageno, setPageno] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [actionLoadingId, setActionLoadingId] = useState(null);
  const [actionLoadingType, setActionLoadingType] = useState("");

  // Filter states
  const [filters, setFilters] = useState({
    status: "", // Filter by campaign status
  });

  // Campaign wizard state
  const [showWizard, setShowWizard] = useState(false);

  // Fetch campaigns on component mount
  useEffect(() => {
    fetchCampaigns();
  }, [pageno, filters]);

  // Fetch campaigns from API
  const fetchCampaigns = async () => {
    try {
      setLoading(true);
      setError(null);

      const params = {
        pageno: pageno,
        pagesize: 10,
      };

      // Add filters if provided
      if (filters.status) params.status = filters.status;

      console.log("📞 Fetching bulk call campaigns with params:", params);
      const response = await api.get("/user/calls/bulk_call", { params });

      console.log("📦 Bulk campaigns response:", response.data);

      if (response.data.success) {
        setCampaigns(response.data.data || []);
        setTotalPages(response.data.pagination?.pages || 1);
        console.log(
          "✅ Bulk campaigns fetched:",
          response.data.data?.length || 0
        );
      } else {
        console.error("❌ API returned success: false", response.data);
        setError(response.data.message || "Failed to fetch campaigns");
      }
    } catch (err) {
      console.error("❌ Error fetching campaigns:", err);
      console.error("❌ Error response:", err.response?.data);
      setError(
        err.response?.data?.message ||
          err.message ||
          "Failed to fetch campaigns"
      );
    } finally {
      setLoading(false);
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
      status: "",
    });
    setPageno(1);
  };

  // Format date
  const formatDate = (dateString) => {
    if (!dateString) return "";
    const date = new Date(dateString);
    return date.toLocaleDateString() + " " + date.toLocaleTimeString();
  };

  // Calculate progress percentage
  const calculateProgress = (campaign) => {
    if (!campaign.totalCalls || campaign.totalCalls === 0) return 0;
    return Math.round((campaign.completedCalls / campaign.totalCalls) * 100);
  };

  const getCampaignId = (campaign) =>
    campaign.omnidimensionId || campaign._id || campaign.id;

  const isCampaignActive = (status = "") => {
    const normalized = status.toLowerCase();
    return ["active", "in_progress", "running"].includes(normalized);
  };

const isCampaignCompleted = (status = "") =>
  status.toLowerCase() === "completed";

  const handlePauseResume = async (campaign) => {
    const campaignId = getCampaignId(campaign);
    if (!campaignId) return;

    if (isCampaignCompleted(campaign.status)) {
      return;
    }

    const active = isCampaignActive(campaign.status);
    const endpoint = active ? "pause" : "resume";
    const confirmMessage = active
      ? "Pause this campaign?"
      : "Resume this campaign?";

    if (!window.confirm(confirmMessage)) {
      return;
    }

    try {
      setActionLoadingId(campaignId);
      setActionLoadingType(endpoint);
      await api.put(`/user/calls/bulk_call/${campaignId}/${endpoint}`);
      await fetchCampaigns();
    } catch (err) {
      console.error(`Failed to ${endpoint} campaign`, err);
      alert(
        err.response?.data?.message ||
          `Failed to ${active ? "pause" : "resume"} campaign`
      );
    } finally {
      setActionLoadingId(null);
      setActionLoadingType("");
    }
  };

  const handleCancelCampaign = async (campaign) => {
    const campaignId = getCampaignId(campaign);
    if (!campaignId) return;

    if (
      !window.confirm(
        "Cancel this campaign permanently? This cannot be undone."
      )
    ) {
      return;
    }

    try {
      setActionLoadingId(campaignId);
      setActionLoadingType("cancel");
      await api.delete(`/user/calls/bulk_call/${campaignId}`);
      await fetchCampaigns();
    } catch (err) {
      console.error("Failed to cancel campaign", err);
      alert(err.response?.data?.message || "Failed to cancel campaign");
    } finally {
      setActionLoadingId(null);
      setActionLoadingType("");
    }
  };

  // Get status color
  const getStatusColor = (status) => {
    switch (status?.toLowerCase()) {
      case "completed":
        return "bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-300";
      case "active":
      case "in_progress":
        return "bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-300";
      case "paused":
        return "bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-300";
      case "cancelled":
      case "failed":
        return "bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-300";
      case "retry_scheduled":
        return "bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-300";
      case "pending":
        return "bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-300";
      default:
        return "bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300";
    }
  };

  return (
    <div className="min-h-screen overflow-x-hidden">
      {/* Header */}
      <div className="mb-4 sm:mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 mb-4">
          <div className="flex-1 min-w-0">
            <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-gray-900 dark:text-white">
              Bulk Calls
            </h1>
            <p className="text-xs sm:text-sm lg:text-base text-gray-600 dark:text-gray-400 mt-1">
              Manage and monitor your bulk call campaigns
            </p>
          </div>
          <div className="flex-shrink-0">
            <button
              onClick={() => setShowWizard(true)}
              className="w-full sm:w-auto inline-flex items-center justify-center px-3 sm:px-4 py-2 bg-cyan-600 hover:bg-cyan-700 text-white text-xs sm:text-sm font-medium rounded-lg transition-colors duration-200"
            >
              <svg
                className="w-3 h-3 sm:w-4 sm:h-4 mr-1 sm:mr-2"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 4v16m8-8H4"
                />
              </svg>
              Create New Campaign
            </button>
          </div>
        </div>
      </div>

      {/* Filter Card */}
      <div className="mb-4 sm:mb-6">
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3 sm:p-4">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 sm:gap-4 items-end">
            {/* Filter by Status */}
            <div>
              <label className="block text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Filter by Status
              </label>
              <select
                value={filters.status}
                onChange={(e) => handleFilterChange("status", e.target.value)}
                className="w-full px-3 py-2 text-xs sm:text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:border-cyan-500 text-gray-900 dark:text-white"
              >
                <option value="">All Statuses</option>
                <option value="active">Active</option>
                <option value="completed">Completed</option>
                <option value="paused">Paused</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>

            {/* Clear Filters Button */}
            <div>
              {filters.status && (
                <button
                  onClick={handleClearFilters}
                  className="w-full px-3 py-2 text-xs sm:text-sm bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-900 dark:text-white rounded-lg transition"
                >
                  Clear Filters
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="mb-4 p-3 sm:p-4 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 rounded-lg text-red-800 dark:text-red-300 text-xs sm:text-sm">
          {error}
        </div>
      )}

      {/* Campaigns Table */}
      {loading ? (
        <div className="flex justify-center items-center py-20">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-cyan-500"></div>
        </div>
      ) : campaigns.length === 0 ? (
        <div className="text-center py-12 sm:py-20 text-gray-600 dark:text-gray-400">
          <p className="text-lg sm:text-xl">No campaigns found</p>
          <p className="text-xs sm:text-sm mt-2">
            {filters.status
              ? "Try adjusting your filters"
              : "You have no bulk call campaigns yet"}
          </p>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <div className="inline-block min-w-full align-middle">
              <table
                className="w-full divide-y divide-gray-200 dark:divide-gray-700"
                style={{ minWidth: "900px" }}
              >
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                 
                    <th className="px-2 sm:px-3 lg:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider hidden lg:table-cell">
                      Created By
                    </th>
                    <th className="px-2 sm:px-3 lg:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Campaign
                    </th>
                    <th className="px-2 sm:px-3 lg:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-2 sm:px-3 lg:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Total
                    </th>
                    <th className="px-2 sm:px-3 lg:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Done
                    </th>
                    <th className="px-2 sm:px-3 lg:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Progress
                    </th>
                 
                    <th className="px-2 sm:px-3 lg:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider hidden lg:table-cell">
                      Created
                    </th>
                    <th className="px-2 sm:px-3 lg:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                  {campaigns.map((campaign) => (
                    <tr
                      key={campaign._id}
                      onClick={() =>
                        navigate(
                          `/user/bulk-calls/${
                            campaign.omnidimensionId || campaign._id
                          }`
                        )
                      }
                      className="hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer transition"
                    >
                      
           
                      <td className="px-2 sm:px-3 lg:px-6 py-3 sm:py-4 whitespace-nowrap text-xs sm:text-sm text-gray-900 dark:text-white hidden lg:table-cell">
                        {campaign.createdByName ||
                          campaign.createdBy ||
                          "N/A"}
                      </td>
                      <td className="px-2 sm:px-3 lg:px-6 py-3 sm:py-4 text-xs sm:text-sm text-gray-900 dark:text-white">
                        <div>
                          <div className="font-medium truncate max-w-[150px] sm:max-w-none">
                            {campaign.name || "Unnamed Campaign"}
                          </div>
                          {campaign.omnidimensionId && (
                            <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                              ID: {campaign.omnidimensionId}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-2 sm:px-3 lg:px-6 py-3 sm:py-4 whitespace-nowrap">
                        <span
                          className={`inline-block px-1.5 sm:px-2 py-0.5 sm:py-1 rounded text-xs font-medium ${getStatusColor(
                            campaign.status
                          )}`}
                        >
                          {campaign.status || "Unknown"}
                        </span>
                      </td>
                      <td className="px-2 sm:px-3 lg:px-6 py-3 sm:py-4 whitespace-nowrap text-xs sm:text-sm text-gray-900 dark:text-white">
                        {campaign.totalCalls || 0}
                      </td>
                      <td className="px-2 sm:px-3 lg:px-6 py-3 sm:py-4 whitespace-nowrap text-xs sm:text-sm text-gray-900 dark:text-white">
                        {campaign.completedCalls || 0}
                      </td>
                      <td className="px-2 sm:px-3 lg:px-6 py-3 sm:py-4 whitespace-nowrap text-xs sm:text-sm text-gray-900 dark:text-white">
                        <div className="flex items-center">
                          <div className="w-12 sm:w-16 lg:w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5 sm:h-2 mr-1 sm:mr-2">
                            <div
                              className="bg-cyan-600 h-1.5 sm:h-2 rounded-full"
                              style={{
                                width: `${calculateProgress(campaign)}%`,
                              }}
                            ></div>
                          </div>
                          <span className="text-xs whitespace-nowrap">
                            {calculateProgress(campaign)}%
                          </span>
                        </div>
                      </td>
                
                      <td className="px-2 sm:px-3 lg:px-6 py-3 sm:py-4 whitespace-nowrap text-xs sm:text-sm text-gray-600 dark:text-gray-400 hidden lg:table-cell">
                        <div className="truncate max-w-[120px] xl:max-w-none">
                          {formatDate(campaign.createdAt)}
                        </div>
                      </td>
                      <td
                        className="px-2 sm:px-3 lg:px-6 py-3 sm:py-4 whitespace-nowrap"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex flex-col sm:flex-row gap-2">
                          <button
                            onClick={() => handlePauseResume(campaign)}
                            disabled={
                              actionLoadingId === getCampaignId(campaign) ||
                              isCampaignCompleted(campaign.status)
                            }
                            className="inline-flex items-center justify-center px-2 sm:px-3 py-1 text-xs sm:text-sm rounded-lg border border-cyan-600 text-cyan-600 hover:bg-cyan-50 dark:hover:bg-cyan-900/30 disabled:opacity-60 disabled:cursor-not-allowed"
                          >
                            {actionLoadingId === getCampaignId(campaign) &&
                            actionLoadingType !== "cancel" ? (
                              <span className="animate-spin h-3 w-3 border-2 border-t-transparent border-cyan-600 rounded-full mr-2"></span>
                            ) : null}
                            {isCampaignActive(campaign.status)
                              ? "Pause"
                              : "Resume"}
                          </button>
                          <button
                            onClick={() => handleCancelCampaign(campaign)}
                            disabled={
                              actionLoadingId === getCampaignId(campaign) ||
                              isCampaignCompleted(campaign.status)
                            }
                            className="inline-flex items-center justify-center px-2 sm:px-3 py-1 text-xs sm:text-sm rounded-lg border border-red-600 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 disabled:opacity-60 disabled:cursor-not-allowed"
                          >
                            {actionLoadingId === getCampaignId(campaign) &&
                            actionLoadingType === "cancel" ? (
                              <span className="animate-spin h-3 w-3 border-2 border-t-transparent border-red-600 rounded-full mr-2"></span>
                            ) : null}
                            Cancel
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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

      {/* Campaign Creation Wizard */}
      {showWizard && (
        <CampaignWizard
          isOpen={showWizard}
          onClose={() => setShowWizard(false)}
          onSuccess={() => {
            setShowWizard(false);
            fetchCampaigns(); // Refresh campaigns list
          }}
        />
      )}
    </div>
  );
};

export default BulkCalls;
