import React, { useState, useEffect } from 'react';
import api from '../utils/api';
import socket from '../utils/socket';
import { useToast } from '../contexts/ToastContext';
import CreateAssistantForm from '../components/voiceAssistants/CreateAssistantForm';
import EditAssistantForm from '../components/voiceAssistants/EditAssistantForm';
import AssistantCard from '../components/voiceAssistants/AssistantCard';

const VoiceAssistants = () => {
  const [assistants, setAssistants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingAssistant, setEditingAssistant] = useState(null);
  const { showToast, showConfirm } = useToast();

  // Fetch assistants on component mount
  useEffect(() => {
    fetchAssistants();
  }, [page, searchQuery]);

  // Set up Socket.IO listeners for real-time updates
  useEffect(() => {
    console.log('🎧 Setting up Socket.IO listeners');

    socket.on('voice_assistant_created', (newAssistant) => {
      console.log('📡 Received: voice_assistant_created', newAssistant);
      setAssistants(prev => [newAssistant, ...prev]);
    });

    socket.on('voice_assistant_updated', (updatedAssistant) => {
      console.log('📡 Received: voice_assistant_updated', updatedAssistant);
      setAssistants(prev => prev.map(assistant =>
        assistant._id === updatedAssistant._id ? updatedAssistant : assistant
      ));
    });

    socket.on('voice_assistant_deleted', ({ id }) => {
      console.log('📡 Received: voice_assistant_deleted', id);
      setAssistants(prev => prev.filter(assistant => assistant._id !== id));
    });

    // Cleanup on unmount
    return () => {
      socket.off('voice_assistant_created');
      socket.off('voice_assistant_updated');
      socket.off('voice_assistant_deleted');
    };
  }, []);

  // Fetch assistants from API
  const fetchAssistants = async () => {
    try {
      setLoading(true);
      
      const response = await api.get('/admin/voice-assistants', {
        params: {
          page,
          search: searchQuery
        }
      });

      if (response.data.success) {
        setAssistants(response.data.data);
        setTotalPages(response.data.pagination.pages);
      }
    } catch (err) {
      console.error('Error fetching assistants:', err);
      setError(err.response?.data?.message || 'Failed to fetch assistants');
    } finally {
      setLoading(false);
    }
  };

  // Handle create
  const handleCreate = (newAssistant) => {
    // UI update handled by Socket.IO
    setShowCreateForm(false);
  };

  // Handle update
  const handleUpdate = (updatedAssistant) => {
    // UI update handled by Socket.IO
    setEditingAssistant(null);
  };

  // Handle delete
  const handleDelete = async (id) => {
    showConfirm(
      'Are you sure you want to delete this assistant?',
      async () => {
        try {
          await api.delete(`/admin/voice-assistants/${id}`);
          // UI update handled by Socket.IO
          showToast('Assistant deleted successfully!', 'success');
        } catch (err) {
          console.error('Error deleting assistant:', err);
          showToast(err.response?.data?.message || 'Failed to delete assistant', 'error');
        }
      },
      () => {
        // User clicked No, do nothing
      }
    );
  };

  // Copy ID to clipboard
  const copyId = (id) => {
    navigator.clipboard.writeText(id);
    showToast('ID copied to clipboard!', 'success');
  };

  return (
    <div className="min-h-screen overflow-x-hidden bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <div className="mb-6">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">Voice AI Assistants</h1>
          <p className="text-gray-600 dark:text-gray-400">Create and manage your voice AI assistants</p>
        </div>

        {/* Create Assistant Section - Inline with Teal Border */}
        <div className="mb-8 p-6 bg-white dark:bg-gray-800 border-2 border-cyan-500 dark:border-cyan-400 rounded-lg shadow-lg">
          <h2 className="text-xl font-semibold text-cyan-600 dark:text-cyan-400 mb-2">Create a new voice AI assistant</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">Describe the type of voice AI assistant you want to create</p>
          
          <CreateAssistantForm
            inline={true}
            onClose={() => setShowCreateForm(false)}
            onSuccess={handleCreate}
          />
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="mb-4 p-4 bg-red-900/30 border border-red-700 rounded-lg text-white">
          {error}
        </div>
      )}

      {/* Edit Form Modal */}
      {editingAssistant && (
        <EditAssistantForm
          assistant={editingAssistant}
          onClose={() => setEditingAssistant(null)}
          onSuccess={handleUpdate}
        />
      )}

      {/* My Voice AI Assistants Section */}
      <div className="mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4 gap-4">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">My Voice AI Assistants</h2>
          <div className="flex-1 max-w-md">
            <div className="relative">
              <svg className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                placeholder="Search assistants..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setPage(1);
                }}
                className="w-full pl-10 pr-4 py-2 text-sm bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:border-cyan-500 text-gray-900 dark:text-white"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Assistants List */}
      {loading ? (
        <div className="flex justify-center items-center py-20">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-cyan-500"></div>
        </div>
      ) : assistants.length === 0 ? (
        <div className="text-center py-20 text-gray-600 dark:text-gray-400">
          <p className="text-xl">No voice assistants found</p>
          <p className="text-sm mt-2">Create your first assistant to get started</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {assistants.map(assistant => (
            <AssistantCard
              key={assistant._id}
              assistant={assistant}
              onEdit={setEditingAssistant}
              onDelete={handleDelete}
              onCopyId={copyId}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex flex-col sm:flex-row justify-center items-center gap-3 sm:gap-4 mt-4 sm:mt-6">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="w-full sm:w-auto px-4 py-2 text-sm sm:text-base bg-gray-200 dark:bg-gray-800 hover:bg-gray-300 dark:hover:bg-gray-700 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed text-gray-900 dark:text-white"
          >
            Previous
          </button>
          <span className="text-sm sm:text-base text-gray-600 dark:text-gray-400">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="w-full sm:w-auto px-4 py-2 text-sm sm:text-base bg-gray-200 dark:bg-gray-800 hover:bg-gray-300 dark:hover:bg-gray-700 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed text-gray-900 dark:text-white"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
};

export default VoiceAssistants;

