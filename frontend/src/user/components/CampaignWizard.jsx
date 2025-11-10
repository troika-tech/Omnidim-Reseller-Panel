import React, { useState, useEffect } from "react";
import api from "../../utils/api";
import { useToast } from "../../contexts/ToastContext";

const CampaignWizard = ({ isOpen, onClose, onSuccess }) => {
  const { showToast } = useToast();
  const [currentStep, setCurrentStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [phoneNumbers, setPhoneNumbers] = useState([]);

  // Form data
  const [formData, setFormData] = useState({
    // Step 1: Campaign & Phone Number
    name: "",
    phoneNumberId: "",
    concurrentCallLimit: 1,

    // Step 2: Contact List
    contactList: [],
    csvFile: null,

    // Step 3: Campaign Settings
    isScheduled: false,
    scheduledDatetime: "",
    timezone: "America/New_York",
    retryConfig: {
      autoRetry: false,
      autoRetrySchedule: "immediately",
      retryScheduleDays: 0,
      retryScheduleHours: 0,
      retryLimit: 0,
    },
    enabledRescheduleCall: false,
  });

  // Fetch phone numbers on mount
  useEffect(() => {
    if (isOpen) {
      fetchPhoneNumbers();
    }
  }, [isOpen]);

  const fetchPhoneNumbers = async () => {
    try {
      const response = await api.get("/user/phone-numbers");
      if (response.data.success) {
        setPhoneNumbers(response.data.data);
      }
    } catch (error) {
      console.error("Error fetching phone numbers:", error);
    }
  };

  const handleInputChange = (field, value) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleRetryConfigChange = (field, value) => {
    setFormData((prev) => ({
      ...prev,
      retryConfig: {
        ...prev.retryConfig,
        [field]: value,
      },
    }));
  };

  const handleCSVUpload = (event) => {
    const file = event.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const csv = e.target.result;
        const lines = csv.split("\n");
        const contacts = [];

        for (let i = 1; i < lines.length; i++) {
          const line = lines[i].trim();
          if (line) {
            const [phone_number, customer_name] = line.split(",");
            if (phone_number) {
              contacts.push({
                phone_number: phone_number.trim(),
                customer_name: customer_name?.trim() || "",
              });
            }
          }
        }

        setFormData((prev) => ({
          ...prev,
          contactList: contacts,
          csvFile: file,
        }));
      };
      reader.readAsText(file);
    }
  };

  const nextStep = () => {
    if (currentStep < 4) {
      setCurrentStep(currentStep + 1);
    }
  };

  const prevStep = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleSubmit = async () => {
    setLoading(true);
    try {
      const response = await api.post("/user/calls/bulk_call/create", formData);
      if (response.data.success) {
        onSuccess();
      }
    } catch (error) {
      console.error("Error creating campaign:", error);
      showToast(
        "Failed to create campaign: " +
          (error.response?.data?.message || error.message),
        "error"
      );
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-2 sm:p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg max-w-4xl w-full max-h-[95vh] sm:max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="p-4 sm:p-6 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between">
            <h2 className="text-lg sm:text-xl lg:text-2xl font-bold text-gray-900 dark:text-white">
              Create Campaign
            </h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1"
            >
              <svg
                className="w-5 h-5 sm:w-6 sm:h-6"
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

          {/* Progress Steps */}
          <div className="flex items-center mt-4 sm:mt-6 overflow-x-auto">
            {[1, 2, 3, 4].map((step) => (
              <div key={step} className="flex items-center flex-shrink-0">
                <div
                  className={`w-6 h-6 sm:w-8 sm:h-8 rounded-full flex items-center justify-center text-xs sm:text-sm font-medium ${
                    step <= currentStep
                      ? "bg-cyan-600 text-white"
                      : "bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400"
                  }`}
                >
                  {step}
                </div>
                {step < 4 && (
                  <div
                    className={`w-8 sm:w-12 lg:w-16 h-1 mx-1 sm:mx-2 ${
                      step < currentStep
                        ? "bg-cyan-600"
                        : "bg-gray-200 dark:bg-gray-700"
                    }`}
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Step Content */}
        <div className="p-4 sm:p-6">
          {/* Step 1: Campaign & Phone Number */}
          {currentStep === 1 && (
            <div>
              <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">
                Campaign Details
              </h3>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Campaign Name
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => handleInputChange("name", e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:border-cyan-500 dark:bg-gray-700 dark:text-white"
                    placeholder="Enter campaign name"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Phone Number
                  </label>
                  <select
                    value={formData.phoneNumberId}
                    onChange={(e) =>
                      handleInputChange("phoneNumberId", e.target.value)
                    }
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:border-cyan-500 dark:bg-gray-700 dark:text-white"
                  >
                    <option value="">Select a phone number</option>
                    {phoneNumbers.map((phone) => (
                      <option key={phone._id} value={phone._id}>
                        {phone.number} {phone.label && `(${phone.label})`}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Concurrent Call Limit
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="10"
                    value={formData.concurrentCallLimit}
                    onChange={(e) =>
                      handleInputChange(
                        "concurrentCallLimit",
                        parseInt(e.target.value)
                      )
                    }
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:border-cyan-500 dark:bg-gray-700 dark:text-white"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Upload Contact List */}
          {currentStep === 2 && (
            <div>
              <h3 className="text-lg font-medium mb-4">Upload Contact List</h3>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    CSV File
                  </label>
                  <input
                    type="file"
                    accept=".csv"
                    onChange={handleCSVUpload}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:border-cyan-500 dark:bg-gray-700 dark:text-white"
                  />
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                    Upload a CSV file with columns: phone_number, customer_name
                  </p>
                </div>

                {formData.contactList.length > 0 && (
                  <div>
                    <h4 className="font-medium text-gray-900 dark:text-white mb-2">
                      Preview ({formData.contactList.length} contacts)
                    </h4>
                    <div className="max-h-40 overflow-y-auto border border-gray-300 dark:border-gray-600 rounded-lg">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50 dark:bg-gray-700">
                          <tr>
                            <th className="px-3 py-2 text-left text-gray-900 dark:text-white">
                              Phone Number
                            </th>
                            <th className="px-3 py-2 text-left text-gray-900 dark:text-white">
                              Customer Name
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {formData.contactList
                            .slice(0, 5)
                            .map((contact, index) => (
                              <tr
                                key={index}
                                className="border-t border-gray-200 dark:border-gray-600"
                              >
                                <td className="px-3 py-2 text-gray-900 dark:text-white">
                                  {contact.phone_number}
                                </td>
                                <td className="px-3 py-2 text-gray-900 dark:text-white">
                                  {contact.customer_name}
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Step 3: Campaign Settings */}
          {currentStep === 3 && (
            <div>
              <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">
                Campaign Settings
              </h3>

              <div className="space-y-4 sm:space-y-6">
                {/* Scheduling */}
                <div>
                  <h4 className="font-medium text-gray-900 dark:text-white mb-3">
                    Campaign Scheduling
                  </h4>
                  <div className="space-y-2 sm:space-y-3">
                    <label className="flex items-center text-gray-900 dark:text-white">
                      <input
                        type="radio"
                        name="scheduling"
                        checked={!formData.isScheduled}
                        onChange={() => handleInputChange("isScheduled", false)}
                        className="mr-2 text-cyan-600 focus:ring-cyan-500"
                      />
                      Start Immediately
                    </label>
                    <label className="flex items-center text-gray-900 dark:text-white">
                      <input
                        type="radio"
                        name="scheduling"
                        checked={formData.isScheduled}
                        onChange={() => handleInputChange("isScheduled", true)}
                        className="mr-2 text-cyan-600 focus:ring-cyan-500"
                      />
                      Schedule for Later
                    </label>

                    {formData.isScheduled && (
                      <div className="ml-4 sm:ml-6 space-y-2 sm:space-y-3">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            Date & Time
                          </label>
                          <input
                            type="datetime-local"
                            value={formData.scheduledDatetime}
                            onChange={(e) =>
                              handleInputChange(
                                "scheduledDatetime",
                                e.target.value
                              )
                            }
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:border-cyan-500 dark:bg-gray-700 dark:text-white"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            Timezone
                          </label>
                          <select
                            value={formData.timezone}
                            onChange={(e) =>
                              handleInputChange("timezone", e.target.value)
                            }
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:border-cyan-500 dark:bg-gray-700 dark:text-white"
                          >
                            <option value="America/New_York">
                              Eastern Time
                            </option>
                            <option value="America/Chicago">
                              Central Time
                            </option>
                            <option value="America/Denver">
                              Mountain Time
                            </option>
                            <option value="America/Los_Angeles">
                              Pacific Time
                            </option>
                          </select>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Auto Retry */}
                <div>
                  <label className="flex items-center text-gray-900 dark:text-white">
                    <input
                      type="checkbox"
                      checked={formData.retryConfig.autoRetry}
                      onChange={(e) =>
                        handleRetryConfigChange("autoRetry", e.target.checked)
                      }
                      className="mr-2 text-cyan-600 focus:ring-cyan-500 rounded"
                    />
                    Enable Auto Retry
                  </label>

                  {formData.retryConfig.autoRetry && (
                    <div className="ml-4 sm:ml-6 mt-2 sm:mt-3 space-y-2 sm:space-y-3">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            Retry Days
                          </label>
                          <input
                            type="number"
                            min="0"
                            value={formData.retryConfig.retryScheduleDays}
                            onChange={(e) =>
                              handleRetryConfigChange(
                                "retryScheduleDays",
                                parseInt(e.target.value)
                              )
                            }
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:border-cyan-500 dark:bg-gray-700 dark:text-white"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            Retry Hours
                          </label>
                          <input
                            type="number"
                            min="0"
                            max="23"
                            value={formData.retryConfig.retryScheduleHours}
                            onChange={(e) =>
                              handleRetryConfigChange(
                                "retryScheduleHours",
                                parseInt(e.target.value)
                              )
                            }
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:border-cyan-500 dark:bg-gray-700 dark:text-white"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                          Retry Limit
                        </label>
                        <input
                          type="number"
                          min="0"
                          max="5"
                          value={formData.retryConfig.retryLimit}
                          onChange={(e) =>
                            handleRetryConfigChange(
                              "retryLimit",
                              parseInt(e.target.value)
                            )
                          }
                          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:border-cyan-500 dark:bg-gray-700 dark:text-white"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Call Rescheduling */}
                <div>
                  <label className="flex items-center text-gray-900 dark:text-white">
                    <input
                      type="checkbox"
                      checked={formData.enabledRescheduleCall}
                      onChange={(e) =>
                        handleInputChange(
                          "enabledRescheduleCall",
                          e.target.checked
                        )
                      }
                      className="mr-2 text-cyan-600 focus:ring-cyan-500 rounded"
                    />
                    Enable Call Rescheduling
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* Step 4: Review & Create */}
          {currentStep === 4 && (
            <div>
              <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">
                Review & Create
              </h3>

              <div className="space-y-3 sm:space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                  <div>
                    <h4 className="font-medium text-gray-900 dark:text-white">
                      Campaign Name
                    </h4>
                    <p className="text-gray-600 dark:text-gray-400">
                      {formData.name}
                    </p>
                  </div>
                  <div>
                    <h4 className="font-medium text-gray-900 dark:text-white">
                      Phone Number
                    </h4>
                    <p className="text-gray-600 dark:text-gray-400">
                      {
                        phoneNumbers.find(
                          (p) => p._id === formData.phoneNumberId
                        )?.number
                      }
                    </p>
                  </div>
                  <div>
                    <h4 className="font-medium text-gray-900 dark:text-white">
                      Total Contacts
                    </h4>
                    <p className="text-gray-600 dark:text-gray-400">
                      {formData.contactList.length}
                    </p>
                  </div>
                  <div>
                    <h4 className="font-medium text-gray-900 dark:text-white">
                      Concurrent Calls
                    </h4>
                    <p className="text-gray-600 dark:text-gray-400">
                      {formData.concurrentCallLimit}
                    </p>
                  </div>
                  <div>
                    <h4 className="font-medium text-gray-900 dark:text-white">
                      Scheduling
                    </h4>
                    <p className="text-gray-600 dark:text-gray-400">
                      {formData.isScheduled
                        ? `Scheduled for ${formData.scheduledDatetime}`
                        : "Start Immediately"}
                    </p>
                  </div>
                  <div>
                    <h4 className="font-medium text-gray-900 dark:text-white">
                      Auto Retry
                    </h4>
                    <p className="text-gray-600 dark:text-gray-400">
                      {formData.retryConfig.autoRetry ? "Enabled" : "Disabled"}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 sm:p-6 border-t border-gray-200 dark:border-gray-700 flex flex-col sm:flex-row justify-between gap-3 sm:gap-0">
          <button
            onClick={prevStep}
            disabled={currentStep === 1}
            className="px-3 sm:px-4 py-2 text-sm sm:text-base text-gray-600 dark:text-gray-400 disabled:opacity-50 disabled:cursor-not-allowed order-2 sm:order-1"
          >
            Previous
          </button>

          <div className="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-3 order-1 sm:order-2">
            <button
              onClick={onClose}
              className="px-3 sm:px-4 py-2 text-sm sm:text-base text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 border border-gray-300 dark:border-gray-600 rounded-lg"
            >
              Cancel
            </button>

            {currentStep < 4 ? (
              <button
                onClick={nextStep}
                disabled={
                  (currentStep === 1 &&
                    (!formData.name || !formData.phoneNumberId)) ||
                  (currentStep === 2 && formData.contactList.length === 0)
                }
                className="px-3 sm:px-4 py-2 text-sm sm:text-base bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={loading}
                className="px-3 sm:px-4 py-2 text-sm sm:text-base bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
              >
                {loading ? (
                  <>
                    <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Creating...
                  </>
                ) : (
                  "Create Campaign"
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default CampaignWizard;
