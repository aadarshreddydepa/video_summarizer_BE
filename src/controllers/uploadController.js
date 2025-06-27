const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');
const Video = require('../models/Video');
const ProcessingJob = require('../models/ProcessingJob');
const { uploadToCloudinary } = require('../services/storageService');
const { addToProcessingQueue } = require('../services/queueService');
const logger = require('../utils/logger');
const { validateVideoFile } = require('../utils/validators');

class UploadController {
  /**
   * Handle video upload
   */
  async uploadVideo(req, res) {
    try {
      const { title, description } = req.body;
      const file = req.file;

      if (!file) {
        return res.status(400).json({
          success: false,
          message: 'No video file provided'
        });
      }

      // Validate video file
      const validation = validateVideoFile(file);
      if (!validation.isValid) {
        // Clean up uploaded file
        await fs.unlink(file.path).catch(() => {});
        return res.status(400).json({
          success: false,
          message: validation.message
        });
      }

      // Generate unique video ID
      const videoId = uuidv4();
      
      // Get video metadata
      const stats = await fs.stat(file.path);
      
      // Create video record in database
      const video = new Video({
        _id: videoId,
        title: title || path.parse(file.originalname).name,
        description: description || '',
        originalFilename: file.originalname,
        fileSize: stats.size,
        mimeType: file.mimetype,
        localPath: file.path,
        status: 'uploaded',
        uploadedAt: new Date()
      });

      await video.save();

      // Create processing job
      const processingJob = new ProcessingJob({
        videoId: videoId,
        status: 'pending',
        steps: {
          upload: { status: 'completed', completedAt: new Date() },
          cloudinaryUpload: { status: 'pending' },
          transcription: { status: 'pending' },
          summarization: { status: 'pending' },
          cleanup: { status: 'pending' }
        },
        createdAt: new Date()
      });

      await processingJob.save();

      // Add to processing queue
      await addToProcessingQueue(videoId, {
        videoPath: file.path,
        videoId: videoId
      });

      // Emit socket event for real-time updates
      const io = req.app.get('io');
      io.to(`video-${videoId}`).emit('upload-complete', {
        videoId,
        status: 'uploaded',
        message: 'Video uploaded successfully, processing started'
      });

      logger.info(`Video uploaded successfully: ${videoId}`);

      res.status(201).json({
        success: true,
        message: 'Video uploaded successfully',
        data: {
          videoId,
          title: video.title,
          description: video.description,
          status: video.status,
          uploadedAt: video.uploadedAt,
          fileSize: video.fileSize,
          processingJobId: processingJob._id
        }
      });

    } catch (error) {
      logger.error('Upload error:', error);
      
      // Clean up file if upload failed
      if (req.file?.path) {
        await fs.unlink(req.file.path).catch(() => {});
      }

      res.status(500).json({
        success: false,
        message: 'Failed to upload video',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
      });
    }
  }

  /**
   * Get upload progress
   */
  async getUploadProgress(req, res) {
    try {
      const { jobId } = req.params;

      const processingJob = await ProcessingJob.findById(jobId);
      
      if (!processingJob) {
        return res.status(404).json({
          success: false,
          message: 'Processing job not found'
        });
      }

      const video = await Video.findById(processingJob.videoId);
      
      if (!video) {
        return res.status(404).json({
          success: false,
          message: 'Video not found'
        });
      }

      // Calculate overall progress
      const steps = processingJob.steps;
      const totalSteps = Object.keys(steps).length;
      const completedSteps = Object.values(steps).filter(step => step.status === 'completed').length;
      const progressPercentage = Math.round((completedSteps / totalSteps) * 100);

      res.json({
        success: true,
        data: {
          jobId: processingJob._id,
          videoId: video._id,
          title: video.title,
          status: processingJob.status,
          progress: progressPercentage,
          currentStep: processingJob.currentStep,
          steps: processingJob.steps,
          createdAt: processingJob.createdAt,
          updatedAt: processingJob.updatedAt,
          estimatedTimeRemaining: processingJob.estimatedTimeRemaining
        }
      });

    } catch (error) {
      logger.error('Get upload progress error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get upload progress',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
      });
    }
  }

  /**
   * Cancel upload/processing
   */
  async cancelUpload(req, res) {
    try {
      const { jobId } = req.params;

      const processingJob = await ProcessingJob.findById(jobId);
      
      if (!processingJob) {
        return res.status(404).json({
          success: false,
          message: 'Processing job not found'
        });
      }

      // Update job status to cancelled
      processingJob.status = 'cancelled';
      processingJob.cancelledAt = new Date();
      await processingJob.save();

      // Update video status
      const video = await Video.findById(processingJob.videoId);
      if (video) {
        video.status = 'cancelled';
        await video.save();
      }

      // Emit socket event
      const io = req.app.get('io');
      io.to(`video-${processingJob.videoId}`).emit('processing-cancelled', {
        videoId: processingJob.videoId,
        jobId: processingJob._id,
        message: 'Processing cancelled by user'
      });

      logger.info(`Processing cancelled: ${jobId}`);

      res.json({
        success: true,
        message: 'Upload/processing cancelled successfully',
        data: {
          jobId: processingJob._id,
          videoId: processingJob.videoId,
          status: processingJob.status
        }
      });

    } catch (error) {
      logger.error('Cancel upload error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to cancel upload',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
      });
    }
  }

  /**
   * Get upload history
   */
  async getUploadHistory(req, res) {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const skip = (page - 1) * limit;

      const query = {};
      
      // Filter by status if provided
      if (req.query.status) {
        query.status = req.query.status;
      }

      // Filter by date range if provided
      if (req.query.startDate && req.query.endDate) {
        query.uploadedAt = {
          $gte: new Date(req.query.startDate),
          $lte: new Date(req.query.endDate)
        };
      }

      const videos = await Video.find(query)
        .sort({ uploadedAt: -1 })
        .skip(skip)
        .limit(limit)
        .select('title description status uploadedAt fileSize duration thumbnailUrl');

      const total = await Video.countDocuments(query);

      res.json({
        success: true,
        data: {
          videos,
          pagination: {
            currentPage: page,
            totalPages: Math.ceil(total / limit),
            totalItems: total,
            itemsPerPage: limit,
            hasNextPage: page < Math.ceil(total / limit),
            hasPrevPage: page > 1
          }
        }
      });

    } catch (error) {
      logger.error('Get upload history error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get upload history',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
      });
    }
  }
}

module.exports = new UploadController();