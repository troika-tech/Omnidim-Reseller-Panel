/**
 * Environment Configuration Loader
 * Loads and validates all environment variables
 */

const path = require('path');
const dotenv = require('dotenv');

// Load environment variables from .env file
dotenv.config({ path: path.join(__dirname, '..', '.env') });

// Validate required environment variables
const requiredEnvVars = {
  development: [
    'PORT',
    'MONGODB_URI',
    'JWT_SECRET',
    'OMNIDIMENSION_API_KEY',
    'OMNIDIMENSION_BASE_URL',
    'FRONTEND_URL',
    'EXOTEL_ACCOUNT_SID',
    'EXOTEL_API_KEY',
    'EXOTEL_API_TOKEN'
  ],
  staging: [
    'PORT',
    'MONGODB_URI',
    'JWT_SECRET',
    'OMNIDIMENSION_API_KEY',
    'OMNIDIMENSION_BASE_URL',
    'FRONTEND_URL',
    'EXOTEL_ACCOUNT_SID',
    'EXOTEL_API_KEY',
    'EXOTEL_API_TOKEN'
  ],
  production: [
    'PORT',
    'MONGODB_URI',
    'JWT_SECRET',
    'OMNIDIMENSION_API_KEY',
    'OMNIDIMENSION_BASE_URL',
    'FRONTEND_URL',
    'EXOTEL_ACCOUNT_SID',
    'EXOTEL_API_KEY',
    'EXOTEL_API_TOKEN'
  ]
};

// Check for missing required environment variables
const missingVars = [];
const env = process.env.NODE_ENV || 'development';
const required = requiredEnvVars[env] || requiredEnvVars.development;

required.forEach(varName => {
  if (!process.env[varName]) {
    missingVars.push(varName);
  }
});

if (missingVars.length > 0) {
  console.error('❌ Missing required environment variables:');
  missingVars.forEach(varName => console.error(`   - ${varName}`));
  console.error('\nPlease check your .env file or env.example for reference.');
  process.exit(1);
}

// Export environment configuration
const config = {
  // Server Configuration
  server: {
    port: parseInt(process.env.PORT, 10) || 5000,
    host: process.env.HOST || 'localhost',
    env: process.env.NODE_ENV || 'development'
  },

  // Database Configuration
  database: {
    uri: process.env.MONGODB_URI,
    dbName: process.env.MONGODB_DB_NAME || 'omnidimension',
    connectionTimeout: parseInt(process.env.MONGODB_CONNECTION_TIMEOUT, 10) || 30000,
    socketTimeout: parseInt(process.env.MONGODB_SOCKET_TIMEOUT, 10) || 30000
  },

  // JWT Authentication
  jwt: {
    secret: process.env.JWT_SECRET,
    expiration: process.env.JWT_EXPIRATION || '7d',
    refreshExpiration: process.env.JWT_REFRESH_EXPIRATION || '30d'
  },

  // OMNIDIMENSION API
  omnidimension: {
    baseUrl: process.env.OMNIDIMENSION_BASE_URL,
    apiKey: process.env.OMNIDIMENSION_API_KEY,
    timeout: parseInt(process.env.OMNIDIMENSION_API_TIMEOUT, 10) || 30000,
    retryAttempts: parseInt(process.env.OMNIDIMENSION_API_RETRY_ATTEMPTS, 10) || 3
  },

  // CORS Configuration
  cors: {
    origin: process.env.FRONTEND_URL,
    allowedOrigins: process.env.ALLOWED_ORIGINS 
      ? process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim())
      : [process.env.FRONTEND_URL]
  },

  // File Upload Configuration
  upload: {
    dir: process.env.UPLOAD_DIR || './uploads',
    maxSize: parseInt(process.env.MAX_FILE_SIZE, 10) || 10485760, // 10MB
    allowedTypes: process.env.ALLOWED_FILE_TYPES 
      ? process.env.ALLOWED_FILE_TYPES.split(',').map(type => type.trim())
      : ['application/pdf'],
    enableCompression: process.env.ENABLE_FILE_COMPRESSION === 'true'
  },

  // Rate Limiting
  rateLimit: {
    enabled: process.env.ENABLE_RATE_LIMITING !== 'false',
    requests: parseInt(process.env.RATE_LIMIT_REQUESTS, 10) || 100,
    window: parseInt(process.env.RATE_LIMIT_WINDOW, 10) || 15
  },

  // Logging Configuration
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    enableRequestLogging: process.env.ENABLE_REQUEST_LOGGING !== 'false',
    enableErrorLogging: process.env.ENABLE_ERROR_LOGGING !== 'false'
  },

  // Security Configuration
  security: {
    enableHelmet: process.env.ENABLE_HELMET !== 'false',
    enableSecureCookies: process.env.ENABLE_SECURE_COOKIES === 'true',
    sessionSecret: process.env.SESSION_SECRET || process.env.JWT_SECRET
  },

  // Email Configuration
  email: {
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT, 10) || 587,
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.EMAIL_FROM || 'noreply@yourdomain.com'
  },

  // Pagination
  pagination: {
    defaultPageSize: parseInt(process.env.DEFAULT_PAGE_SIZE, 10) || 10,
    maxPageSize: parseInt(process.env.MAX_PAGE_SIZE, 10) || 100
  },

  // Sync Configuration
  sync: {
    enabled: process.env.ENABLE_AUTO_SYNC !== 'false',
    interval: parseInt(process.env.SYNC_INTERVAL, 10) || 60000,
    enableManualSync: process.env.ENABLE_MANUAL_SYNC !== 'false'
  },

  // Bulk Call Configuration
  bulkCall: {
    maxConcurrentCalls: parseInt(process.env.MAX_CONCURRENT_CALLS, 10) || 10,
    defaultConcurrentCalls: parseInt(process.env.DEFAULT_CONCURRENT_CALLS, 10) || 1
  },

  // Call Log Configuration
  callLog: {
    enableRecording: process.env.ENABLE_CALL_RECORDING === 'true',
    recordingDir: process.env.CALL_RECORDING_DIR || './recordings',
    maxRetentionDays: parseInt(process.env.MAX_RECORDING_RETENTION_DAYS, 10) || 30
  },

  // Development/Debug
  debug: {
    enableVerboseErrors: process.env.ENABLE_VERBOSE_ERRORS === 'true',
    enableApiLogging: process.env.ENABLE_API_LOGGING === 'true'
  },

  // Health Check
  health: {
    enabled: process.env.ENABLE_HEALTH_CHECK !== 'false',
    path: process.env.HEALTH_CHECK_PATH || '/health'
  },

  // Exotel API Configuration
  exotel: {
    subdomain: process.env.EXOTEL_SUBDOMAIN || 'api',
    accountSid: process.env.EXOTEL_ACCOUNT_SID,
    apiKey: process.env.EXOTEL_API_KEY,
    apiToken: process.env.EXOTEL_API_TOKEN,
    appId: process.env.EXOTEL_APP_ID,
    timeout: parseInt(process.env.EXOTEL_API_TIMEOUT, 10) || 30000,
    retryAttempts: parseInt(process.env.EXOTEL_API_RETRY_ATTEMPTS, 10) || 3
  }
};

// Validate configuration
if (config.server.env === 'production') {
  // Production-specific validations
  if (config.jwt.secret === 'change_this_to_a_strong_random_secret_key_in_production') {
    console.error('❌ Please change JWT_SECRET in production environment!');
    process.exit(1);
  }

  if (config.security.enableSecureCookies === false) {
    console.warn('⚠️  Warning: Secure cookies are disabled in production!');
  }

  if (config.server.host === 'localhost') {
    console.warn('⚠️  Warning: Using localhost as host in production!');
  }
}

// Log successful configuration


module.exports = config;

