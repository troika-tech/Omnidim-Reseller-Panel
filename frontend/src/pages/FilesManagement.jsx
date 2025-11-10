import React, { useState, useEffect, useRef } from 'react';
import api from '../utils/api';
import socket from '../utils/socket';
import { useToast } from '../contexts/ToastContext';

const FilesManagement = () => {
  const [files, setFiles] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);
  const { showToast, showConfirm } = useToast();

  // Fetch files on component mount
  useEffect(() => {
    fetchFiles();
  }, [page, searchQuery]);

  // Set up Socket.IO listeners for real-time updates
  useEffect(() => {
    console.log('🎧 Setting up Socket.IO listeners for files');
    
    socket.on('file_created', (newFile) => {
      console.log('📡 Received: file_created', newFile);
      setFiles(prev => {
        // Check if file already exists (avoid duplicates)
        const exists = prev.find(f => f._id === newFile._id || f.omnidimensionId === newFile.omnidimensionId);
        if (exists) return prev;
        return [newFile, ...prev];
      });
    });

    socket.on('file_updated', (updatedFile) => {
      console.log('📡 Received: file_updated', updatedFile);
      setFiles(prev => prev.map(file => 
        file._id === updatedFile._id || file.omnidimensionId === updatedFile.omnidimensionId
          ? updatedFile
          : file
      ));
      // Update selected file if it's the one that was updated
      if (selectedFile && (selectedFile._id === updatedFile._id || selectedFile.omnidimensionId === updatedFile.omnidimensionId)) {
        setSelectedFile(updatedFile);
      }
    });

    socket.on('file_deleted', ({ id }) => {
      console.log('📡 Received: file_deleted', id);
      setFiles(prev => prev.filter(file => file._id !== id && file.omnidimensionId !== id));
      if (selectedFile && (selectedFile._id === id || selectedFile.omnidimensionId === id)) {
        setSelectedFile(null);
      }
    });

    return () => {
      socket.off('file_created');
      socket.off('file_updated');
      socket.off('file_deleted');
    };
  }, [selectedFile]);

  // Fetch files from API
  const fetchFiles = async () => {
    try {
      setLoading(true);
      
      const response = await api.get('/admin/files', {
        params: {
          page,
          search: searchQuery
        }
      });

      if (response.data.success) {
        setFiles(response.data.data);
        setTotalPages(response.data.pagination.pages);
      }
    } catch (err) {
      console.error('Error fetching files:', err);
      setError(err.response?.data?.message || 'Failed to fetch files');
    } finally {
      setLoading(false);
    }
  };

  // Handle file upload
  const handleFileUpload = async (uploadedFile) => {
    try {
      setUploading(true);
      
      const formData = new FormData();
      formData.append('file', uploadedFile);

      const response = await api.post('/admin/files/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        },
        onUploadProgress: (progressEvent) => {
          const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          console.log(`Upload progress: ${percentCompleted}%`);
        }
      });

      if (response.data.success) {
        // UI update handled by Socket.IO
        setSelectedFile(response.data.data);
      }
    } catch (err) {
      console.error('Error uploading file:', err);
      showToast(err.response?.data?.message || 'Failed to upload file', 'error');
    } finally {
      setUploading(false);
    }
  };

  // Handle delete
  const handleDelete = async (id) => {
    showConfirm(
      'Are you sure you want to delete this file?',
      async () => {
        try {
          await api.delete(`/admin/files/${id}`);
          // UI update handled by Socket.IO
          showToast('File deleted successfully!', 'success');
        } catch (err) {
          console.error('Error deleting file:', err);
          showToast(err.response?.data?.message || 'Failed to delete file', 'error');
        }
      },
      () => {
        // User clicked No, do nothing
      }
    );
  };

  // Format file size
  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  return (
    <div className="min-h-screen overflow-x-hidden">
      {/* Header */}
      <div className="mb-4 sm:mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">File Management</h1>
            <p className="text-sm sm:text-base text-gray-600 dark:text-gray-400 mt-1">Upload and manage your PDF files</p>
          </div>
        </div>

        {/* Search Bar */}
        <div className="mb-4">
          <input
            type="text"
            placeholder="Search files..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setPage(1);
            }}
            className="w-full px-4 py-2 text-sm sm:text-base bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg focus:outline-none focus:border-cyan-500 text-gray-900 dark:text-white"
          />
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="mb-4 p-3 sm:p-4 text-sm sm:text-base bg-red-100 dark:bg-red-900/30 border border-red-400 dark:border-red-700 rounded-lg text-red-800 dark:text-red-200">
          {error}
        </div>
      )}

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
        {/* Left Column - Upload & List */}
        <div className="lg:col-span-2 space-y-6">
          {/* Upload Area */}
          <UploadArea
            onFileUpload={handleFileUpload}
            uploading={uploading}
            fileInputRef={fileInputRef}
          />

          {/* Files List */}
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Your Files
              </h2>
            </div>

            {loading ? (
              <div className="flex justify-center items-center py-10">
                <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-cyan-500"></div>
              </div>
            ) : files.length === 0 ? (
              <div className="text-center py-10 text-gray-600 dark:text-gray-400">
                <p className="text-lg">No files uploaded yet</p>
                <p className="text-sm mt-2">Upload your first PDF file to get started</p>
              </div>
            ) : (
              <FileList
                files={files}
                selectedFile={selectedFile}
                onSelectFile={setSelectedFile}
                onDelete={handleDelete}
                formatFileSize={formatFileSize}
              />
            )}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex flex-col sm:flex-row justify-center items-center gap-3 sm:gap-4">
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

        {/* Right Column - File Details */}
        <div>
          <FileDetails
            file={selectedFile}
            formatFileSize={formatFileSize}
          />
        </div>
      </div>
    </div>
  );
};

export default FilesManagement;

// Upload Area Component
const UploadArea = ({ onFileUpload, uploading, fileInputRef }) => {
  const [dragActive, setDragActive] = useState(false);

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  const handleChange = (e) => {
    e.preventDefault();
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0]);
    }
  };

  const handleFile = (file) => {
    if (file.type !== 'application/pdf') {
      showToast('Only PDF files are allowed', 'warning');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      showToast('File size must be less than 10MB', 'warning');
      return;
    }

    onFileUpload(file);
  };

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 sm:p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white">Upload PDFs</h2>
        <svg className="w-5 h-5 sm:w-6 sm:h-6 text-cyan-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
        </svg>
      </div>

      <div
        className={`border-2 border-dashed rounded-lg p-6 sm:p-8 md:p-12 text-center transition-colors ${
          dragActive
            ? 'border-cyan-500 bg-cyan-50 dark:bg-cyan-900/20'
            : 'border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/30 hover:border-gray-400 dark:hover:border-gray-500'
        }`}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
      >
        {uploading ? (
          <div className="flex flex-col items-center">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-cyan-500 mb-4"></div>
            <p className="text-gray-600 dark:text-gray-300">Uploading...</p>
          </div>
        ) : (
          <>
            <div className="flex justify-center mb-4">
              <svg className="w-12 h-12 sm:w-16 sm:h-16 text-cyan-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <p className="text-sm sm:text-base text-gray-700 dark:text-gray-300 mb-2">
              Drag and drop a file here, or click to select
            </p>
            <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-500">
              Supported formats: PDF (max 10MB)
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,application/pdf"
              onChange={handleChange}
              className="hidden"
              disabled={uploading}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="mt-4 px-4 sm:px-6 py-2 text-sm sm:text-base bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg transition disabled:opacity-50"
            >
              Select File
            </button>
          </>
        )}
      </div>
    </div>
  );
};

// File List Component
const FileList = ({ files, selectedFile, onSelectFile, onDelete, formatFileSize }) => {
  return (
    <div className="space-y-2">
      {files.map(file => (
        <div
          key={file._id}
          className={`flex flex-col sm:flex-row sm:items-center sm:justify-between p-3 sm:p-4 bg-gray-50 dark:bg-gray-700 rounded-lg cursor-pointer transition hover:bg-gray-100 dark:hover:bg-gray-600 gap-3 ${
            selectedFile?._id === file._id ? 'ring-2 ring-cyan-500' : ''
          }`}
          onClick={() => onSelectFile(file)}
        >
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <svg className="w-6 h-6 sm:w-8 sm:h-8 text-red-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <div className="flex-1 min-w-0">
              <p className="text-sm sm:text-base text-gray-900 dark:text-white font-medium truncate">{file.originalName}</p>
              <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">
                {formatFileSize(file.size)} • {new Date(file.createdAt).toLocaleDateString()}
              </p>
            </div>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(file._id);
            }}
            className="self-start sm:self-auto p-2 text-red-600 dark:text-red-500 hover:text-red-700 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition flex-shrink-0"
            title="Delete"
          >
            <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
};

// File Details Component
const FileDetails = ({ file, formatFileSize }) => {
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 sm:p-6 sticky top-4 sm:top-6 overflow-hidden">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white">File Details</h2>
      </div>

      {!file ? (
        <div className="text-center py-8 sm:py-10">
          <svg className="w-12 h-12 sm:w-16 sm:h-16 text-gray-400 dark:text-gray-600 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400">No File Selected</p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">Select a file to view its details</p>
        </div>
      ) : (
        <div className="space-y-3 sm:space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">File Name</label>
            <p className="text-gray-900 dark:text-white break-words">{file.originalName}</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">File Size</label>
            <p className="text-gray-900 dark:text-white">{formatFileSize(file.size)}</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">File Type</label>
            <p className="text-gray-900 dark:text-white">{file.type}</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">Uploaded</label>
            <p className="text-gray-900 dark:text-white">{new Date(file.createdAt).toLocaleString()}</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">Last Synced</label>
            <p className="text-gray-900 dark:text-white">
              {file.lastSynced ? new Date(file.lastSynced).toLocaleString() : 'Never'}
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">Sync Status</label>
            <span className={`inline-block px-2 py-1 rounded text-xs ${
              file.syncStatus === 'synced' ? 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300' :
              file.syncStatus === 'pending' ? 'bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-300' :
              'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300'
            }`}>
              {file.syncStatus.toUpperCase()}
            </span>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">File ID</label>
            <div className="flex items-center gap-2">
              <code className="text-xs text-cyan-600 dark:text-cyan-400 break-all">#{file._id.slice(-10)}</code>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(file._id);
                  showToast('ID copied to clipboard!', 'success');
                }}
                className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-white transition"
                title="Copy ID"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </button>
            </div>
          </div>

          <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
            <a
              href={file.url}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full inline-block text-center px-4 py-2 text-sm sm:text-base bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg transition"
            >
              Download File
            </a>
          </div>
        </div>
      )}
    </div>
  );
};

