const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    required: true,
    unique: true, // unique: true automatically creates an index
    trim: true,
    lowercase: true
  },
  password: {
    type: String,
    required: false, // For now, allow password-less users for API key auth
    select: false // Don't return password by default
  },
  role: {
    type: String,
    enum: ['admin', 'user'],
    default: 'user'
  },
  plan: {
    type: String,
    enum: ['basic', 'pro', 'enterprise'],
    default: 'basic'
  },
  minutesPerMonth: {
    type: Number,
    default: 1000
  },
  // Note: We don't store Omni API key per user - it's a global config
  // Each user can manage phone numbers, but they all use the same Omni API key
  exotelNumbers: {
    type: [String], // Array of Exotel phone numbers
    default: []
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Indexes (email already has index from unique: true)
userSchema.index({ role: 1 });
userSchema.index({ isActive: 1 });

const User = mongoose.model('User', userSchema);

module.exports = User;

