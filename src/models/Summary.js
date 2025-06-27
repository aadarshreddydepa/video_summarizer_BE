const mongoose = require('mongoose');

const summarySchema = new mongoose.Schema({
  // Reference to the video
  videoId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Video',
    required: [true, 'Video ID is required'],
    index: true
  },
  
  // Summary content
  title: {
    type: String,
    required: [true, 'Summary title is required'],
    trim: true,
    maxlength: [300, 'Title cannot exceed 300 characters']
  },
  
  shortSummary: {
    type: String,
    required: [true, 'Short summary is required'],
    trim: true,
    maxlength: [500, 'Short summary cannot exceed 500 characters']
  },
  
  fullSummary: {
    type: String,
    required: [true, 'Full summary is required'],
    trim: true,
    maxlength: [5000, 'Full summary cannot exceed 5000 characters']
  },
  
  // Key points and highlights
  keyPoints: [{
    point: {
      type: String,
      required: true,
      trim: true,
      maxlength: [200, 'Key point cannot exceed 200 characters']
    },
    timestamp: {
      type: Number, // in seconds
      min: 0
    },
    importance: {
      type: Number,
      min: 1,
      max: 5,
      default: 3
    }
  }],
  
  // Topics and themes
  topics: [{
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: [100, 'Topic name cannot exceed 100 characters']
    },
    relevance: {
      type: Number,
      min: 0,
      max: 1,
      default: 0.5
    },
    timestamps: [{
      start: Number,
      end: Number
    }]
  }],
  
  // Sentiment analysis
  sentiment: {
    overall: {
      type: String,
      enum: ['positive', 'neutral', 'negative', 'mixed'],
      default: 'neutral'
    },
    confidence: {
      type: Number,
      min: 0,
      max: 1,
      default: 0.5
    },
    details: {
      positive: { type: Number, min: 0, max: 1, default: 0 },
      neutral: { type: Number, min: 0, max: 1, default: 0 },
      negative: { type: Number, min: 0, max: 1, default: 0 }
    }
  },
  
  // Language and complexity
  language: {
    type: String,
    default: 'en',
    maxlength: [10, 'Language code cannot exceed 10 characters']
  },
  
  readabilityScore: {
    type: Number,
    min: 0,
    max: 100
  },
  
  complexity: {
    type: String,
    enum: ['beginner', 'intermediate', 'advanced', 'expert'],
    default: 'intermediate'
  },
  
  // Categories and tags
  category: {
    type: String,
    enum: ['education', 'entertainment', 'business', 'technology', 'health', 'sports', 'news', 'other'],
    default: 'other'
  },
  
  tags: [{
    type: String,
    trim: true,
    maxlength: [50, 'Tag cannot exceed 50 characters']
  }],
  
  // Processing information
  processingMethod: {
    type: String,
    enum: ['gpt-3.5-turbo', 'gpt-4', 'gpt-4-turbo', 'claude', 'custom'],
    default: 'gpt-3.5-turbo'
  },
  
  processingModel: {
    type: String,
    default: 'gpt-3.5-turbo'
  },
  
  processingTokens: {
    input: { type: Number, min: 0, default: 0 },
    output: { type: Number, min: 0, default: 0 },
    total: { type: Number, min: 0, default: 0 }
  },
  
  processingCost: {
    type: Number,
    min: 0,
    default: 0
  },
  
  processingTime: {
    type: Number, // in milliseconds
    min: 0
  },
  
  // Quality metrics
  quality: {
    coherence: { type: Number, min: 0, max: 1 },
    completeness: { type: Number, min: 0, max: 1 },
    accuracy: { type: Number, min: 0, max: 1 },
    relevance: { type: Number, min: 0, max: 1 },
    overall: { type: Number, min: 0, max: 1 }
  },
  
  // User feedback
  ratings: [{
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    rating: {
      type: Number,
      min: 1,
      max: 5,
      required: true
    },
    feedback: {
      type: String,
      maxlength: [500, 'Feedback cannot exceed 500 characters']
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  
  averageRating: {
    type: Number,
    min: 0,
    max: 5,
    default: 0
  },
  
  // Version control
  version: {
    type: Number,
    default: 1,
    min: 1
  },
  
  previousVersionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Summary'
  },
  
  // Status and flags
  status: {
    type: String,
    enum: ['draft', 'published', 'archived', 'deleted'],
    default: 'published',
    index: true
  },
  
  isDeleted: {
    type: Boolean,
    default: false,
    index: true
  },
  
  // Analytics
  viewCount: {
    type: Number,
    default: 0,
    min: 0
  },
  
  shareCount: {
    type: Number,
    default: 0,
    min: 0
  },
  
  copyCount: {
    type: Number,
    default: 0,
    min: 0
  },
  
  // Timestamps
  generatedAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  
  lastModifiedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for better query performance
summarySchema.index({ videoId: 1, version: -1 });
summarySchema.index({ status: 1, generatedAt: -1 });
summarySchema.index({ category: 1, generatedAt: -1 });
summarySchema.index({ tags: 1 });
summarySchema.index({ 'topics.name': 1 });
summarySchema.index({ averageRating: -1 });
summarySchema.index({ isDeleted: 1, status: 1 });

// Text search index
summarySchema.index({
  title: 'text',
  shortSummary: 'text',
  fullSummary: 'text',
  'keyPoints.point': 'text',
  'topics.name': 'text',
  tags: 'text'
});

// Virtual for word count
summarySchema.virtual('wordCount').get(function() {
  if (!this.fullSummary) return 0;
  return this.fullSummary.trim().split(/\s+/).length;
});

// Virtual for reading time (assuming 200 words per minute)
summarySchema.virtual('readingTime').get(function() {
  const wordCount = this.wordCount;
  return Math.ceil(wordCount / 200);
});

// Virtual for formatted processing time
summarySchema.virtual('formattedProcessingTime').get(function() {
  if (!this.processingTime) return null;
  
  const seconds = Math.floor(this.processingTime / 1000);
  if (seconds < 60) return `${seconds}s`;
  
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
});

// Virtual for estimated cost
summarySchema.virtual('formattedCost').get(function() {
  if (!this.processingCost) return '$0.00';
  return `$${this.processingCost.toFixed(4)}`;
});

// Pre-save middleware
summarySchema.pre('save', function(next) {
  this.lastModifiedAt = new Date();
  
  // Calculate total tokens
  if (this.processingTokens) {
    this.processingTokens.total = 
      (this.processingTokens.input || 0) + (this.processingTokens.output || 0);
  }
  
  // Calculate average rating
  if (this.ratings && this.ratings.length > 0) {
    const totalRating = this.ratings.reduce((sum, rating) => sum + rating.rating, 0);
    this.averageRating = totalRating / this.ratings.length;
  }
  
  // Auto-generate title if not provided
  if (!this.title && this.shortSummary) {
    this.title = this.shortSummary.substring(0, 100) + '...';
  }
  
  next();
});

// Instance methods
summarySchema.methods.addRating = function(userId, rating, feedback) {
  // Remove existing rating from the same user
  this.ratings = this.ratings.filter(r => !r.userId || r.userId.toString() !== userId.toString());
  
  // Add new rating
  this.ratings.push({
    userId,
    rating,
    feedback,
    createdAt: new Date()
  });
  
  return this.save();
};

summarySchema.methods.incrementViewCount = function() {
  this.viewCount += 1;
  return this.save();
};

summarySchema.methods.incrementShareCount = function() {
  this.shareCount += 1;
  return this.save();
};

summarySchema.methods.incrementCopyCount = function() {
  this.copyCount += 1;
  return this.save();
};

summarySchema.methods.createNewVersion = function(updates) {
  const newSummary = new this.constructor({
    ...this.toObject(),
    ...updates,
    _id: undefined,
    version: this.version + 1,
    previousVersionId: this._id,
    generatedAt: new Date(),
    lastModifiedAt: new Date(),
    ratings: [], // Reset ratings for new version
    averageRating: 0,
    viewCount: 0,
    shareCount: 0,
    copyCount: 0
  });
  
  return newSummary.save();
};

summarySchema.methods.archive = function() {
  this.status = 'archived';
  return this.save();
};

summarySchema.methods.softDelete = function() {
  this.isDeleted = true;
  this.status = 'deleted';
  return this.save();
};

// Static methods
summarySchema.statics.findByVideo = function(videoId) {
  return this.find({ 
    videoId, 
    isDeleted: false 
  }).sort({ version: -1 });
};

summarySchema.statics.findLatestByVideo = function(videoId) {
  return this.findOne({ 
    videoId, 
    isDeleted: false 
  }).sort({ version: -1 });
};

summarySchema.statics.findByCategory = function(category) {
  return this.find({ 
    category, 
    status: 'published', 
    isDeleted: false 
  }).sort({ generatedAt: -1 });
};

summarySchema.statics.searchByText = function(query) {
  return this.find({
    $text: { $search: query },
    status: 'published',
    isDeleted: false
  }, {
    score: { $meta: 'textScore' }
  }).sort({ score: { $meta: 'textScore' } });
};

summarySchema.statics.getTopRated = function(limit = 10) {
  return this.find({
    status: 'published',
    isDeleted: false,
    averageRating: { $gt: 0 }
  })
  .sort({ averageRating: -1, viewCount: -1 })
  .limit(limit);
};

summarySchema.statics.getAnalytics = function() {
  return this.aggregate([
    { $match: { isDeleted: false } },
    {
      $group: {
        _id: null,
        totalSummaries: { $sum: 1 },
        averageRating: { $avg: '$averageRating' },
        totalViews: { $sum: '$viewCount' },
        totalShares: { $sum: '$shareCount' },
        averageWordCount: { $avg: { $size: { $split: ['$fullSummary', ' '] } } },
        averageProcessingTime: { $avg: '$processingTime' },
        totalCost: { $sum: '$processingCost' }
      }
    }
  ]);
};

summarySchema.statics.getCategoryStats = function() {
  return this.aggregate([
    { $match: { isDeleted: false, status: 'published' } },
    {
      $group: {
        _id: '$category',
        count: { $sum: 1 },
        averageRating: { $avg: '$averageRating' },
        totalViews: { $sum: '$viewCount' }
      }
    },
    { $sort: { count: -1 } }
  ]);
};

module.exports = mongoose.model('Summary', summarySchema);