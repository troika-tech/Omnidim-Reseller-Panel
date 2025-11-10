/**
 * Environment Configuration Loader
 * Loads and validates all environment variables for frontend
 */

// Get environment variables with fallbacks
const getEnv = (key, defaultValue = null, required = false) => {
  const value = import.meta.env[key];
  
  if (required && !value) {
    console.error(`❌ Missing required environment variable: ${key}`);
    console.error('Please check your .env file or env.example for reference.');
    return defaultValue;
  }
  
  return value || defaultValue;
};

// Validate required environment variables
const requiredEnvVars = [
  'VITE_API_BASE_URL'
];

// Check for missing required environment variables
const missingVars = [];
requiredEnvVars.forEach(varName => {
  if (!import.meta.env[varName]) {
    missingVars.push(varName);
  }
});

if (missingVars.length > 0 && import.meta.env.MODE === 'production') {
  console.error('❌ Missing required environment variables:');
  missingVars.forEach(varName => console.error(`   - ${varName}`));
  console.error('\nPlease check your .env file or env.example for reference.');
}

// Export environment configuration
const config = {
  // API Configuration
  api: {
    baseUrl: getEnv('VITE_API_BASE_URL', 'https://calls-api.0804.in'),
    timeout: parseInt(getEnv('VITE_API_TIMEOUT', '30000'), 10)
  },

  // OMNIDIMENSION Configuration
  omnidimension: {
    baseUrl: getEnv('VITE_OMNIDIMENSION_BASE_URL', 'https://app.omnidimension.com')
  },

  // Application Configuration
  app: {
    name: getEnv('VITE_APP_NAME', 'OMNIDIMENSION Panel'),
    env: getEnv('VITE_NODE_ENV', import.meta.env.MODE || 'development')
  },

  // Feature Flags
  features: {
    enableAutoSync: getEnv('VITE_ENABLE_AUTO_SYNC', 'true') === 'true',
    enableFileUpload: getEnv('VITE_ENABLE_FILE_UPLOAD', 'true') === 'true',
    maxFileSizeMB: parseInt(getEnv('VITE_MAX_FILE_SIZE_MB', '10'), 10)
  },

  // Analytics & Tracking
  analytics: {
    gaTrackingId: getEnv('VITE_GA_TRACKING_ID', '')
  },

  // Display Configuration
  display: {
    defaultTheme: getEnv('VITE_DEFAULT_THEME', 'dark'),
    itemsPerPage: parseInt(getEnv('VITE_ITEMS_PER_PAGE', '10'), 10)
  },

  // Notification Settings
  notifications: {
    enabled: getEnv('VITE_ENABLE_NOTIFICATIONS', 'true') === 'true',
    toastDuration: parseInt(getEnv('VITE_TOAST_DURATION', '3000'), 10)
  },

  // Security
  security: {
    cspReportOnly: getEnv('VITE_CSP_REPORT_ONLY', 'false') === 'true'
  },

  // Development helpers
  isDevelopment: import.meta.env.MODE === 'development',
  isProduction: import.meta.env.MODE === 'production',
  isStaging: import.meta.env.MODE === 'staging'
};

// Log successful configuration (only in development)
if (config.isDevelopment) {
  console.log('✅ Frontend environment configuration loaded');
  console.log(`📍 Environment: ${config.app.env}`);
  console.log(`🌐 API: ${config.api.baseUrl}`);
  console.log(`📱 App: ${config.app.name}`);
}

export default config;

