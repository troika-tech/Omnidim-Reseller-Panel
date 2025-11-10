const mongoose = require('mongoose');

const bulkCallActivityLogSchema = new mongoose.Schema({
  bulkCallId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BulkCall',
    required: true,
    index: true
  },
  activityType: {
    type: String,
    enum: ['created', 'updated', 'completed', 'started', 'paused', 'resumed', 'cancelled'],
    required: true,
    index: true
  },
  initiatedBy: {
    type: {
      type: String,
      enum: ['user', 'system'],
      required: true
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    userName: {
      type: String
    }
  },
  description: {
    type: String,
    required: true
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  }
}, {
  timestamps: true
});

bulkCallActivityLogSchema.index({ bulkCallId: 1, createdAt: -1 });
bulkCallActivityLogSchema.index({ bulkCallId: 1, activityType: 1 });

const BulkCallActivityLog = mongoose.model('BulkCallActivityLog', bulkCallActivityLogSchema);

module.exports = BulkCallActivityLog;

