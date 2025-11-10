const mongoose = require('mongoose');

const voiceAssistantSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  omnidimensionId: {
    type: String,
    required: true,
    index: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    required: true,
    trim: true
  },
  useCase: {
    type: String,
    enum: ['Lead Generation', 'Appointments', 'Support', 'Negotiation', 'Collections'],
    required: true
  },
  llm: {
    type: String,
    default: 'azure-gpt-4o-mini'
  },
  voice: {
    type: String,
    default: 'google'
  },
  knowledgeBaseFiles: {
    type: Number,
    default: 0
  },
  webSearch: {
    type: Boolean,
    default: false
  },
  postCall: {
    type: String,
    default: 'None'
  },
  integrations: {
    type: [String],
    default: []
  },
  tags: {
    type: [String],
    default: []
  },
  textBased: {
    type: Boolean,
    default: false
  },
  outgoing: {
    type: Boolean,
    default: true
  },
  syncedAt: {
    type: Date,
    default: Date.now
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

voiceAssistantSchema.index({ userId: 1, name: 1 });
voiceAssistantSchema.index({ userId: 1, omnidimensionId: 1 }, { unique: true });

const VoiceAssistant = mongoose.model('VoiceAssistant', voiceAssistantSchema);

module.exports = VoiceAssistant;

