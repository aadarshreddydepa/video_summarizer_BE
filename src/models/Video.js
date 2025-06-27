const mongoose = require('mongoose');

const videoSchema = new mongoose.Schema({
  // Basic video information
  title: {
    type: String,
    required: [true, 'Video title is required'],
    trim: true,
    maxlength: [200, 'Title cannot exceed 200 characters']
  },
  
  description: {
    type: String,
    trim: true,
    maxlength: [1000, 'Description cannot exceed 1000 characters']
  },
  
  // File information
  originalFileName: {
    type: String,
    required: [true, 'Original filename is required']
  },
  
  fileName: {
    type: String,
    required: [true, 'Filename is required'],
    unique: true
  },
  
  fileSize: {
    type: Number,
    required: [true, 'File size is required'],
    min: [0, 'File size cannot be negative']
  },
  
  mimeType: {
    type: String,
    required: [true, 'MIME type is required'],
    enum: {
      values: ['video/mp4', 'video/avi', 'video/mov', 'video/wmv', 'video/flv', 'video/webm', 'video/mkv'],
      message: 'Invalid video format'
    }
  },
  
  // Video properties
  duration: {
    type: Number, // in seconds
    min: [0, 'Duration cannot be negative']
  },
  
  resolution: {
    width: {
      type: Number,
      min: [0, 'Width cannot be negative']
    },
    height: {
      type: Number,
      min: [0, 'Height cannot be negative']
    }
  },
  
  frameRate: {
    type: Number,
    min: [0, 'Frame rate cannot be negative']
  },
  
  bitrate: {
    type: Number,
    min: [0, 'Bitrate cannot be negative']
  },
  
  // Storage information
  cloudinaryId: {
    type: String,
    required: [true, 'Cloudinary ID is required']
  },
  
  cloudinaryUrl: {
    type: String,
    required: [true, 'Cloudinary URL is required']
  },
  
  thumbnailUrl: {
    type: String
  },
  
  // Processing status
  status: {
    type: String,
    enum: {
      values: ['uploaded', 'processing', 'completed', 'failed', 'deleted'],
      message: 'Invalid status'
    },
    default: 'uploaded',
    index: true
  },
  
  // Processing information
  processingProgress: {
    type: Number,
    min: 0,
    max: 100,
    default: 0
  },
  
  processingStartedAt: {
    type: Date
  },
  
  processingCompletedAt: {
    type: Date
  },
  
  processingError: {
    message: String,
    stack: String,
    timestamp: {
      type: Date,
      default: Date.now
    }
  },
  
  // Transcription information
  transcriptionId: {
    type: String // AssemblyAI transcript ID
  },
  
  transcriptionStatus: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed'],
    default: 'pending'
  },
  
  transcriptionText: {
    type: String
  },
  
  transcriptionConfidence: {
    type: Number,
    min: 0,
    max: 1
  },
  
  // Language detection
  detectedLanguage: {
    type: String,
    default: 'en'
  },
  
  // Summary reference
  summaryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Summary'
  },
  
  // User information (for future authentication)
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  
  // Metadata
  tags: [{
    type: String,
    trim: true,
    maxlength: [50, 'Tag cannot exceed 50 characters']
  }],
  
  category: {
    type: String,
    enum: ['education', 'entertainment', 'business', 'technology', 'health', 'sports', 'news', 'other'],
    default: 'other'
  },
  
  // Analytics
  viewCount: {
    type: Number,
    default: 0,
    min: 0
  },
  
  downloadCount: {
    type: Number,
    default: 0,
    min: 0
  },
  
  // Flags
  isPublic: {
    type: Boolean,
    default: false
  },
  
  isDeleted: {
    type: Boolean,
    default: false,
    index: true
  },
  
  // Timestamps
  uploadedAt: {
    type: Date,
    default: Date.now,
    index: true
  }
}, {
  timestamps: true, // Adds createdAt and updatedAt
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for better query performance
videoSchema.index({ status: 1, createdAt: -1 });
videoSchema.index({ userId: 1, createdAt: -1 });
videoSchema.index({ fileName: 1 }, { unique: true });
videoSchema.index({ cloudinaryId: 1 });
videoSchema.index({ category: 1, isPublic: 1 });
videoSchema.index({ tags: 1 });

// Compound index for filtering
videoSchema.index({ 
  isDeleted: 1, 
  status: 1, 
  createdAt: -1 
});

// Virtual for formatted duration
videoSchema.virtual('formattedDuration').get(function() {
  if (!this.duration) return null;
  
  const hours = Math.floor(this.duration / 3600);
  const minutes = Math.floor((this.duration % 3600) / 60);
  const seconds = Math.floor(this.duration % 60);
  
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
});

// Virtual for formatted file size
videoSchema.virtual('formattedFileSize').get(function() {
  if (!this.fileSize) return null;
  
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = this.fileSize;
  let unitIndex = 0;
  
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  
  return `${size.toFixed(2)} ${units[unitIndex]}`;
});

// Virtual for processing duration
videoSchema.virtual('processingDuration').get(function() {
  if (!this.processingStartedAt) return null;
  
  const endTime = this.processingCompletedAt || new Date();
  return Math.floor((endTime - this.processingStartedAt) / 1000); // in seconds
});

// Pre-save middleware
videoSchema.pre('save', function(next) {
  // Set processing timestamps
  if (this.isModified('status')) {
    if (this.status === 'processing' && !this.processingStartedAt) {
      this.processingStartedAt = new Date();
    }
    
    if ((this.status === 'completed' || this.status === 'failed') && !this.processingCompletedAt) {
      this.processingCompletedAt = new Date();
    }
  }
  
  // Auto-generate title from filename if not provided
  if (!this.title && this.originalFileName) {
    this.title = this.originalFileName.replace(/\.[^/.]+$/, ''); // Remove extension
  }
  
  next();
});

// Instance methods
videoSchema.methods.updateProgress = function(progress) {
  this.processingProgress = Math.min(100, Math.max(0, progress));
  return this.save();
};

videoSchema.methods.markAsCompleted = function() {
  this.status = 'completed';
  this.processingProgress = 100;
  this.processingCompletedAt = new Date();
  return this.save();
};

videoSchema.methods.markAsFailed = function(error) {
  this.status = 'failed';
  this.processingCompletedAt = new Date();
  
  if (error) {
    this.processingError = {
      message: error.message || 'Unknown error',
      stack: error.stack || '',
      timestamp: new Date()
    };
  }
  
  return this.save();
};

videoSchema.methods.incrementViewCount = function() {
  this.viewCount += 1;
  return this.save();
};

videoSchema.methods.incrementDownloadCount = function() {
  this.downloadCount += 1;
  return this.save();
};

videoSchema.methods.softDelete = function() {
  this.isDeleted = true;
  return this.save();
};

// Static methods
videoSchema.statics.findByStatus = function(status) {
  return this.find({ status, isDeleted: false });
};

videoSchema.statics.findByUser = function(userId) {
  return this.find({ userId, isDeleted: false }).sort({ createdAt: -1 });
};

videoSchema.statics.findPublicVideos = function() {
  return this.find({ 
    isPublic: true, 
    isDeleted: false, 
    status: 'completed' 
  }).sort({ createdAt: -1 });
};

videoSchema.statics.getProcessingStats = function() {
  return this.aggregate([
    { $match: { isDeleted: false } },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        avgProcessingTime: {
          $avg: {
            $cond: [
              { $and: ['$processingStartedAt', '$processingCompletedAt'] },
              { $subtract: ['$processingCompletedAt', '$processingStartedAt'] },
              null
            ]
          }
        }
      }
    }
  ]);
};

module.exports = mongoose.model('Video', videoSchema);