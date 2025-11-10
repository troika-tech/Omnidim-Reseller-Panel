/**
 * API Utility
 * Centralized API configuration and axios instance
 * Uses environment variables for all configurations
 */

import axios from 'axios';
import config from './env.js';

// Create axios instance with default config
const api = axios.create({
  baseURL: `${config.api.baseUrl}/api`,
  timeout: config.api.timeout,
  headers: {
    'Content-Type': 'application/json'
  }
});

// Request interceptor - Add auth token to requests
api.interceptors.request.use(
  (requestConfig) => {
    // Get token from localStorage
    const token = localStorage.getItem('token');
    
    // Add token to Authorization header if exists
    if (token) {
      requestConfig.headers.Authorization = `Bearer ${token}`;
    }
    
    // Log request in development
    if (config.isDevelopment) {
      console.log(`🔵 API Request: ${requestConfig.method?.toUpperCase()} ${requestConfig.url}`);
    }
    
    return requestConfig;
  },
  (error) => {
    console.error('❌ API Request Error:', error);
    return Promise.reject(error);
  }
);

// Response interceptor - Handle common responses
api.interceptors.response.use(
  (response) => {
    // Log response in development
    if (config.isDevelopment) {
      console.log(`🟢 API Response: ${response.config.method?.toUpperCase()} ${response.config.url}`);
    }
    return response;
  },
  (error) => {
    // Handle authentication errors
    if (error.response?.status === 401) {
      // Clear token and redirect to login
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
      
      console.error('❌ Authentication failed. Redirecting to login...');
    }
    
    // Handle other errors
    if (error.response) {
      // Server responded with error status
      console.error('❌ API Error:', error.response.status, error.response.data);
    } else if (error.request) {
      // Request made but no response received
      console.error('❌ Network Error: No response from server');
    } else {
      // Error in request setup
      console.error('❌ Request Error:', error.message);
    }
    
    return Promise.reject(error);
  }
);

// Export api instance
export default api;

// Export commonly used methods for convenience
export const apiMethods = {
  get: (url, config) => api.get(url, config),
  post: (url, data, config) => api.post(url, data, config),
  put: (url, data, config) => api.put(url, data, config),
  patch: (url, data, config) => api.patch(url, data, config),
  delete: (url, config) => api.delete(url, config)
};

