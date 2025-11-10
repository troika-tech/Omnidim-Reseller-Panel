const mongoose = require('mongoose');

const bulkCallLineSchema = new mongoose.Schema({
  bulkCallId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BulkCall',
    required: true,
    index: true
  },
  omnidimensionId: {
    type: String,
    unique: true,
    sparse: true,
    index: true
  },
  omnidimensionCallId: {
    type: String,
    index: true,
    sparse: true
  },
  toNumber: {
    type: String,
    required: true,
    index: true
  },
  callDate: {
    type: Date,
    index: true
  },
  callStatus: {
    type: String,
    enum: ['completed', 'failed', 'busy', 'no-answer', 'pending', 'cancelled'],
    default: 'pending',
    index: true
  },
  interaction: {
    type: String,
    enum: ['completed', 'no_interaction', 'low_interaction', 'transfer'],
    default: 'no_interaction'
  },
  duration: {
    type: Number, // duration in seconds
    default: 0
  },
  recording: {
    available: { type: Boolean, default: false },
    url: { type: String }
  },
  transcript: {
    type: String
  },
  metadata: {
    p50Latency: Number,
    p99Latency: Number,
    cqsScore: Number,
    sentimentScore: String,
    callCost: Number,
    totalTokens: Number
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

bulkCallLineSchema.index({ bulkCallId: 1, callDate: -1 });
bulkCallLineSchema.index({ bulkCallId: 1, callStatus: 1 });
bulkCallLineSchema.index({ bulkCallId: 1, toNumber: 1 });
bulkCallLineSchema.index(
  { bulkCallId: 1, omnidimensionCallId: 1 },
  { unique: true, sparse: true }
);

const BulkCallLine = mongoose.model('BulkCallLine', bulkCallLineSchema);

module.exports = BulkCallLine;

