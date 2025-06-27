const mongoose = require('mongoose');

const processingJobSchema = new mongoose.Schema({
  // Job identification
  jobId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  
  // Associated video reference
  videoId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Video',
    required: true,
    index: true
  },
  
  // Job type and status
  jobType: {
    type: String,
    required: true,
    enum: ['transcription', 'summarization', 'complete_processing', 'cleanup'],
    index: true
  },
  
  status: {
    type: String,
    required: true,
    enum: ['pending', 'processing', 'completed', 'failed', 'cancelled'],
    default: 'pending',
    index: true
  },
  
  // Processing stages
  stages: {
    upload: {
      status: { type: String, enum: ['pending', 'processing', 'completed', 'failed'], default: 'pending' },
      startedAt: { type: Date },
      completedAt: { type: Date },
      progress: { type: Number, default: 0, min: 0, max: 100 }
    },
    transcription: {
      status: { type: String, enum: ['pending', 'processing', 'completed', 'failed'], default: 'pending' },
      startedAt: { type: Date },
      completedAt: { type: Date },
      progress: { type: Number, default: 0, min: 0, max: 100 },
      transcriptionId: { type: String }, // AssemblyAI job ID
      audioUrl: { type: String }
    },
    summarization: {
      status: { type: String, enum: ['pending', 'processing', 'completed', 'failed'], default: 'pending' },
      startedAt: { type: Date },
      completedAt: { type: Date },
      progress: { type: Number, default: 0, min: 0, max: 100 },
      summaryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Summary' }
    }
  },
  
  // Overall progress
  overallProgress: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  
  // Error handling
  error: {
    message: { type: String },
    code: { type: String },
    stack: { type: String },
    timestamp: { type: Date }
  },
  
  // Retry mechanism
  retryCount: {
    type: Number,
    default: 0,
    min: 0,
    max: 3
  },
  
  maxRetries: {
    type: Number,
    default: 3,
    min: 0
  },
  
  // Queue information
  queueName: {
    type: String,
    required: true,
    enum: ['video-processing', 'transcription', 'summarization', 'cleanup']
  },
  
  priority: {
    type: Number,
    default: 0,
    min: -10,
    max: 10
  },
  
  // Processing metadata
  processingOptions: {
    summaryType: { type: String, enum: ['brief', 'detailed', 'bullet_points'], default: 'detailed' },
    summaryLength: { type: String, enum: ['short', 'medium', 'long'], default: 'medium' },
    includeTimestamps: { type: Boolean, default: true },
    language: { type: String, default: 'en' }
  },
  
  // Resource usage tracking
  resources: {
    cpuUsage: { type: Number },
    memoryUsage: { type: Number },
    processingTime: { type: Number }, // in seconds
    apiCalls: {
      assemblyAI: { type: Number, default: 0 },
      openAI: { type: Number, default: 0 }
    }
  },
  
  // File references
  files: {
    originalVideo: { type: String },
    processedAudio: { type: String },
    thumbnails: [{ type: String }],
    tempFiles: [{ type: String }]
  },
  
  // Timestamps
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  startedAt: { type: Date },
  completedAt: { type: Date },
  
  // Expiry for cleanup
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
    index: { expireAfterSeconds: 0 }
  }
}, {
  timestamps: true,
  collection: 'processing_jobs'
});

// Indexes for performance
processingJobSchema.index({ status: 1, createdAt: -1 });
processingJobSchema.index({ videoId: 1, status: 1 });
processingJobSchema.index({ jobType: 1, status: 1 });
processingJobSchema.index({ 'stages.transcription.transcriptionId': 1 });

// Virtual for estimated completion time
processingJobSchema.virtual('estimatedCompletionTime').get(function() {
  if (this.status === 'completed') return null;
  
  const avgProcessingTimes = {
    transcription: 180, // 3 minutes
    summarization: 60,  // 1 minute
    complete_processing: 300 // 5 minutes
  };
  
  const remainingTime = avgProcessingTimes[this.jobType] || 300;
  const progressFactor = this.overallProgress / 100;
  
  return Math.max(0, remainingTime * (1 - progressFactor));
});

// Instance methods
processingJobSchema.methods.updateProgress = function(stage, progress, status) {
  if (this.stages[stage]) {
    this.stages[stage].progress = progress;
    if (status) this.stages[stage].status = status;
    
    // Calculate overall progress
    const stageWeights = { upload: 0.1, transcription: 0.6, summarization: 0.3 };
    let totalProgress = 0;
    
    Object.keys(stageWeights).forEach(stageName => {
      if (this.stages[stageName]) {
        totalProgress += this.stages[stageName].progress * stageWeights[stageName];
      }
    });
    
    this.overallProgress = Math.round(totalProgress);
    this.updatedAt = new Date();
  }
  return this.save();
};

processingJobSchema.methods.markStageComplete = function(stage) {
  if (this.stages[stage]) {
    this.stages[stage].status = 'completed';
    this.stages[stage].completedAt = new Date();
    this.stages[stage].progress = 100;
  }
  return this.updateProgress(stage, 100, 'completed');
};

processingJobSchema.methods.markStageFailed = function(stage, error) {
  if (this.stages[stage]) {
    this.stages[stage].status = 'failed';
    this.stages[stage].completedAt = new Date();
  }
  
  this.error = {
    message: error.message,
    code: error.code || 'PROCESSING_ERROR',
    stack: error.stack,
    timestamp: new Date()
  };
  
  this.status = 'failed';
  this.updatedAt = new Date();
  return this.save();
};

processingJobSchema.methods.canRetry = function() {
  return this.retryCount < this.maxRetries && this.status === 'failed';
};

processingJobSchema.methods.retry = function() {
  if (!this.canRetry()) {
    throw new Error('Job cannot be retried');
  }
  
  this.retryCount += 1;
  this.status = 'pending';
  this.error = undefined;
  this.updatedAt = new Date();
  
  return this.save();
};

// Static methods
processingJobSchema.statics.findByVideoId = function(videoId) {
  return this.find({ videoId }).sort({ createdAt: -1 });
};

processingJobSchema.statics.findPendingJobs = function(jobType) {
  const query = { status: 'pending' };
  if (jobType) query.jobType = jobType;
  
  return this.find(query).sort({ priority: -1, createdAt: 1 });
};

processingJobSchema.statics.getJobStats = function() {
  return this.aggregate([
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        avgProgress: { $avg: '$overallProgress' }
      }
    }
  ]);
};

// Pre-save middleware
processingJobSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  
  // Auto-update status based on stages
  if (this.status === 'processing') {
    const allStagesCompleted = Object.values(this.stages).every(stage => 
      stage.status === 'completed'
    );
    
    if (allStagesCompleted) {
      this.status = 'completed';
      this.completedAt = new Date();
    }
  }
  
  next();
});

// Export model
module.exports = mongoose.model('ProcessingJob', processingJobSchema);