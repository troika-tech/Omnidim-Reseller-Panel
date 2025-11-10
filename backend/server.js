const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const config = require("./config/env");

// Import routes
const authRoutes = require("./routes/auth");
const voiceAssistantsRoutes = require("./routes/voiceAssistants");
const filesRoutes = require("./routes/files");
const knowledgeBaseRoutes = require("./routes/knowledgeBase");
const phoneNumbersRoutes = require("./routes/phoneNumbers");
const callLogsRoutes = require("./routes/callLogs");
const bulkCallsRoutes = require("./routes/bulkCalls");
const usersRoutes = require("./routes/users");
const unifiedWebhookRoutes = require("./routes/webhook");
const incomingCallsRoutes = require("./routes/incomingCalls");
const recordingProxyRoutes = require("./routes/recordingProxy");

// Initialize Express app
const app = express();
const httpServer = http.createServer(app);

// Initialize Socket.IO
const io = new Server(httpServer, {
  cors: {
    origin: config.cors.allowedOrigins,
    credentials: true,
    methods: ["GET", "POST"],
  },
});

// Store io instance globally for use in controllers
global.io = io;

// Socket.IO connection handling
io.on("connection", (socket) => {
  console.log(`🔌 Socket connected: ${socket.id}`);

  socket.on("disconnect", () => {
    console.log(`🔌 Socket disconnected: ${socket.id}`);
  });
});

// Middleware
app.use(helmet());
app.use(
  cors({
    origin: config.cors.allowedOrigins,
    credentials: true,
  })
);

// Trust proxy for ngrok/reverse proxy (needed for X-Forwarded-For headers)
// Only trust the first proxy (ngrok), not all proxies for security
app.set("trust proxy", 1);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiting
if (config.rateLimit.enabled) {
  const limiter = rateLimit({
    windowMs: config.rateLimit.window * 1000,
    max: config.rateLimit.requests,
    message: "Too many requests from this IP, please try again later.",
    // Properly handle proxy headers for ngrok
    standardHeaders: true,
    legacyHeaders: false,
    // Skip rate limit validation warnings when using proxy
    validate: false,
  });
  app.use("/api/", limiter);
}

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    environment: config.server.env,
  });
});

// API Routes
app.use("/api/auth", authRoutes);
app.use("/api/admin/voice-assistants", voiceAssistantsRoutes);
app.use("/api/admin/files", filesRoutes);
app.use("/api/v1/knowledge_base", knowledgeBaseRoutes);
app.use("/api/v1/phone_number", phoneNumbersRoutes);
app.use("/api/v1/calls/logs", callLogsRoutes);
app.use("/api/v1/calls/bulk_call", bulkCallsRoutes);
app.use("/api/v1/users", usersRoutes);
app.use("/api/v1/inbound/calls", incomingCallsRoutes);

// User Routes (require authentication)
const userCallLogsRoutes = require("./user/routes/callLogs");
const userBulkCallsRoutes = require("./user/routes/bulkCalls");
const userCallLogsNewRoutes = require("./user/routes/callLogsroute");
const userOverviewRoutes = require("./user/routes/overview");
const userRoutes = require("./user/routes/user");
const {
  getUserPhoneNumbers,
} = require("./user/controllers/bulkCallsController");
const auth = require("./middleware/auth");

app.use("/api/user/calls/logs", userCallLogsRoutes);
app.use("/api/user/calls/bulk_call", userBulkCallsRoutes);
app.use("/api/user/call-logs", userCallLogsNewRoutes);
app.use("/api/users/overview", userOverviewRoutes);
app.use("/api/user", userRoutes);

// User phone numbers route
app.get("/api/user/phone-numbers", auth, getUserPhoneNumbers);

// Recording proxy route
app.use("/api/proxy", recordingProxyRoutes);

// Root-level unified webhook endpoint (ONE webhook URL for all modules)
// This is the primary webhook URL to configure in OMNIDIMENSION
app.use("/api/v1/webhook", unifiedWebhookRoutes);

// Serve uploaded files statically
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// 404 handler
app.use("*", (req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error("Error:", err);
  res.status(err.status || 500).json({
    success: false,
    message: config.debug.enableVerboseErrors
      ? err.message
      : "Internal server error",
    ...(config.server.env === "development" && { stack: err.stack }),
  });
});

// Connect to MongoDB
mongoose
  .connect(config.database.uri, {
    serverSelectionTimeoutMS: config.database.connectionTimeout,
    socketTimeoutMS: config.database.socketTimeout,
  })
  .then(() => {
    console.log("✅ MongoDB connected successfully");

    // Start HTTP server with Socket.IO
    httpServer.listen(config.server.port, config.server.host, () => {
      console.log(
        `🚀 Server running on http://${config.server.host}:${config.server.port}`
      );
      console.log(`📡 Environment: ${config.server.env}`);
      console.log(`🔗 Frontend: ${config.cors.origin}`);
      console.log(`🔌 Socket.IO ready for connections`);
    });
  })
  .catch((err) => {
    console.error("❌ MongoDB connection error:", err.message);
    process.exit(1);
  });

module.exports = app;
