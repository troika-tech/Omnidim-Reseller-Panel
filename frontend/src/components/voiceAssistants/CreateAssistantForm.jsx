import React, { useState, useEffect } from 'react';
import api from '../../utils/api';

const CreateAssistantForm = ({ onClose, onSuccess, inline = false }) => {
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    useCase: 'Lead Generation',
    llm: 'azure-gpt-4o-mini',
    voice: 'google',
    knowledgeBaseFiles: 0,
    webSearch: false,
    postCall: 'None',
    integrations: [],
    tags: [],
    textBased: false,
    outgoing: true
  });

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
        }
      } catch (err) {
        console.error('Error fetching files:', err);
      }
    };
    
    fetchFiles();
  }, []);

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
      // Auto-generate name from description or use case if name is empty
      const name = formData.name || formData.description?.substring(0, 50).trim() || `${formData.useCase} Assistant`;

      // Ensure all required fields are present
      if (!name || !formData.description || !formData.useCase) {
        setError('Please provide a description and select a use case');
        setLoading(false);
        return;
      }

      // Clean up and prepare submit data - only send what backend expects
      const submitData = {
        name: name.trim(),
        description: formData.description.trim(),
        useCase: formData.useCase,
        llm: formData.llm || 'azure-gpt-4o-mini',
        voice: formData.voice || 'google',
        knowledgeBaseFiles: formData.knowledgeBaseFiles || selectedFiles.length || 0,
        webSearch: formData.webSearch || false,
        postCall: formData.postCall || 'None',
        integrations: formData.integrations || [],
        tags: formData.tags || [],
        textBased: formData.textBased || false,
        outgoing: formData.outgoing !== undefined ? formData.outgoing : true
      };

      console.log('📤 Submitting form data:', submitData);
      const response = await api.post('/admin/voice-assistants', submitData);

      if (response.data.success) {
        console.log('✅ Assistant created successfully:', response.data.data);
        // Reset form on success
        setFormData({
          name: '',
          description: '',
          useCase: 'Lead Generation',
          llm: 'azure-gpt-4o-mini',
          voice: 'google',
          knowledgeBaseFiles: 0,
          webSearch: false,
          postCall: 'None',
          integrations: [],
          tags: [],
          textBased: false,
          outgoing: true
        });
        setSelectedFiles([]);
        setError(null);
        onSuccess(response.data.data);
      }
    } catch (err) {
      console.error('❌ Error creating assistant:', err);
      console.error('Error response:', err.response?.data);
      setError(err.response?.data?.message || err.response?.data?.error || 'Failed to create assistant');
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

  const formContent = (
    <form onSubmit={handleSubmit}>
      {/* Description - Large Textarea */}
      <div className="mb-6">
        <textarea
          name="description"
          value={formData.description}
          onChange={handleChange}
          required
          rows="6"
          className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent text-gray-900 dark:text-white resize-none"
          placeholder="Describe your voice AI assistant's purpose, personality, and how it should handle calls."
        />
      </div>

      {/* Use Case Categories */}
      <div className="mb-6">
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">Choose from Use Case Categories:</p>
        <div className="flex flex-wrap gap-2">
          {useCases.map(useCase => (
            <button
              key={useCase}
              type="button"
              onClick={() => setFormData(prev => ({ ...prev, useCase }))}
              className={`px-4 py-2 rounded-lg text-sm transition ${
                formData.useCase === useCase
                  ? 'bg-cyan-600 dark:bg-cyan-500 text-white'
                  : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
              }`}
            >
              {useCase}
            </button>
          ))}
        </div>
      </div>


      {/* Error Message */}
      {error && (
        <div className="mb-4 p-3 bg-red-100 dark:bg-red-900/30 border border-red-400 dark:border-red-700 rounded-lg text-sm text-red-800 dark:text-red-200">
          {error}
        </div>
      )}

      {/* Actions */}
      <div className="flex justify-end gap-3">
        {!inline && (
          <button
            type="button"
            onClick={onClose}
            className="px-6 py-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 rounded-lg transition text-gray-900 dark:text-white"
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={loading}
          className="px-6 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg transition disabled:opacity-50"
        >
          {loading ? 'Creating...' : 'Create Voice AI Assistant'}
        </button>
      </div>
    </form>
  );

  if (inline) {
    return formContent;
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          {/* Header */}
          <div className="flex justify-between items-center mb-6">
            <div>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Create a new voice AI assistant</h2>
              <p className="text-gray-600 dark:text-gray-400 text-sm mt-1">
                Describe the type of voice AI assistant you want to create
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white text-2xl"
            >
              ×
            </button>
          </div>
          {formContent}
        </div>
      </div>
    </div>
  );
};

export default CreateAssistantForm;

