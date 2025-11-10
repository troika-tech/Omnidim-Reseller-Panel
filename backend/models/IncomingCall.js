const mongoose = require('mongoose');

const incomingCallSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  exotelCallSid: {
    type: String,
    required: true,
    unique: true,
    sparse: true,
    index: true
  },
  from: {
    type: String,
    required: true,
    index: true
  },
  to: {
    type: String,
    required: true,
    index: true
  },
  status: {
    type: String,
    enum: ['ringing', 'answered', 'completed', 'busy', 'no-answer', 'failed', 'cancelled'],
    default: 'ringing',
    index: true
  },
  startTime: {
    type: Date,
    required: true
  },
  endTime: {
    type: Date
  },
  duration: {
    type: Number, // duration in seconds
    default: 0
  },
  recordingUrl: {
    type: String
  },
  callType: {
    type: String,
    default: 'incoming',
    enum: ['incoming']
  },
  metadata: {
    direction: String,
    callerName: String,
    location: {
      country: String,
      state: String,
      city: String
    }
  },
  syncedAt: {
    type: Date
  }
}, {
  timestamps: true
});

// Indexes
incomingCallSchema.index({ userId: 1, createdAt: -1 });
incomingCallSchema.index({ userId: 1, exotelCallSid: 1 }, { unique: true });
incomingCallSchema.index({ userId: 1, status: 1 });
incomingCallSchema.index({ from: 1, to: 1 });

// Virtual for formatted duration
incomingCallSchema.virtual('formattedDuration').get(function() {
  const minutes = Math.floor(this.duration / 60);
  const seconds = this.duration % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
});

const IncomingCall = mongoose.model('IncomingCall', incomingCallSchema);

module.exports = IncomingCall;

