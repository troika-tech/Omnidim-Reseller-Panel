const mongoose = require('mongoose');

const bulkCallSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  omnidimensionId: {
    type: String,
    unique: true,
    sparse: true,
    index: true
  },
  name: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['completed', 'in_progress', 'pending', 'failed', 'cancelled', 'retry_scheduled', 'active', 'paused'],
    default: 'pending',
    index: true
  },
  bot: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'VoiceAssistant'
  },
  botName: {
    type: String
  },
  fromNumber: {
    type: String,
    required: true
  },
  phoneNumberId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PhoneNumber'
  },
  phoneNumbers: [{
    type: String,
    required: true
  }],
  totalCalls: {
    type: Number,
    default: 0
  },
  totalCallsMade: {
    type: Number,
    default: 0
  },
  callsPickedUp: {
    type: Number,
    default: 0
  },
  completedCalls: {
    type: Number,
    default: 0
  },
  highEngagementCalls: {
    type: Number,
    default: 0
  },
  pendingCalls: {
    type: Number,
    default: 0
  },
  failedCalls: {
    type: Number,
    default: 0
  },
  notReachableCalls: {
    type: Number,
    default: 0
  },
  noAnswerCalls: {
    type: Number,
    default: 0
  },
  busyCalls: {
    type: Number,
    default: 0
  },
  transferCalls: {
    type: Number,
    default: 0
  },
  noLowInteractionCalls: {
    type: Number,
    default: 0
  },
  concurrentCalls: {
    type: Number,
    default: 1
  },
  progress: {
    total: { type: Number, default: 0 },
    completed: { type: Number, default: 0 },
    percentage: { type: Number, default: 0 }
  },
  totalCost: {
    type: Number,
    default: 0
  },
  createdBy: {
    type: String
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  metadata: {
    autoRetry: {
      enabled: Boolean,
      maxRetries: Number,
      retryDelay: Number
    },
    reschedule: {
      enabled: Boolean,
      schedule: Date
    }
  },
  syncedAt: {
    type: Date
  },
  lastSynced: {
    type: Date
  },
  syncStatus: {
    type: String,
    enum: ['synced', 'pending', 'error'],
    default: 'pending'
  }
}, {
  timestamps: true
});

bulkCallSchema.index({ userId: 1, createdAt: -1 });
bulkCallSchema.index({ userId: 1, status: 1 });
// omnidimensionId already has index: true with unique and sparse, so don't add duplicate

const BulkCall = mongoose.model('BulkCall', bulkCallSchema);

module.exports = BulkCall;

