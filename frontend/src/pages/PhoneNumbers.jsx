import React, { useState, useEffect } from 'react';
import api from '../utils/api';
import socket from '../utils/socket';
import { useToast } from '../contexts/ToastContext';

const PhoneNumbers = () => {
  const [phoneNumbers, setPhoneNumbers] = useState([]);
  const [selectedPhoneNumber, setSelectedPhoneNumber] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageno, setPageno] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importProvider, setImportProvider] = useState('EXOTEL'); // 'TWILIO' or 'EXOTEL'
  const { showToast, showConfirm } = useToast();

  // Fetch phone numbers on component mount
  useEffect(() => {
    fetchPhoneNumbers();
  }, [pageno, searchQuery]);

  // Set up Socket.IO listeners for real-time updates
  useEffect(() => {
    console.log('🎧 Setting up Socket.IO listeners for phone numbers');
    
    socket.on('phone_number_created', (newPhoneNumber) => {
      console.log('📡 Received: phone_number_created', newPhoneNumber);
      setPhoneNumbers(prev => {
        // Check if phone number already exists (avoid duplicates)
        const exists = prev.find(pn => pn._id === newPhoneNumber._id || pn.omnidimensionId === newPhoneNumber.omnidimensionId);
        if (exists) return prev;
        return [newPhoneNumber, ...prev];
      });
    });

    socket.on('phone_number_updated', (updatedPhoneNumber) => {
      console.log('📡 Received: phone_number_updated', updatedPhoneNumber);
      setPhoneNumbers(prev => prev.map(pn => 
        pn._id === updatedPhoneNumber._id || pn.omnidimensionId === updatedPhoneNumber.omnidimensionId
          ? updatedPhoneNumber
          : pn
      ));
      // Update selected phone number if it's the one that was updated
      if (selectedPhoneNumber && (selectedPhoneNumber._id === updatedPhoneNumber._id || selectedPhoneNumber.omnidimensionId === updatedPhoneNumber.omnidimensionId)) {
        setSelectedPhoneNumber(updatedPhoneNumber);
      }
    });

    socket.on('phone_number_deleted', ({ id, omnidimensionId }) => {
      console.log('📡 Received: phone_number_deleted', id, omnidimensionId);
      setPhoneNumbers(prev => prev.filter(pn => pn._id !== id && pn.omnidimensionId !== id && pn.omnidimensionId !== omnidimensionId));
      if (selectedPhoneNumber && (selectedPhoneNumber._id === id || selectedPhoneNumber.omnidimensionId === id || selectedPhoneNumber.omnidimensionId === omnidimensionId)) {
        setSelectedPhoneNumber(null);
      }
    });

    return () => {
      socket.off('phone_number_created');
      socket.off('phone_number_updated');
      socket.off('phone_number_deleted');
    };
  }, [selectedPhoneNumber]);

  // Fetch phone numbers from API (using OMNIDIMENSION format)
  const fetchPhoneNumbers = async () => {
    try {
      setLoading(true);
      
      const response = await api.get('/v1/phone_number/list', {
        params: {
          pageno: pageno,
          pagesize: 10
        }
      });

      if (response.data.success) {
        setPhoneNumbers(response.data.data);
        setTotalPages(response.data.pagination?.pages || 1);
      }
    } catch (err) {
      console.error('Error fetching phone numbers:', err);
      setError(err.response?.data?.message || 'Failed to fetch phone numbers');
    } finally {
      setLoading(false);
    }
  };

  // Handle import from Twilio
  const handleImportTwilio = async (formData) => {
    try {
      const response = await api.post('/v1/phone_number/import/twilio', {
        phone_number: formData.phone_number,
        account_sid: formData.account_sid,
        account_token: formData.account_token,
        name: formData.name || formData.phone_number
      });

      if (response.data.success) {
        await fetchPhoneNumbers(); // Refresh the list
        setShowImportModal(false);
        showToast('Phone number imported successfully!', 'success');
      }
    } catch (err) {
      console.error('Error importing Twilio phone number:', err);
      throw new Error(err.response?.data?.message || 'Failed to import phone number');
    }
  };

  // Handle import from Exotel
  const handleImportExotel = async (formData) => {
    try {
      const response = await api.post('/v1/phone_number/import/exotel', {
        exotel_phone_number: formData.exotel_phone_number,
        exotel_api_key: formData.exotel_api_key,
        exotel_api_token: formData.exotel_api_token,
        exotel_subdomain: formData.exotel_subdomain,
        exotel_account_sid: formData.exotel_account_sid,
        exotel_app_id: formData.exotel_app_id,
        name: formData.name || formData.exotel_phone_number
      });

      if (response.data.success) {
        await fetchPhoneNumbers(); // Refresh the list
        setShowImportModal(false);
        showToast('Phone number imported successfully!', 'success');
      }
    } catch (err) {
      console.error('Error importing Exotel phone number:', err);
      throw new Error(err.response?.data?.message || 'Failed to import phone number');
    }
  };

  // Handle attach agent
  const handleAttachAgent = async (phoneNumberId, agent) => {
    try {
      // Find the phone number to get omnidimensionId
      const phoneNumber = phoneNumbers.find(pn => pn._id === phoneNumberId || pn.omnidimensionId === phoneNumberId);
      
      if (!phoneNumber) {
        throw new Error('Phone number not found');
      }

      // Use omnidimensionId if available, otherwise use _id
      const phoneOmniId = phoneNumber.omnidimensionId || phoneNumber._id;
      
      // Use agent's omnidimensionId if available (as number), otherwise use _id (as string/MongoDB ObjectId)
      let agentIdToSend;
      if (agent.omnidimensionId) {
        // Convert OMNIDIMENSION ID to number
        agentIdToSend = parseInt(agent.omnidimensionId, 10);
        if (isNaN(agentIdToSend)) {
          agentIdToSend = agent.omnidimensionId; // Keep as string if not a number
        }
      } else {
        // Use MongoDB _id as string
        agentIdToSend = agent._id || agent;
      }
      
      await api.post('/v1/phone_number/attach', {
        phone_number_id: parseInt(phoneOmniId, 10),
        agent_id: agentIdToSend
      });

      await fetchPhoneNumbers(); // Refresh the list
      showToast('Agent attached successfully!', 'success');
    } catch (err) {
      console.error('Error attaching agent:', err);
      showToast(err.response?.data?.message || err.message || 'Failed to attach agent', 'error');
    }
  };

  // Handle detach agent
  const handleDetachAgent = async (phoneNumberId) => {
    showConfirm(
      'Are you sure you want to detach the agent from this phone number?',
      async () => {
        try {
          // Find the phone number to get omnidimensionId
          const phoneNumber = phoneNumbers.find(pn => pn._id === phoneNumberId || pn.omnidimensionId === phoneNumberId);
          
          if (!phoneNumber) {
            throw new Error('Phone number not found');
          }

          // Use omnidimensionId if available, otherwise use _id
          const phoneOmniId = phoneNumber.omnidimensionId || phoneNumber._id;
          
          await api.post('/v1/phone_number/detach', {
            phone_number_id: parseInt(phoneOmniId, 10)
          });

          await fetchPhoneNumbers(); // Refresh the list
          showToast('Agent detached successfully!', 'success');
        } catch (err) {
          console.error('Error detaching agent:', err);
          showToast(err.response?.data?.message || err.message || 'Failed to detach agent', 'error');
        }
      },
      () => {
        // User clicked No, do nothing
      }
    );
  };

  // Handle delete
  const handleDelete = async (phoneNumberId) => {
    showConfirm(
      'Are you sure you want to delete this phone number?',
      async () => {
        try {
          // Find the phone number to get the ID
          const phoneNumber = phoneNumbers.find(pn => pn._id === phoneNumberId || pn.omnidimensionId === phoneNumberId);
          if (!phoneNumber) {
            throw new Error('Phone number not found');
          }

          // Call the delete endpoint - use _id or omnidimensionId
          // The backend will handle both
          const idToDelete = phoneNumber._id || phoneNumber.omnidimensionId || phoneNumberId;
          
          await api.delete(`/v1/phone_number/${idToDelete}`);

          // Remove from local state (Socket.IO will also handle this via broadcast)
          setPhoneNumbers(prev => prev.filter(pn => pn._id !== phoneNumberId && pn.omnidimensionId !== phoneNumberId));
          showToast('Phone number deleted successfully!', 'success');
        } catch (err) {
          console.error('Error deleting phone number:', err);
          showToast(err.response?.data?.message || err.message || 'Failed to delete phone number', 'error');
        }
      },
      () => {
        // User clicked No, do nothing
      }
    );
  };

  const getProviderIcon = (provider) => {
    switch (provider) {
      case 'TWILIO':
        return '📞';
      case 'EXOTEL':
        return '🇮🇳';
      default:
        return '📱';
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white overflow-x-hidden">
      {/* Header */}
      <div className="mb-4 sm:mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4 gap-3 sm:gap-4">
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">Phone Numbers</h1>
            <p className="text-sm sm:text-base text-gray-600 dark:text-gray-400 mt-1">Manage your phone numbers and attached agents</p>
          </div>
          <button
            onClick={() => {
              setImportProvider('TWILIO');
              setShowImportModal(true);
            }}
            className="px-3 sm:px-4 py-2 text-sm sm:text-base bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg transition whitespace-nowrap flex-shrink-0"
          >
            <span className="hidden sm:inline">+ Import Phone Number</span>
            <span className="sm:hidden">+ Import</span>
          </button>
        </div>

        {/* Search Bar */}
        <div className="mb-4">
          <input
            type="text"
            placeholder="Search phone numbers..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setPageno(1);
            }}
            className="w-full px-4 py-2 text-sm sm:text-base bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg focus:outline-none focus:border-cyan-500 text-gray-900 dark:text-white"
          />
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="mb-4 p-4 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 rounded-lg text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Import Modal */}
      {showImportModal && (
        <ImportPhoneNumberModal
          provider={importProvider}
          onClose={() => setShowImportModal(false)}
          onImportTwilio={handleImportTwilio}
          onImportExotel={handleImportExotel}
        />
      )}

      {/* Get Your Phone Number Section */}
      <div className="mb-4 sm:mb-6 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 sm:p-6">
        <h2 className="text-lg sm:text-xl font-bold mb-3 sm:mb-4 flex items-center gap-2 text-gray-900 dark:text-white">
          <svg className="w-5 h-5 sm:w-6 sm:h-6 text-cyan-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
          </svg>
          Get Your Phone Number
        </h2>
        <p className="text-sm sm:text-base text-gray-600 dark:text-gray-400 mb-4 sm:mb-6">
          Import a phone number from Twilio or Exotel to enable voice capabilities for your agents.
        </p>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
          <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
            <h3 className="font-bold mb-2 text-gray-900 dark:text-white">Twilio</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">Import phone numbers from Twilio for voice interactions</p>
            <button
              onClick={() => {
                setImportProvider('TWILIO');
                setShowImportModal(true);
              }}
              className="px-4 py-2 border border-cyan-500 text-cyan-500 hover:bg-cyan-500 hover:text-white rounded-lg transition flex items-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
              </svg>
              Import from Twilio
            </button>
          </div>

          <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
            <h3 className="font-bold mb-2 text-gray-900 dark:text-white">Exotel (India)</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">Import phone numbers from Exotel for Indian numbers (+91)</p>
            <button
              onClick={() => {
                setImportProvider('EXOTEL');
                setShowImportModal(true);
              }}
              className="px-4 py-2 border border-cyan-500 text-cyan-500 hover:bg-cyan-500 hover:text-white rounded-lg transition flex items-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
              </svg>
              Import from Exotel
            </button>
          </div>
        </div>
      </div>

      {/* Phone Numbers List */}
      {loading ? (
        <div className="flex justify-center items-center py-20">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-cyan-500"></div>
        </div>
      ) : phoneNumbers.length === 0 ? (
        <div className="text-center py-20 text-gray-600 dark:text-gray-400">
          <p className="text-xl">No phone numbers found</p>
          <p className="text-sm mt-2">Import your first phone number to get started</p>
        </div>
      ) : (
        <div className="space-y-4">
          {phoneNumbers.map(phoneNumber => (
            <PhoneNumberCard
              key={phoneNumber._id}
              phoneNumber={phoneNumber}
              onDelete={handleDelete}
              onAttachAgent={handleAttachAgent}
              onDetachAgent={handleDetachAgent}
              getProviderIcon={getProviderIcon}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex flex-col sm:flex-row justify-center items-center gap-3 sm:gap-4 mt-4 sm:mt-6">
          <button
            onClick={() => setPageno(p => Math.max(1, p - 1))}
            disabled={pageno === 1}
            className="w-full sm:w-auto px-4 py-2 text-sm sm:text-base bg-gray-200 dark:bg-gray-800 hover:bg-gray-300 dark:hover:bg-gray-700 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed text-gray-900 dark:text-white"
          >
            Previous
          </button>
          <span className="text-sm sm:text-base text-gray-600 dark:text-gray-400">
            Page {pageno} of {totalPages}
          </span>
          <button
            onClick={() => setPageno(p => Math.min(totalPages, p + 1))}
            disabled={pageno === totalPages}
            className="w-full sm:w-auto px-4 py-2 text-sm sm:text-base bg-gray-200 dark:bg-gray-800 hover:bg-gray-300 dark:hover:bg-gray-700 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed text-gray-900 dark:text-white"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
};

export default PhoneNumbers;

// ============================================================================
// IMPORT PHONE NUMBER MODAL
// ============================================================================

const ImportPhoneNumberModal = ({ provider, onClose, onImportTwilio, onImportExotel }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  
  // Twilio form data
  const [twilioForm, setTwilioForm] = useState({
    phone_number: '',
    account_sid: '',
    account_token: '',
    name: ''
  });

  // Exotel form data
  const [exotelForm, setExotelForm] = useState({
    exotel_phone_number: '',
    exotel_api_key: '',
    exotel_api_token: '',
    exotel_subdomain: '',
    exotel_account_sid: '',
    exotel_app_id: '',
    name: ''
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (provider === 'TWILIO') {
        await onImportTwilio(twilioForm);
      } else if (provider === 'EXOTEL') {
        await onImportExotel(exotelForm);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e, formType) => {
    const { name, value } = e.target;
    if (formType === 'twilio') {
      setTwilioForm(prev => ({ ...prev, [name]: value }));
    } else if (formType === 'exotel') {
      setExotelForm(prev => ({ ...prev, [name]: value }));
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          {/* Header */}
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
              Import Phone Number from {provider === 'TWILIO' ? 'Twilio' : 'Exotel'}
            </h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-white text-2xl"
            >
              ×
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit}>
            {provider === 'TWILIO' ? (
              <>
                {/* Phone Number */}
                <div className="mb-4">
                  <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Phone Number</label>
                  <input
                    type="text"
                    name="phone_number"
                    value={twilioForm.phone_number}
                    onChange={(e) => handleChange(e, 'twilio')}
                    required
                    placeholder="+1234567890"
                    className="w-full px-4 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:border-cyan-500 text-gray-900 dark:text-white"
                  />
                </div>

                {/* Account SID */}
                <div className="mb-4">
                  <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Account SID</label>
                  <input
                    type="text"
                    name="account_sid"
                    value={twilioForm.account_sid}
                    onChange={(e) => handleChange(e, 'twilio')}
                    required
                    placeholder="ACXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
                    className="w-full px-4 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:border-cyan-500 text-gray-900 dark:text-white"
                  />
                </div>

                {/* Account Token */}
                <div className="mb-4">
                  <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Account Token</label>
                  <input
                    type="password"
                    name="account_token"
                    value={twilioForm.account_token}
                    onChange={(e) => handleChange(e, 'twilio')}
                    required
                    placeholder="Your Twilio auth token"
                    className="w-full px-4 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:border-cyan-500 text-gray-900 dark:text-white"
                  />
                </div>

                {/* Name (Optional) */}
                <div className="mb-4">
                  <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Name (Optional)</label>
                  <input
                    type="text"
                    name="name"
                    value={twilioForm.name}
                    onChange={(e) => handleChange(e, 'twilio')}
                    placeholder="My Twilio Number"
                    className="w-full px-4 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:border-cyan-500 text-gray-900 dark:text-white"
                  />
                </div>
              </>
            ) : (
              <>
                {/* Exotel Phone Number */}
                <div className="mb-4">
                  <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Exotel Phone Number</label>
                  <input
                    type="text"
                    name="exotel_phone_number"
                    value={exotelForm.exotel_phone_number}
                    onChange={(e) => handleChange(e, 'exotel')}
                    required
                    placeholder="02261234567"
                    className="w-full px-4 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:border-cyan-500 text-gray-900 dark:text-white"
                  />
                </div>

                {/* Exotel API Key */}
                <div className="mb-4">
                  <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Exotel API Key</label>
                  <input
                    type="text"
                    name="exotel_api_key"
                    value={exotelForm.exotel_api_key}
                    onChange={(e) => handleChange(e, 'exotel')}
                    required
                    placeholder="Your Exotel API key"
                    className="w-full px-4 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:border-cyan-500 text-gray-900 dark:text-white"
                  />
                </div>

                {/* Exotel API Token */}
                <div className="mb-4">
                  <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Exotel API Token</label>
                  <input
                    type="password"
                    name="exotel_api_token"
                    value={exotelForm.exotel_api_token}
                    onChange={(e) => handleChange(e, 'exotel')}
                    required
                    placeholder="Your Exotel API token"
                    className="w-full px-4 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:border-cyan-500 text-gray-900 dark:text-white"
                  />
                </div>

                {/* Exotel Subdomain */}
                <div className="mb-4">
                  <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Exotel Subdomain</label>
                  <input
                    type="text"
                    name="exotel_subdomain"
                    value={exotelForm.exotel_subdomain}
                    onChange={(e) => handleChange(e, 'exotel')}
                    required
                    placeholder="Your subdomain"
                    className="w-full px-4 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:border-cyan-500 text-gray-900 dark:text-white"
                  />
                </div>

                {/* Exotel Account SID */}
                <div className="mb-4">
                  <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Exotel Account SID</label>
                  <input
                    type="text"
                    name="exotel_account_sid"
                    value={exotelForm.exotel_account_sid}
                    onChange={(e) => handleChange(e, 'exotel')}
                    required
                    placeholder="Your account SID"
                    className="w-full px-4 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:border-cyan-500 text-gray-900 dark:text-white"
                  />
                </div>

                {/* Exotel App ID */}
                <div className="mb-4">
                  <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Exotel App ID</label>
                  <input
                    type="text"
                    name="exotel_app_id"
                    value={exotelForm.exotel_app_id}
                    onChange={(e) => handleChange(e, 'exotel')}
                    required
                    placeholder="Your app ID"
                    className="w-full px-4 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:border-cyan-500 text-gray-900 dark:text-white"
                  />
                </div>

                {/* Name (Optional) */}
                <div className="mb-4">
                  <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Name (Optional)</label>
                  <input
                    type="text"
                    name="name"
                    value={exotelForm.name}
                    onChange={(e) => handleChange(e, 'exotel')}
                    placeholder="My Exotel Number"
                    className="w-full px-4 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:border-cyan-500 text-gray-900 dark:text-white"
                  />
                </div>
              </>
            )}

            {/* Error Message */}
            {error && (
              <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 rounded-lg text-sm text-red-700 dark:text-red-300">
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
                className="px-6 py-2 bg-cyan-600 hover:bg-cyan-700 rounded-lg transition disabled:opacity-50 text-white"
              >
                {loading ? 'Importing...' : 'Import Phone Number'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// PHONE NUMBER CARD COMPONENT
// ============================================================================

const PhoneNumberCard = ({ phoneNumber, onDelete, onAttachAgent, onDetachAgent, getProviderIcon }) => {
  const [showAttachModal, setShowAttachModal] = useState(false);
  const [agents, setAgents] = useState([]);
  const [loadingAgents, setLoadingAgents] = useState(false);

  // Fetch agents when modal opens
  useEffect(() => {
    if (showAttachModal) {
      fetchAgents();
    }
  }, [showAttachModal]);

  const fetchAgents = async () => {
    try {
      setLoadingAgents(true);
      const response = await api.get('/admin/voice-assistants');
      if (response.data.success) {
        setAgents(response.data.data || []);
      }
    } catch (err) {
      console.error('Error fetching agents:', err);
    } finally {
      setLoadingAgents(false);
    }
  };

  const handleAttach = (agent) => {
    onAttachAgent(phoneNumber._id, agent);
    setShowAttachModal(false);
  };

  return (
    <>
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 sm:p-6 overflow-hidden">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start mb-4 gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xl sm:text-2xl flex-shrink-0">{getProviderIcon(phoneNumber.provider)}</span>
              <h3 className="text-base sm:text-lg font-bold text-gray-900 dark:text-white truncate">{phoneNumber.number}</h3>
            </div>
            <div className="flex gap-2 flex-wrap">
              <span className="px-2 py-1 bg-gray-100 dark:bg-gray-700 text-xs rounded text-gray-700 dark:text-gray-300">{phoneNumber.label || 'Personal'}</span>
              <span className={`px-2 py-1 text-xs rounded ${
                phoneNumber.status === 'Active' ? 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300' :
                phoneNumber.status === 'Inactive' ? 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300' : 
                'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300'
              }`}>
                {phoneNumber.status}
              </span>
              <span className="px-2 py-1 bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 text-xs rounded">
                {phoneNumber.provider}
              </span>
            </div>
          </div>
        </div>

        {/* Attached Agent */}
        <div className="mb-4">
          <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Attached Agent</label>
          {phoneNumber.attachedAgent ? (
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <svg className="w-4 h-4 sm:w-5 sm:h-5 text-cyan-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                <span className="text-sm sm:text-base text-gray-900 dark:text-white truncate">{phoneNumber.attachedAgent?.name || 'Unknown Agent'}</span>
              </div>
              <button
                onClick={() => onDetachAgent(phoneNumber._id)}
                className="w-full sm:w-auto px-3 py-1.5 sm:py-1 text-xs sm:text-sm bg-red-100 dark:bg-red-900 hover:bg-red-200 dark:hover:bg-red-800 text-red-700 dark:text-red-300 rounded transition"
              >
                Detach
              </button>
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3">
              <input
                type="text"
                placeholder="No agent attached"
                disabled
                className="flex-1 px-3 sm:px-4 py-2 text-sm sm:text-base bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg opacity-50 text-gray-500 dark:text-gray-400"
              />
              <button
                onClick={() => setShowAttachModal(true)}
                className="w-full sm:w-auto px-4 py-2 text-sm sm:text-base bg-cyan-600 hover:bg-cyan-700 rounded-lg transition text-white whitespace-nowrap"
              >
                Attach Agent
              </button>
            </div>
          )}
        </div>

        {/* Usage Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mb-4 pt-4 border-t border-gray-200 dark:border-gray-700">
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">Total Calls</p>
            <p className="text-base sm:text-lg font-bold text-gray-900 dark:text-white">{phoneNumber.usage?.totalCalls || 0}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">Total Minutes</p>
            <p className="text-base sm:text-lg font-bold text-gray-900 dark:text-white">{phoneNumber.usage?.totalMinutes || 0}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">Monthly Cost</p>
            <p className="text-base sm:text-lg font-bold text-gray-900 dark:text-white">${phoneNumber.monthlyCost || '0.00'}</p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2">
          <button
            onClick={() => onDelete(phoneNumber._id)}
            className="w-full sm:w-auto px-4 py-2 text-sm sm:text-base bg-red-100 dark:bg-red-900 hover:bg-red-200 dark:hover:bg-red-800 text-red-700 dark:text-red-300 rounded-lg transition"
          >
            Delete
          </button>
        </div>
      </div>

      {/* Attach Agent Modal */}
      {showAttachModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50 overflow-y-auto">
          <div className="bg-white dark:bg-gray-800 rounded-lg max-w-md w-full my-auto">
            <div className="p-4 sm:p-6">
              <div className="flex justify-between items-center mb-4 sm:mb-6">
                <h2 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white">Select Agent</h2>
                <button
                  onClick={() => setShowAttachModal(false)}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-white text-2xl flex-shrink-0"
                >
                  ×
                </button>
              </div>

              {loadingAgents ? (
                <div className="flex justify-center py-10">
                  <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-cyan-500"></div>
                </div>
              ) : (
                <div className="space-y-2 max-h-[60vh] overflow-y-auto">
                  {agents.length === 0 ? (
                    <p className="text-center text-gray-500 dark:text-gray-400 py-10 text-sm sm:text-base">No agents available</p>
                  ) : (
                    agents.map(agent => (
                      <button
                        key={agent._id}
                        onClick={() => handleAttach(agent)}
                        className="w-full text-left p-3 sm:p-4 bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 rounded-lg transition"
                      >
                        <p className="font-bold text-sm sm:text-base text-gray-900 dark:text-white truncate">{agent.name}</p>
                        <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 truncate">{agent.description || 'No description'}</p>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

