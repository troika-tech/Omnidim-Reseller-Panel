const mongoose = require('mongoose');

const fileSchema = new mongoose.Schema({
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
  filename: {
    type: String,
    required: true
  },
  originalName: {
    type: String,
    required: true
  },
  size: {
    type: Number,
    required: true
  },
  type: {
    type: String,
    required: true
  },
  url: {
    type: String,
    required: true
  },
  storagePath: {
    type: String,
    required: true
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
  },
  attachedAgents: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'VoiceAssistant',
    index: true
  }]
}, {
  timestamps: true
});

fileSchema.index({ userId: 1, createdAt: -1 });

const File = mongoose.model('File', fileSchema);

module.exports = File;

