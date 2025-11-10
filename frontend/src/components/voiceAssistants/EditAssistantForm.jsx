import React, { useState, useEffect } from 'react';
import api from '../../utils/api';

const EditAssistantForm = ({ assistant, onClose, onSuccess }) => {
  const [formData, setFormData] = useState(assistant);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [availableFiles, setAvailableFiles] = useState([]);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const useCases = [
    'Lead Generation',
    'Appointments',
    'Support',
    'Negotiation',
    'Collections'
  ];

  // Fetch available files on component mount
  useEffect(() => {
    const fetchFiles = async () => {
      try {
        const response = await api.get('/admin/files', {
          params: { limit: 100 } // Get all files
        });
        if (response.data.success) {
          setAvailableFiles(response.data.data);
          
          // Initialize selected files if assistant has knowledgeBaseFiles
          if (assistant.knowledgeBaseFiles) {
            setSelectedFiles(response.data.data.slice(0, assistant.knowledgeBaseFiles));
          }
        }
      } catch (err) {
        console.error('Error fetching files:', err);
      }
    };
    
    fetchFiles();
  }, [assistant.knowledgeBaseFiles]);

  // Update formData when selectedFiles changes
  useEffect(() => {
    setFormData(prev => ({
      ...prev,
      knowledgeBaseFiles: selectedFiles.length,
      knowledgeBaseFileIds: selectedFiles.map(f => f._id)
    }));
  }, [selectedFiles]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await api.put(`/admin/voice-assistants/${assistant._id}`, formData);

      if (response.data.success) {
        onSuccess(response.data.data);
      }
    } catch (err) {
      console.error('Error updating assistant:', err);
      setError(err.response?.data?.message || 'Failed to update assistant');
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          {/* Header */}
          <div className="flex justify-between items-center mb-6">
            <div>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Edit Voice AI Assistant</h2>
              <p className="text-gray-600 dark:text-gray-400 text-sm mt-1">
                Update the assistant configuration
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white text-2xl"
            >
              ×
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit}>
            {/* Name */}
            <div className="mb-4">
              <label className="block text-sm font-medium mb-2 text-gray-900 dark:text-white">Name</label>
              <input
                type="text"
                name="name"
                value={formData.name}
                onChange={handleChange}
                required
                className="w-full px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:border-cyan-500 text-gray-900 dark:text-white"
              />
            </div>

            {/* Description */}
            <div className="mb-4">
              <label className="block text-sm font-medium mb-2 text-gray-900 dark:text-white">Description</label>
              <textarea
                name="description"
                value={formData.description}
                onChange={handleChange}
                required
                rows="4"
                className="w-full px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:border-cyan-500 text-gray-900 dark:text-white"
              />
            </div>

            {/* Use Case Categories */}
            <div className="mb-4">
              <label className="block text-sm font-medium mb-2 text-gray-900 dark:text-white">Choose from Use Case Categories</label>
              <div className="flex flex-wrap gap-2">
                {useCases.map(useCase => (
                  <button
                    key={useCase}
                    type="button"
                    onClick={() => setFormData(prev => ({ ...prev, useCase }))}
                    className={`px-4 py-2 rounded-lg transition ${
                      formData.useCase === useCase
                        ? 'bg-cyan-600 text-white'
                        : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                    }`}
                  >
                    {useCase}
                  </button>
                ))}
              </div>
            </div>

            {/* Settings Grid */}
            <div className="grid grid-cols-2 gap-4 mb-4">
              {/* LLM */}
              <div>
                <label className="block text-sm font-medium mb-2 text-gray-900 dark:text-white">LLM</label>
                <input
                  type="text"
                  name="llm"
                  value={formData.llm}
                  onChange={handleChange}
                  disabled
                  className="w-full px-4 py-2 bg-gray-100 dark:bg-gray-700/60 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-500 dark:text-gray-400 cursor-not-allowed"
                />
              </div>

              {/* Voice */}
              <div>
                <label className="block text-sm font-medium mb-2 text-gray-900 dark:text-white">Voice</label>
                <input
                  type="text"
                  name="voice"
                  value={formData.voice}
                  onChange={handleChange}
                  disabled
                  className="w-full px-4 py-2 bg-gray-100 dark:bg-gray-700/60 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-500 dark:text-gray-400 cursor-not-allowed"
                />
              </div>

              {/* Knowledge Base Files */}
              <div className="col-span-2 relative">
                <label className="block text-sm font-medium mb-2 text-gray-900 dark:text-white">Knowledge Base Files</label>
                <button
                  type="button"
                  onClick={() => setDropdownOpen(!dropdownOpen)}
                  className="w-full px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:border-cyan-500 text-gray-900 dark:text-white flex items-center justify-between"
                >
                  <span>
                    {selectedFiles.length === 0 
                      ? 'Choose Knowledge Base Files' 
                      : `${selectedFiles.length} file${selectedFiles.length !== 1 ? 's' : ''} selected`}
                  </span>
                  <svg className={`w-5 h-5 transform transition ${dropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {dropdownOpen && (
                  <div className="absolute z-10 w-full mt-1 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                    {availableFiles.length === 0 ? (
                      <div className="px-4 py-2 text-gray-600 dark:text-gray-400 text-sm">No files uploaded yet</div>
                    ) : (
                      <div className="py-2">
                        {availableFiles.map(file => {
                          const isSelected = selectedFiles.find(f => f._id === file._id);
                          return (
                            <label key={file._id} className="flex items-center px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-600 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={!!isSelected}
                                onChange={() => {
                                  setSelectedFiles(prev => {
                                    if (isSelected) {
                                      return prev.filter(f => f._id !== file._id);
                                    } else {
                                      return [...prev, file];
                                    }
                                  });
                                }}
                                className="mr-3 w-4 h-4 text-cyan-600 rounded focus:ring-cyan-500"
                              />
                              <span className="text-gray-900 dark:text-white text-sm">{file.originalName}</span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Post Call */}
              <div className="col-span-2">
                <label className="block text-sm font-medium mb-2 text-gray-900 dark:text-white">Post-call</label>
                <input
                  type="text"
                  name="postCall"
                  value={formData.postCall}
                  onChange={handleChange}
                  disabled
                  className="w-full px-4 py-2 bg-gray-100 dark:bg-gray-700/60 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-500 dark:text-gray-400 cursor-not-allowed"
                />
              </div>
            </div>

            {/* Checkboxes */}
            <div className="flex gap-6 mb-4">
              <label className="flex items-center gap-2 cursor-pointer text-gray-900 dark:text-white">
                <input
                  type="checkbox"
                  name="webSearch"
                  checked={formData.webSearch}
                  onChange={handleChange}
                  className="w-4 h-4 text-cyan-600 rounded focus:ring-cyan-500"
                />
                <span>Web Search</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer text-gray-900 dark:text-white">
                <input
                  type="checkbox"
                  name="textBased"
                  checked={formData.textBased}
                  onChange={handleChange}
                  className="w-4 h-4 text-cyan-600 rounded focus:ring-cyan-500"
                />
                <span>Text Based</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer text-gray-900 dark:text-white">
                <input
                  type="checkbox"
                  name="outgoing"
                  checked={formData.outgoing}
                  onChange={handleChange}
                  className="w-4 h-4 text-cyan-600 rounded focus:ring-cyan-500"
                />
                <span>Outgoing</span>
              </label>
            </div>

            {/* Error Message */}
            {error && (
              <div className="mb-4 p-3 bg-red-100 dark:bg-red-900/30 border border-red-400 dark:border-red-700 rounded-lg text-sm text-red-800 dark:text-red-200">
                {error}
              </div>
            )}

            {/* Actions */}
            <div className="flex justify-end gap-3 mt-6">
              <button
                type="button"
                onClick={onClose}
                className="px-6 py-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 rounded-lg transition text-gray-900 dark:text-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="px-6 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg transition disabled:opacity-50"
              >
                {loading ? 'Updating...' : 'Update Assistant'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default EditAssistantForm;

