const mongoose = require("mongoose");

const callLogSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    omnidimensionId: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
    },
    source: {
      type: String,
      required: true,
    },
    phoneNumber: {
      type: String,
      required: true,
      index: true,
    },
    toNumber: {
      type: String,
      index: true,
    },
    normalizedSource: {
      type: String,
      index: true,
    },
    normalizedPhoneNumber: {
      type: String,
      index: true,
    },
    duration: {
      type: Number, // duration in seconds
      default: 0,
    },
    callType: {
      type: String,
      enum: ["Call", "Inbound", "Outbound", "Missed"],
      default: "Call",
    },
    cqsScore: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    status: {
      type: String,
      enum: ["completed", "failed", "busy", "no-answer", "cancelled"],
      default: "completed",
    },
    cost: {
      type: Number,
      default: 0,
    },
    recordingUrl: {
      type: String,
    },
    transcript: {
      type: String,
    },
    agentUsed: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "VoiceAssistant",
    },
    // Campaign information from OMNIDIMENSION API
    call_request_id: {
      type: mongoose.Schema.Types.Mixed, // Store the entire call_request_id object
      default: null,
    },
    bot_name: {
      type: String, // Store bot name for campaign name fallback
      default: null,
    },
    metadata: {
      ipAddress: String,
      userAgent: String,
      deviceType: String,
      location: {
        country: String,
        state: String,
        city: String,
      },
    },
    syncedAt: {
      type: Date,
    },
    lastSynced: {
      type: Date,
    },
    syncStatus: {
      type: String,
      enum: ["synced", "pending", "error"],
      default: "pending",
    },
  },
  {
    timestamps: true,
  }
);

callLogSchema.index({ userId: 1, createdAt: -1 });
callLogSchema.index({ userId: 1, phoneNumber: 1 });
callLogSchema.index({ userId: 1, toNumber: 1 });
callLogSchema.index({ userId: 1, normalizedSource: 1 });
callLogSchema.index({ userId: 1, normalizedPhoneNumber: 1 });
callLogSchema.index({ userId: 1, source: 1 });
callLogSchema.index({ userId: 1, source: 1, phoneNumber: 1 });
callLogSchema.index({ userId: 1, normalizedSource: 1, normalizedPhoneNumber: 1 });
callLogSchema.index({ userId: 1, status: 1 });
callLogSchema.index({ userId: 1, agentUsed: 1 });
callLogSchema.index({ userId: 1, "call_request_id.id": 1 }); // Index for campaign queries
callLogSchema.index({ createdAt: -1 });

// Virtual for formatted duration
callLogSchema.virtual("formattedDuration").get(function () {
  const minutes = Math.floor(this.duration / 60);
  const seconds = this.duration % 60;
  return `${minutes
    .toString()
    .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
});

const CallLog = mongoose.model("CallLog", callLogSchema);

module.exports = CallLog;
