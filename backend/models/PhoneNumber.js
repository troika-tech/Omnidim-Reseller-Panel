const mongoose = require('mongoose');

const phoneNumberSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  omnidimensionId: {
    type: String,
    required: true,
    unique: true,
    sparse: true,
    index: true
  },
  number: {
    type: String,
    required: true,
    index: true
  },
  label: {
    type: String,
    default: 'Personal'
  },
  name: {
    type: String, // For Twilio/Exotel name field
    default: ''
  },
  provider: {
    type: String,
    enum: ['TWILIO', 'EXOTEL', 'OTHER'],
    required: true
  },
  country: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['Active', 'Inactive', 'Suspended'],
    default: 'Active'
  },
  attachedAgent: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'VoiceAssistant',
    default: null
  },
  capabilities: {
    voice: {
      type: Boolean,
      default: true
    },
    sms: {
      type: Boolean,
      default: false
    }
  },
  monthlyCost: {
    type: Number,
    default: 0
  },
  usage: {
    totalCalls: {
      type: Number,
      default: 0
    },
    totalMinutes: {
      type: Number,
      default: 0
    },
    lastUsed: {
      type: Date
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

phoneNumberSchema.index({ userId: 1, number: 1 });

const PhoneNumber = mongoose.model('PhoneNumber', phoneNumberSchema);

module.exports = PhoneNumber;

