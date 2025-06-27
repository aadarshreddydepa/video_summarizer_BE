const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const userSchema = new mongoose.Schema({
  // Basic user information
  username: {
    type: String,
    required: [true, 'Username is required'],
    unique: true,
    trim: true,
    minlength: [3, 'Username must be at least 3 characters long'],
    maxlength: [30, 'Username cannot exceed 30 characters'],
    match: [/^[a-zA-Z0-9_]+$/, 'Username can only contain letters, numbers, and underscores']
  },
  
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    trim: true,
    lowercase: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email address']
  },
  
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: [8, 'Password must be at least 8 characters long'],
    select: false // Don't include password in queries by default
  },
  
  // Profile information
  profile: {
    firstName: {
      type: String,
      trim: true,
      maxlength: [50, 'First name cannot exceed 50 characters']
    },
    lastName: {
      type: String,
      trim: true,
      maxlength: [50, 'Last name cannot exceed 50 characters']
    },
    avatar: {
      type: String, // Cloudinary URL
      default: null
    },
    bio: {
      type: String,
      maxlength: [500, 'Bio cannot exceed 500 characters']
    }
  },
  
  // Account status and verification
  isEmailVerified: {
    type: Boolean,
    default: false
  },
  
  isActive: {
    type: Boolean,
    default: true
  },
  
  role: {
    type: String,
    enum: ['user', 'premium', 'admin'],
    default: 'user'
  },
  
  // Subscription and usage limits
  subscription: {
    type: {
      type: String,
      enum: ['free', 'basic', 'premium', 'enterprise'],
      default: 'free'
    },
    startDate: { type: Date },
    endDate: { type: Date },
    autoRenew: { type: Boolean, default: false },
    paymentMethod: { type: String }
  },
  
  // Usage tracking
  usage: {
    videosProcessed: { type: Number, default: 0 },
    totalProcessingTime: { type: Number, default: 0 }, // in minutes
    storageUsed: { type: Number, default: 0 }, // in MB
    apiCallsThisMonth: { type: Number, default: 0 },
    lastResetDate: { type: Date, default: Date.now }
  },
  
  // Usage limits based on subscription
  limits: {
    maxVideosPerMonth: { type: Number, default: 10 },
    maxVideoSize: { type: Number, default: 100 }, // in MB
    maxStorageLimit: { type: Number, default: 1000 }, // in MB
    maxProcessingTime: { type: Number, default: 60 }, // in minutes per video
    priorityProcessing: { type: Boolean, default: false }
  },
  
  // Preferences
  preferences: {
    defaultSummaryType: {
      type: String,
      enum: ['brief', 'detailed', 'bullet_points'],
      default: 'detailed'
    },
    defaultSummaryLength: {
      type: String,
      enum: ['short', 'medium', 'long'],
      default: 'medium'
    },
    language: { type: String, default: 'en' },
    timezone: { type: String, default: 'UTC' },
    emailNotifications: {
      processingComplete: { type: Boolean, default: true },
      weeklyDigest: { type: Boolean, default: false },
      promotions: { type: Boolean, default: false }
    }
  },
  
  // Security and tokens
  emailVerificationToken: { type: String },
  emailVerificationExpires: { type: Date },
  passwordResetToken: { type: String },
  passwordResetExpires: { type: Date },
  
  // Login tracking
  lastLogin: { type: Date },
  loginCount: { type: Number, default: 0 },
  
  // API access
  apiKey: {
    type: String,
    unique: true,
    sparse: true
  },
  
  apiKeyCreatedAt: { type: Date },
  
  // Social login
  socialAccounts: [{
    provider: {
      type: String,
      enum: ['google', 'github', 'facebook']
    },
    providerId: { type: String },
    email: { type: String },
    connectedAt: { type: Date, default: Date.now }
  }],
  
  // Timestamps
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  deletedAt: { type: Date }, // Soft delete
  
}, {
  timestamps: true,
  collection: 'users'
});

// Indexes
userSchema.index({ email: 1 });
userSchema.index({ username: 1 });
userSchema.index({ apiKey: 1 });
userSchema.index({ 'socialAccounts.provider': 1, 'socialAccounts.providerId': 1 });
userSchema.index({ createdAt: -1 });
userSchema.index({ role: 1 });

// Virtual for full name
userSchema.virtual('fullName').get(function() {
  if (this.profile.firstName && this.profile.lastName) {
    return `${this.profile.firstName} ${this.profile.lastName}`;
  }
  return this.profile.firstName || this.profile.lastName || this.username;
});

// Virtual for subscription status
userSchema.virtual('isSubscriptionActive').get(function() {
  if (this.subscription.type === 'free') return true;
  return this.subscription.endDate && this.subscription.endDate > new Date();
});

// Pre-save middleware to hash password
userSchema.pre('save', async function(next) {
  // Only hash password if it's been modified
  if (!this.isModified('password')) return next();
  
  try {
    // Hash password with cost of 12
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Pre-save middleware to update timestamp
userSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Instance methods
userSchema.methods.comparePassword = async function(candidatePassword) {
  if (!this.password) return false;
  return await bcrypt.compare(candidatePassword, this.password);
};

userSchema.methods.generateJWT = function() {
  return jwt.sign(
    { 
      id: this._id,
      username: this.username,
      email: this.email,
      role: this.role
    },
    process.env.JWT_SECRET,
    { 
      expiresIn: process.env.JWT_EXPIRE || '7d',
      issuer: 'video-summarizer-api'
    }
  );
};

userSchema.methods.generateRefreshToken = function() {
  return jwt.sign(
    { id: this._id, type: 'refresh' },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: '30d' }
  );
};

userSchema.methods.generateApiKey = function() {
  const crypto = require('crypto');
  const apiKey = `vs_${crypto.randomBytes(32).toString('hex')}`;
  
  this.apiKey = apiKey;
  this.apiKeyCreatedAt = new Date();
  
  return apiKey;
};

userSchema.methods.canProcessVideo = function(videoSizeMB = 0) {
  // Check if user is within monthly limits
  if (this.usage.videosProcessed >= this.limits.maxVideosPerMonth) {
    return { allowed: false, reason: 'Monthly video limit exceeded' };
  }
  
  // Check video size limit
  if (videoSizeMB > this.limits.maxVideoSize) {
    return { allowed: false, reason: 'Video size exceeds limit' };
  }
  
  // Check storage limit
  if (this.usage.storageUsed + videoSizeMB > this.limits.maxStorageLimit) {
    return { allowed: false, reason: 'Storage limit would be exceeded' };
  }
  
  return { allowed: true };
};

userSchema.methods.incrementUsage = function(videoSizeMB = 0, processingTimeMinutes = 0) {
  this.usage.videosProcessed += 1;
  this.usage.storageUsed += videoSizeMB;
  this.usage.totalProcessingTime += processingTimeMinutes;
  this.usage.apiCallsThisMonth += 1;
  
  return this.save();
};

userSchema.methods.resetMonthlyUsage = function() {
  this.usage.videosProcessed = 0;
  this.usage.apiCallsThisMonth = 0;
  this.usage.lastResetDate = new Date();
  
  return this.save();
};

userSchema.methods.updateSubscription = function(subscriptionData) {
  this.subscription = { ...this.subscription, ...subscriptionData };
  
  // Update limits based on subscription type
  const subscriptionLimits = {
    free: {
      maxVideosPerMonth: 10,
      maxVideoSize: 100,
      maxStorageLimit: 1000,
      maxProcessingTime: 60,
      priorityProcessing: false
    },
    basic: {
      maxVideosPerMonth: 50,
      maxVideoSize: 500,
      maxStorageLimit: 5000,
      maxProcessingTime: 120,
      priorityProcessing: false
    },
    premium: {
      maxVideosPerMonth: 200,
      maxVideoSize: 2000,
      maxStorageLimit: 20000,
      maxProcessingTime: 300,
      priorityProcessing: true
    },
    enterprise: {
      maxVideosPerMonth: -1, // unlimited
      maxVideoSize: 10000,
      maxStorageLimit: 100000,
      maxProcessingTime: 600,
      priorityProcessing: true
    }
  };
  
  if (subscriptionLimits[this.subscription.type]) {
    this.limits = { ...this.limits, ...subscriptionLimits[this.subscription.type] };
  }
  
  return this.save();
};

// Static methods
userSchema.statics.findByEmail = function(email) {
  return this.findOne({ email: email.toLowerCase() });
};

userSchema.statics.findByUsername = function(username) {
  return this.findOne({ username });
};

userSchema.statics.findByApiKey = function(apiKey) {
  return this.findOne({ apiKey });
};

userSchema.statics.getUserStats = function() {
  return this.aggregate([
    {
      $group: {
        _id: '$subscription.type',
        count: { $sum: 1 },
        totalVideosProcessed: { $sum: '$usage.videosProcessed' },
        totalStorageUsed: { $sum: '$usage.storageUsed' }
      }
    }
  ]);
};

// Export model
module.exports = mongoose.model('User', userSchema);