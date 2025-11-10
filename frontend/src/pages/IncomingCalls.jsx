import React, { useState, useEffect, useCallback, useRef } from 'react';
import api from '../utils/api';
import socket from '../utils/socket';
import AudioPlayer from '../components/AudioPlayer';
import { useToast } from '../contexts/ToastContext';

// Recording Player Component - handles authentication and blob URL creation
const RecordingPlayer = ({ callId, recordingUrl }) => {
  const [blobUrl, setBlobUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const audioRef = useRef(null);

  const loadRecording = async () => {
    if (!callId || !recordingUrl || blobUrl || loading) return;
    
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const url = `${api.defaults.baseURL}/v1/inbound/calls/recording/${callId}`;
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
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
        console.error('Failed to load recording:', response.status);
        return null;
      }
    } catch (err) {
      console.error('Error loading recording:', err);
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
      className="h-8 w-32 sm:w-40"
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
  const { showToast } = useToast();
  const [incomingCalls, setIncomingCalls] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pageno, setPageno] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [selectedCall, setSelectedCall] = useState(null);
  const [syncStatus, setSyncStatus] = useState(null);
  
  // Filter states - single time filter
  const [timeFilter, setTimeFilter] = useState('all'); // Options: 'all', '24hr', '7days', '28days'

  // Calculate date range based on time filter
  const getDateRange = (timeFilter) => {
    const now = new Date();
    let startDate = null;
    let endDate = now;

    switch (timeFilter) {
      case '24hr':
        startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
      case '7days':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '28days':
        startDate = new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000);
        break;
      case 'all':
      default:
        startDate = null;
        endDate = null;
        break;
    }

    return {
      start_date: startDate ? startDate.toISOString().split('T')[0] : null,
      end_date: endDate ? endDate.toISOString().split('T')[0] : null
    };
  };

  // Set up Socket.IO listeners for real-time updates
  useEffect(() => {
    console.log('🎧 Setting up Socket.IO listeners for incoming calls');
    
    socket.on('incoming_call_created', (newCall) => {
      console.log('📡 Received: incoming_call_created', newCall);
      setIncomingCalls(prev => {
        const exists = prev.find(c => c._id === newCall._id || c.exotelCallSid === newCall.exotelCallSid);
        if (exists) return prev;
        return [newCall, ...prev];
      });
    });

    socket.on('incoming_call_updated', (updatedCall) => {
      console.log('📡 Received: incoming_call_updated', updatedCall);
      setIncomingCalls(prev => prev.map(c => 
        c._id === updatedCall._id || c.exotelCallSid === updatedCall.exotelCallSid
          ? updatedCall
          : c
      ));
    });

    socket.on('incoming_call_deleted', ({ id }) => {
      console.log('📡 Received: incoming_call_deleted', id);
      setIncomingCalls(prev => prev.filter(c => c._id !== id));
      if (selectedCall && selectedCall._id === id) {
        setSelectedCall(null);
      }
    });

    return () => {
      socket.off('incoming_call_created');
      socket.off('incoming_call_updated');
      socket.off('incoming_call_deleted');
    };
  }, [selectedCall]);

  // Fetch incoming calls from API
  const fetchIncomingCalls = useCallback(async () => {
    try {
      setLoading(true);
      
      const params = {
        pageno: pageno,
        pagesize: 10
      };

      // Add time filter (convert to date range)
      const dateRange = getDateRange(timeFilter);
      if (dateRange.start_date) params.start_date = dateRange.start_date;
      if (dateRange.end_date) params.end_date = dateRange.end_date;

      const response = await api.get('/v1/inbound/calls', { params });

      if (response.data.success) {
        const calls = response.data.data;
        setIncomingCalls(calls);
        setTotalPages(response.data.pagination?.pages || 1);
        setSyncStatus(response.data.sync || null);
        
        // Don't preload recordings - load them on-demand when audio element is clicked
      }
    } catch (err) {
      console.error('Error fetching incoming calls:', err);
      setError(err.response?.data?.message || 'Failed to fetch incoming calls');
      setSyncStatus(null);
    } finally {
      setLoading(false);
    }
  }, [pageno, timeFilter]);

  // Fetch statistics
  const fetchStats = useCallback(async () => {
    try {
      const params = {};
      const dateRange = getDateRange(timeFilter);
      if (dateRange.start_date) params.start_date = dateRange.start_date;
      if (dateRange.end_date) params.end_date = dateRange.end_date;

      const response = await api.get('/v1/inbound/calls/stats', { params });

      if (response.data.success) {
        setStats(response.data.data);
      }
    } catch (err) {
      console.error('Error fetching stats:', err);
    }
  }, [timeFilter]);

  // Fetch incoming calls and stats on component mount / when dependencies change
  useEffect(() => {
    fetchIncomingCalls();
    fetchStats();
  }, [fetchIncomingCalls, fetchStats]);

  // Handle time filter change
  const handleTimeFilterChange = (value) => {
    setTimeFilter(value);
    setPageno(1); // Reset to first page when filter changes
  };

  // Sync incoming calls from Exotel
  const handleSyncFromExotel = useCallback(async (showAlert = false) => {
    try {
      setLoading(true);
      setError(null);
      
      console.log('🔄 Syncing incoming calls from Exotel...');
      
      const params = {};
      const dateRange = getDateRange(timeFilter);
      if (dateRange.start_date) params.start_date = dateRange.start_date;
      if (dateRange.end_date) params.end_date = dateRange.end_date;

      // Send empty object instead of null to avoid JSON parsing error
      // Increase timeout to 10 minutes for sync (can take a while with many calls)
      const response = await api.post('/v1/inbound/calls/sync', {}, { 
        params,
        timeout: 60 * 1000
      });
      
      console.log('✅ Sync response:', response.data);
      
      if (response.data.success) {
        const status = response.data.sync || null;
        setSyncStatus(status);
        const statusMessage = status?.inProgress
          ? 'Incoming call sync started…'
          : status?.lastResult
          ? `Last sync processed ${status.lastResult.synced || 0} calls`
          : 'Incoming call sync completed';
        if (showAlert) {
          showToast(statusMessage, 'success');
        } else {
          console.log(statusMessage);
        }
        // Refresh the calls list
        await fetchIncomingCalls();
        await fetchStats();
      } else {
        setError(response.data.message || 'Sync failed');
      }
    } catch (err) {
      console.error('❌ Error syncing from Exotel:', err);
      setError(err.response?.data?.message || 'Failed to sync from Exotel');
      // Only show alert if explicitly requested (manual sync)
      if (showAlert) {
        showToast('Failed to sync from Exotel: ' + (err.response?.data?.message || err.message), 'error');
      } else {
        console.error('Failed to sync from Exotel: ' + (err.response?.data?.message || err.message));
      }
    } finally {
      setLoading(false);
    }
  }, [timeFilter, showToast, fetchIncomingCalls, fetchStats]);

  // Keyboard shortcut: Ctrl+5 or Ctrl+R to manually sync
  useEffect(() => {
    const handleKeyPress = (event) => {
      // Ctrl+5 or Ctrl+R to sync
      if ((event.ctrlKey || event.metaKey) && (event.key === '5' || event.key === 'r')) {
        // Prevent default browser refresh if Ctrl+R
        if (event.key === 'r') {
          event.preventDefault();
        }
        handleSyncFromExotel(true); // true = show alert
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => {
      window.removeEventListener('keydown', handleKeyPress);
    };
  }, [handleSyncFromExotel]);

  // Format duration
  const formatDuration = (seconds) => {
    if (!seconds) return '00:00';
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Format date
  const formatDate = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
  };

  // Handle delete
  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this incoming call?')) {
      return;
    }

    try {
      await api.delete(`/v1/inbound/calls/${id}`);
      setIncomingCalls(prev => prev.filter(c => c._id !== id));
      if (selectedCall && selectedCall._id === id) {
        setSelectedCall(null);
      }
    } catch (err) {
      console.error('Error deleting incoming call:', err);
      showToast('Failed to delete incoming call', 'error');
    }
  };

  return (
    <div className="min-h-screen overflow-x-hidden">
      {/* Header */}
      <div className="mb-4 sm:mb-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-4">
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">Incoming Calls</h1>
            <p className="text-sm sm:text-base text-gray-600 dark:text-gray-400 mt-1">View and manage incoming calls from Exotel</p>
            {syncStatus && (
              <div className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 mt-2 space-y-1">
                <div>
                  {syncStatus.inProgress
                    ? 'Syncing latest incoming calls in background…'
                    : syncStatus.lastRunAt
                    ? `Last synced ${new Date(syncStatus.lastRunAt).toLocaleString()}`
                    : 'Sync status unavailable'}
                </div>
                {syncStatus.lastError && !syncStatus.inProgress && (
                  <div className="text-red-500 dark:text-red-400">
                    Sync error: {syncStatus.lastError}
                  </div>
                )}
              </div>
            )}
          </div>
          
          {/* Filter Card - Time Filter on Right Side */}
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3 sm:p-4 w-full sm:w-auto min-w-[200px]">
            <label className="block text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Start: Filter by Time
            </label>
            <select
              value={timeFilter}
              onChange={(e) => handleTimeFilterChange(e.target.value)}
              className="w-full px-3 py-2 text-xs sm:text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:border-cyan-500 text-gray-900 dark:text-white"
            >
              <option value="all">All</option>
              <option value="24hr">24hr</option>
              <option value="7days">7days</option>
              <option value="28days">28days</option>
            </select>
          </div>
        </div>
      </div>

      {/* Statistics Cards */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4 mb-4 sm:mb-6">
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3 sm:p-4">
            <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 mb-1">Total Calls</p>
            <p className="text-lg sm:text-2xl font-bold text-gray-900 dark:text-white">{stats.totalCalls}</p>
          </div>
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3 sm:p-4">
            <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 mb-1">Answered</p>
            <p className="text-lg sm:text-2xl font-bold text-gray-900 dark:text-white">{stats.answeredCalls}</p>
          </div>
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3 sm:p-4">
            <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 mb-1">Missed</p>
            <p className="text-lg sm:text-2xl font-bold text-gray-900 dark:text-white">{stats.missedCalls}</p>
          </div>
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3 sm:p-4">
            <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 mb-1">Total Duration</p>
            <p className="text-lg sm:text-2xl font-bold text-gray-900 dark:text-white">{formatDuration(stats.totalDuration)}</p>
          </div>
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3 sm:p-4">
            <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 mb-1">With Recordings</p>
            <p className="text-lg sm:text-2xl font-bold text-gray-900 dark:text-white">{stats.callsWithRecordings}</p>
          </div>
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="mb-4 p-4 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 rounded-lg text-red-800 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Incoming Calls Table */}
      {loading ? (
        <div className="flex justify-center items-center py-20">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-cyan-500"></div>
        </div>
      ) : incomingCalls.length === 0 ? (
        <div className="text-center py-20 text-gray-600 dark:text-gray-400">
          <p className="text-xl">No incoming calls found</p>
          <p className="text-sm mt-2">Try adjusting your time filter or wait for calls to be logged</p>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    From
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    To
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider hidden sm:table-cell">
                    Start Time
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider hidden md:table-cell">
                    Duration
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider hidden lg:table-cell">
                    CallSid
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Recording
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                {incomingCalls.map((call) => (
                  <tr
                    key={call._id}
                    className="hover:bg-gray-50 dark:hover:bg-gray-700 transition"
                  >
                    <td className="px-3 sm:px-6 py-4 whitespace-nowrap text-xs sm:text-sm text-cyan-600 dark:text-cyan-400">
                      {call.from || 'Unknown'}
                    </td>
                    <td className="px-3 sm:px-6 py-4 whitespace-nowrap text-xs sm:text-sm text-cyan-600 dark:text-cyan-400">
                      {call.to || 'Unknown'}
                    </td>
                    <td className="px-3 sm:px-6 py-4 whitespace-nowrap">
                      <span className={`inline-block px-2 py-1 rounded text-xs font-medium ${
                        call.status === 'completed' || call.status === 'answered' ? 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-300' :
                        call.status === 'failed' || call.status === 'no-answer' ? 'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-300' :
                        call.status === 'ringing' ? 'bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-300' :
                        call.status === 'busy' ? 'bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-300' :
                        'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300'
                      }`}>
                        {call.status || 'ringing'}
                      </span>
                    </td>
                    <td className="px-3 sm:px-6 py-4 whitespace-nowrap text-xs sm:text-sm text-gray-600 dark:text-gray-400 hidden sm:table-cell">
                      {formatDate(call.startTime)}
                    </td>
                    <td className="px-3 sm:px-6 py-4 whitespace-nowrap text-xs sm:text-sm text-gray-900 dark:text-white hidden md:table-cell">
                      {formatDuration(call.duration)}
                    </td>
                    <td className="px-3 sm:px-6 py-4 whitespace-nowrap text-xs sm:text-sm text-gray-600 dark:text-gray-400 hidden lg:table-cell">
                      {call.exotelCallSid || 'N/A'}
                    </td>
                    <td className="px-3 sm:px-6 py-4 whitespace-nowrap text-xs sm:text-sm">
                      {call.recordingUrl ? (
                        <div className="flex items-center gap-2">
                          <RecordingPlayer callId={call._id} recordingUrl={call.recordingUrl} />
                          <button
                            onClick={async () => {
                              try {
                                const token = localStorage.getItem('token');
                                const downloadUrl = `${api.defaults.baseURL}/v1/inbound/calls/recording/${call._id}/download`;
                                const response = await fetch(downloadUrl, {
                                  headers: {
                                    'Authorization': `Bearer ${token}`
                                  }
                                });
                                if (response.ok) {
                                  const blob = await response.blob();
                                  const url = window.URL.createObjectURL(blob);
                                  const link = document.createElement('a');
                                  link.href = url;
                                  link.download = `recording-${call.from || 'unknown'}-${call.to || 'unknown'}.mp3`;
                                  document.body.appendChild(link);
                                  link.click();
                                  document.body.removeChild(link);
                                  window.URL.revokeObjectURL(url);
                                } else {
                                  showToast('Failed to download recording', 'error');
                                }
                              } catch (err) {
                                console.error('Download error:', err);
                                showToast('Failed to download recording', 'error');
                              }
                            }}
                            className="px-2 py-1 text-xs bg-cyan-600 hover:bg-cyan-700 text-white rounded transition"
                            title="Download as MP3"
                          >
                            ⬇️
                          </button>
                        </div>
                      ) : (
                        <span className="text-red-700 dark:text-red-500 text-xs sm:text-sm font-medium">missedcall</span>
                      )}
                    </td>
                    <td className="px-3 sm:px-6 py-4 whitespace-nowrap text-xs sm:text-sm">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setSelectedCall(call)}
                          className="text-cyan-600 dark:text-cyan-400 hover:text-cyan-700 dark:hover:text-cyan-300"
                        >
                          View
                        </button>
                        <button
                          onClick={() => handleDelete(call._id)}
                          className="text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Call Details Modal */}
      {selectedCall && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50 overflow-y-auto" onClick={() => setSelectedCall(null)}>
          <div className="bg-white dark:bg-gray-800 rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto my-4" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 sm:p-6">
              {/* Header */}
              <div className="flex justify-between items-center mb-4 sm:mb-6">
                <h2 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white">Incoming Call Details</h2>
                <button
                  onClick={() => setSelectedCall(null)}
                  className="text-gray-400 hover:text-white text-2xl flex-shrink-0"
                >
                  ×
                </button>
              </div>

              {/* Details */}
              <div className="space-y-3 sm:space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">From</label>
                    <p className="text-gray-900 dark:text-white">{selectedCall.from || 'Unknown'}</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">To</label>
                    <p className="text-cyan-600 dark:text-cyan-400">{selectedCall.to || 'Unknown'}</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">CallSid</label>
                    <p className="text-gray-900 dark:text-white font-mono text-xs">{selectedCall.exotelCallSid || 'N/A'}</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">Status</label>
                    <span className={`inline-block px-2 py-1 rounded text-xs font-medium ${
                      selectedCall.status === 'completed' || selectedCall.status === 'answered' ? 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-300' :
                      selectedCall.status === 'failed' || selectedCall.status === 'no-answer' ? 'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-300' :
                      selectedCall.status === 'ringing' ? 'bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-300' :
                      'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300'
                    }`}>
                      {selectedCall.status || 'ringing'}
                    </span>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">Start Time</label>
                    <p className="text-gray-900 dark:text-white text-sm">{formatDate(selectedCall.startTime)}</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">End Time</label>
                    <p className="text-gray-900 dark:text-white text-sm">{selectedCall.endTime ? formatDate(selectedCall.endTime) : 'N/A'}</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">Duration</label>
                    <p className="text-gray-900 dark:text-white">{formatDuration(selectedCall.duration)}</p>
                  </div>
                </div>

                {/* Recording */}
                {selectedCall.recordingUrl && (
                  <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
                    <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">Recording</label>
                    <AudioPlayer src={selectedCall.recordingUrl} />
                  </div>
                )}
              </div>

              {/* Close Button */}
              <div className="flex justify-end mt-4 sm:mt-6 pt-4 sm:pt-6 border-t border-gray-200 dark:border-gray-700">
                <button
                  onClick={() => setSelectedCall(null)}
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
    </div>
  );
};

export default IncomingCalls;

