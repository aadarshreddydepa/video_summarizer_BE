const ProcessingJob = require('../models/ProcessingJob');
const Video = require('../models/Video');
const { addToProcessingQueue, getQueueStats } = require('../services/queueService');
const { restartProcessing } = require('../services/videoProcessor');
const logger = require('../utils/logger');
const { validateObjectId } = require('../utils/validators');

class ProcessingController {
  /**
   * Get processing status by job ID
   */
  async getProcessingStatus(req, res) {
    try {
      const { id } = req.params;

      // Validate ObjectId
      if (!validateObjectId(id)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid processing job ID format'
        });
      }

      const processingJob = await ProcessingJob.findById(id).lean();
      
      if (!processingJob) {
        return res.status(404).json({
          success: false,
          message: 'Processing job not found'
        });
      }

      // Get video details
      const video = await Video.findById(processingJob.videoId)
        .select('title status duration fileSize')
        .lean();

      // Calculate progress percentage
      const steps = processingJob.steps;
      const totalSteps = Object.keys(steps).length;
      const completedSteps = Object.values(steps).filter(step => step.status === 'completed').length;
      const failedSteps = Object.values(steps).filter(step => step.status === 'failed').length;
      const progressPercentage = Math.round((completedSteps / totalSteps) * 100);

      // Calculate estimated time remaining
      let estimatedTimeRemaining = null;
      if (processingJob.startedAt && completedSteps > 0 && completedSteps < totalSteps) {
        const elapsedTime = new Date() - new Date(processingJob.startedAt);
        const averageTimePerStep = elapsedTime / completedSteps;
        const remainingSteps = totalSteps - completedSteps;
        estimatedTimeRemaining = Math.round(averageTimePerStep * remainingSteps / 1000); // in seconds
      }

      res.json({
        success: true,
        data: {
          jobId: processingJob._id,
          videoId: processingJob.videoId,
          video: video ? {
            title: video.title,
            status: video.status,
            duration: video.duration,
            fileSize: video.fileSize
          } : null,
          status: processingJob.status,
          currentStep: processingJob.currentStep,
          progress: progressPercentage,
          steps: processingJob.steps,
          totalSteps,
          completedSteps,
          failedSteps,
          estimatedTimeRemaining,
          startedAt: processingJob.startedAt,
          completedAt: processingJob.completedAt,
          createdAt: processingJob.createdAt,
          updatedAt: processingJob.updatedAt,
          errorMessage: processingJob.errorMessage,
          retryCount: processingJob.retryCount || 0
        }
      });

    } catch (error) {
      logger.error('Get processing status error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get processing status',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
      });
    }
  }

  /**
   * Start processing for a video
   */
  async startProcessing(req, res) {
    try {
      const { videoId } = req.params;
      const { forceRestart = false } = req.body;

      // Validate ObjectId
      if (!validateObjectId(videoId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid video ID format'
        });
      }

      const video = await Video.findById(videoId);
      
      if (!video) {
        return res.status(404).json({
          success: false,
          message: 'Video not found'
        });
      }

      // Check if processing job already exists
      let processingJob = await ProcessingJob.findOne({ videoId });
      
      if (processingJob && !forceRestart) {
        if (processingJob.status === 'processing') {
          return res.status(400).json({
            success: false,
            message: 'Video is already being processed'
          });
        }
        
        if (processingJob.status === 'completed') {
          return res.status(400).json({
            success: false,
            message: 'Video has already been processed. Use forceRestart=true to reprocess.'
          });
        }
      }

      // Create new processing job or reset existing one
      if (!processingJob || forceRestart) {
        if (processingJob) {
          await ProcessingJob.findByIdAndDelete(processingJob._id);
        }

        processingJob = new ProcessingJob({
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
      }

      // Update video status
      video.status = 'processing';
      await video.save();

      // Add to processing queue
      await addToProcessingQueue(videoId, {
        videoPath: video.localPath,
        videoId: videoId,
        forceRestart
      });

      // Emit socket event
      const io = req.app.get('io');
      io.to(`video-${videoId}`).emit('processing-started', {
        videoId,
        jobId: processingJob._id,
        status: 'processing',
        message: forceRestart ? 'Processing restarted' : 'Processing started'
      });

      logger.info(`Processing started for video: ${videoId}`);

      res.json({
        success: true,
        message: forceRestart ? 'Processing restarted successfully' : 'Processing started successfully',
        data: {
          jobId: processingJob._id,
          videoId,
          status: processingJob.status,
          forceRestart
        }
      });

    } catch (error) {
      logger.error('Start processing error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to start processing',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
      });
    }
  }

  /**
   * Cancel processing
   */
  async cancelProcessing(req, res) {
    try {
      const { id } = req.params;

      // Validate ObjectId
      if (!validateObjectId(id)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid processing job ID format'
        });
      }

      const processingJob = await ProcessingJob.findById(id);
      
      if (!processingJob) {
        return res.status(404).json({
          success: false,
          message: 'Processing job not found'
        });
      }

      if (processingJob.status === 'completed') {
        return res.status(400).json({
          success: false,
          message: 'Cannot cancel completed processing job'
        });
      }

      if (processingJob.status === 'cancelled') {
        return res.status(400).json({
          success: false,
          message: 'Processing job is already cancelled'
        });
      }

      // Update job status
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
        message: 'Processing cancelled'
      });

      logger.info(`Processing cancelled: ${id}`);

      res.json({
        success: true,
        message: 'Processing cancelled successfully',
        data: {
          jobId: processingJob._id,
          videoId: processingJob.videoId,
          status: processingJob.status
        }
      });

    } catch (error) {
      logger.error('Cancel processing error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to cancel processing',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
      });
    }
  }
}