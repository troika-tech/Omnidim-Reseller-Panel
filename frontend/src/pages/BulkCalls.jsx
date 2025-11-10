import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../utils/api';
import socket from '../utils/socket';

const BulkCalls = () => {
  const navigate = useNavigate();
  const [bulkCalls, setBulkCalls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pageno, setPageno] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCalls, setTotalCalls] = useState(0);
  const [actionLoadingId, setActionLoadingId] = useState(null);
  const [actionType, setActionType] = useState('');
  
  // Filter state - only status filter
  const [statusFilter, setStatusFilter] = useState('');

  // Fetch bulk calls on component mount and filter change
  useEffect(() => {
    fetchBulkCalls();
  }, [pageno, statusFilter]);

  // Set up Socket.IO listeners for real-time updates
  useEffect(() => {
    socket.on('bulk_call_created', (newBulkCall) => {
      console.log('📡 Received: bulk_call_created', newBulkCall);
      setBulkCalls(prev => {
        const exists = prev.find(bc => bc._id === newBulkCall._id || bc.omnidimensionId === newBulkCall.omnidimensionId);
        if (exists) return prev;
        return [newBulkCall, ...prev];
      });
    });

    socket.on('bulk_call_updated', (updatedBulkCall) => {
      console.log('📡 Received: bulk_call_updated', updatedBulkCall);
      setBulkCalls(prev => prev.map(bc => 
        bc._id === updatedBulkCall._id || bc.omnidimensionId === updatedBulkCall.omnidimensionId
          ? updatedBulkCall
          : bc
      ));
    });

    return () => {
      socket.off('bulk_call_created');
      socket.off('bulk_call_updated');
    };
  }, []);

  // Fetch bulk calls from API
  const fetchBulkCalls = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const params = {
        pageno: pageno,
        pagesize: 10
      };

      // Add status filter if provided
      if (statusFilter) {
        params.status = statusFilter;
      }

      const response = await api.get('/v1/calls/bulk_call', { params });

      if (response.data.success) {
        setBulkCalls(response.data.data || []);
        setTotalPages(response.data.pagination?.pages || 1);
        setTotalCalls(response.data.pagination?.total || 0);
      }
    } catch (err) {
      console.error('Error fetching bulk calls:', err);
      setError(err.response?.data?.message || 'Failed to fetch bulk call campaigns');
    } finally {
      setLoading(false);
    }
  };

  // Handle filter change
  const handleFilterChange = (value) => {
    setStatusFilter(value);
    setPageno(1); // Reset to first page when filter changes
  };

  // Get status badge class
  const getStatusBadgeClass = (status) => {
    switch (status) {
      case 'completed':
        return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300';
      case 'in_progress':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300';
      case 'pending':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300';
      case 'failed':
        return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300';
      case 'cancelled':
        return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300';
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300';
    }
  };

  // Format date
  const formatDate = (date) => {
    if (!date) return 'N/A';
    return new Date(date).toLocaleString();
  };

  const getCampaignId = (campaign) =>
    campaign.omnidimensionId || campaign._id || campaign.id;

  const isCampaignActive = (status = '') => {
    const normalized = status.toLowerCase();
    return ['active', 'in_progress', 'running'].includes(normalized);
  };

  const isCampaignCompleted = (status = '') =>
    status.toLowerCase() === 'completed';

  const handlePauseResume = async (campaign) => {
    const campaignId = getCampaignId(campaign);
    if (!campaignId) return;

    if (isCampaignCompleted(campaign.status)) {
      return;
    }

    const active = isCampaignActive(campaign.status);
    const action = active ? 'pause' : 'resume';
    const confirmMessage = active
      ? 'Pause this campaign?'
      : 'Resume this campaign?';

    if (!window.confirm(confirmMessage)) {
      return;
    }

    try {
      setActionLoadingId(campaignId);
      setActionType(action);
      await api.put(`/v1/calls/bulk_call/${campaignId}`, { action });
      fetchBulkCalls();
    } catch (err) {
      console.error(`Failed to ${action} campaign`, err);
      alert(
        err.response?.data?.message ||
          `Failed to ${active ? 'pause' : 'resume'} campaign`
      );
    } finally {
      setActionLoadingId(null);
      setActionType('');
    }
  };

  const handleCancelCampaign = async (campaign) => {
    const campaignId = getCampaignId(campaign);
    if (!campaignId) return;

    if (
      !window.confirm(
        'Cancel this campaign permanently? This cannot be undone.'
      )
    ) {
      return;
    }

    try {
      setActionLoadingId(campaignId);
      setActionType('cancel');
      await api.delete(`/v1/calls/bulk_call/${campaignId}`);
      fetchBulkCalls();
    } catch (err) {
      console.error('Failed to cancel campaign', err);
      alert(err.response?.data?.message || 'Failed to cancel campaign');
    } finally {
      setActionLoadingId(null);
      setActionType('');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white overflow-x-hidden">
      {/* Header */}
    

      {/* Filter Card - Status Filter */}
      <div className="mb-4 sm:mb-6 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3 sm:p-4">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">Bulk Call Campaigns</h1>
            <p className="text-sm sm:text-base text-gray-600 dark:text-gray-400 mt-1">
              Manage and monitor your bulk call campaigns.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <label className="text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap">
              Filter by Status:
            </label>
            <select
              value={statusFilter}
              onChange={(e) => handleFilterChange(e.target.value)}
              className="px-3 sm:px-4 py-2 text-xs sm:text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:border-cyan-500 text-gray-900 dark:text-white"
            >
              <option value="">All Statuses</option>
              <option value="completed">Completed</option>
              <option value="in_progress">In Progress</option>
              <option value="pending">Pending</option>
              <option value="failed">Failed</option>
              <option value="cancelled">Cancelled</option>
            </select>
            {statusFilter && (
              <button
                onClick={() => handleFilterChange('')}
                className="px-3 py-1 text-xs sm:text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white whitespace-nowrap"
              >
                Clear Filter
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="mb-4 p-4 bg-red-100 dark:bg-red-900/30 border border-red-400 dark:border-red-700 rounded-lg text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Loading State */}
      {loading ? (
        <div className="flex justify-center items-center py-20">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-cyan-500"></div>
        </div>
      ) : bulkCalls.length === 0 ? (
        <div className="text-center py-20 text-gray-600 dark:text-gray-400">
          <p className="text-xl">No bulk call campaigns found</p>
        </div>
      ) : (
        <>
          {/* Campaigns Table */}
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden shadow-md">
            <div className="overflow-x-auto -mx-4 sm:mx-0">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
       
                    <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Created By
                    </th>
                    <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Campaign Name
                    </th>
                    <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider hidden md:table-cell">
                      Bot
                    </th>
                    <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider hidden sm:table-cell">
                      From Number
                    </th>
              
                    <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Progress
                    </th>
                    <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider hidden lg:table-cell">
                      Concurrent Calls
                    </th>
                    <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider hidden lg:table-cell">
                      Created Date
                    </th>
                    <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                  {bulkCalls.map((campaign) => (

                    <tr
                      key={campaign._id}
                      onClick={() => navigate(`/bulk-call/${campaign.omnidimensionId || campaign._id}`)}
                      className="hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer transition duration-150 ease-in-out"
                    >
               
                                   <td className="px-3 sm:px-6 py-4 whitespace-nowrap text-xs sm:text-sm text-gray-900 dark:text-white hidden md:table-cell">
                        {campaign.createdByName || "N/A"}
                      </td>
                      <td className="px-3 sm:px-6 py-4 text-xs sm:text-sm font-medium text-gray-900 dark:text-white">
                        <div className="truncate max-w-[150px] sm:max-w-none">{campaign.name}</div>
                      </td>
                      <td className="px-3 sm:px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex px-2 py-1 text-xs font-semibold leading-5 rounded-full ${getStatusBadgeClass(campaign.status)}`}>
                          {campaign.status}
                        </span>
                      </td>
                      <td className="px-3 sm:px-6 py-4 whitespace-nowrap text-xs sm:text-sm text-gray-900 dark:text-white hidden md:table-cell">
                        <div className="truncate max-w-[100px]">{campaign.bot?.name || campaign.botName || 'N/A'}</div>
                      </td>
                      <td className="px-3 sm:px-6 py-4 whitespace-nowrap text-xs sm:text-sm text-cyan-600 dark:text-cyan-400 hidden sm:table-cell">
                        {campaign.fromNumber}
                      </td>
         
                      <td className="px-3 sm:px-6 py-4">
                        <div className="text-xs sm:text-sm">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-gray-900 dark:text-white">
                              {campaign.progress?.completed || campaign.completedCalls || 0}/{campaign.progress?.total || campaign.totalCalls || 0}
                            </span>
                          </div>
                          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                            <div
                              className="bg-cyan-600 h-2 rounded-full transition-all duration-300"
                              style={{
                                width: `${campaign.progress?.percentage || ((campaign.completedCalls || 0) / (campaign.totalCalls || 1)) * 100}%`
                              }}
                            ></div>
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 hidden lg:block">
                            Not Reachable: {campaign.notReachableCalls || 0}, Pending: {campaign.pendingCalls || 0}, Transfers: {campaign.transferCalls || 0}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 sm:px-6 py-4 whitespace-nowrap text-xs sm:text-sm text-gray-900 dark:text-white hidden lg:table-cell">
                        {campaign.concurrentCalls || 1}
                      </td>
                      <td className="px-3 sm:px-6 py-4 whitespace-nowrap text-xs sm:text-sm text-gray-500 dark:text-gray-400 hidden lg:table-cell">
                        {formatDate(campaign.createdAt)}
                      </td>
                      <td
                        className="px-3 sm:px-6 py-4 whitespace-nowrap text-xs sm:text-sm"
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
                            actionType !== 'cancel' ? (
                              <span className="animate-spin h-3 w-3 border-2 border-t-transparent border-cyan-600 rounded-full mr-2"></span>
                            ) : null}
                            {isCampaignActive(campaign.status)
                              ? 'Pause'
                              : 'Resume'}
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
                            actionType === 'cancel' ? (
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

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4 mt-4 sm:mt-6 px-4 sm:px-6">
              <div className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 text-center sm:text-left">
                <div className="sm:hidden">Page {pageno} of {totalPages}</div>
                <div className="hidden sm:block">Page {pageno} of {totalPages} (Total: {totalCalls} campaigns)</div>
              </div>
              <div className="flex items-center gap-3 sm:gap-4">
                <button
                  onClick={() => setPageno(p => Math.max(1, p - 1))}
                  disabled={pageno === 1}
                  className="flex-1 sm:flex-none px-4 py-2 text-xs sm:text-sm bg-gray-200 dark:bg-gray-800 hover:bg-gray-300 dark:hover:bg-gray-700 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed text-gray-900 dark:text-white"
                >
                  Previous
                </button>
                <button
                  onClick={() => setPageno(p => Math.min(totalPages, p + 1))}
                  disabled={pageno === totalPages}
                  className="flex-1 sm:flex-none px-4 py-2 text-xs sm:text-sm bg-gray-200 dark:bg-gray-800 hover:bg-gray-300 dark:hover:bg-gray-700 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed text-gray-900 dark:text-white"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default BulkCalls;

