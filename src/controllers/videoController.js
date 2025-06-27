const Video = require('../models/Video');
const Summary = require('../models/Summary');
const ProcessingJob = require('../models/ProcessingJob');
const { deleteFromCloudinary } = require('../services/storageService');
const logger = require('../utils/logger');
const { validateObjectId } = require('../utils/validators');

class VideoController {
  /**
   * Get all videos with pagination and filtering
   */
  async getAllVideos(req, res) {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const skip = (page - 1) * limit;

      // Build query object
      const query = {};
      
      // Filter by status
      if (req.query.status) {
        query.status = req.query.status;
      }

      // Search by title or description
      if (req.query.search) {
        query.$or = [
          { title: { $regex: req.query.search, $options: 'i' } },
          { description: { $regex: req.query.search, $options: 'i' } }
        ];
      }

      // Filter by date range
      if (req.query.startDate && req.query.endDate) {
        query.uploadedAt = {
          $gte: new Date(req.query.startDate),
          $lte: new Date(req.query.endDate)
        };
      }

      // Sort options
      const sortOptions = {};
      const sortBy = req.query.sortBy || 'uploadedAt';
      const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
      sortOptions[sortBy] = sortOrder;

      // Execute query
      const videos = await Video.find(query)
        .sort(sortOptions)
        .skip(skip)
        .limit(limit)
        .select('-__v -localPath')
        .lean();

      const total = await Video.countDocuments(query);

      // Get processing status for each video
      const videosWithStatus = await Promise.all(
        videos.map(async (video) => {
          const processingJob = await ProcessingJob.findOne({ videoId: video._id })
            .select('status currentStep')
            .lean();
          
          return {
            ...video,
            processingStatus: processingJob?.status || 'unknown',
            currentStep: processingJob?.currentStep || null
          };
        })
      );

      res.json({
        success: true,
        data: {
          videos: videosWithStatus,
          pagination: {
            currentPage: page,
            totalPages: Math.ceil(total / limit),
            totalItems: total,
            itemsPerPage: limit,
            hasNextPage: page < Math.ceil(total / limit),
            hasPrevPage: page > 1
          },
          filters: {
            status: req.query.status,
            search: req.query.search,
            startDate: req.query.startDate,
            endDate: req.query.endDate,
            sortBy,
            sortOrder: req.query.sortOrder
          }
        }
      });

    } catch (error) {
      logger.error('Get all videos error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve videos',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
      });
    }
  }

  /**
   * Get video by ID
   */
  async getVideoById(req, res) {
    try {
      const { id } = req.params;

      // Validate ObjectId
      if (!validateObjectId(id)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid video ID format'
        });
      }

      const video = await Video.findById(id).select('-__v -localPath').lean();
      
      if (!video) {
        return res.status(404).json({
          success: false,
          message: 'Video not found'
        });
      }

      // Get processing job details
      const processingJob = await ProcessingJob.findOne({ videoId: id }).lean();
      
      // Get summary if available
      const summary = await Summary.findOne({ videoId: id }).lean();

      // Increment view count
      await Video.findByIdAndUpdate(id, { $inc: { viewCount: 1 } });

      res.json({
        success: true,
        data: {
          video: {
            ...video,
            viewCount: video.viewCount + 1
          },
          processingJob,
          summary,
          hasTranscription: video.transcriptionUrl ? true : false,
          hasSummary: summary ? true : false
        }
      });

    } catch (error) {
      logger.error('Get video by ID error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve video',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
      });
    }
  }

  /**
   * Update video metadata
   */
  async updateVideo(req, res) {
    try {
      const { id } = req.params;
      const { title, description, tags } = req.body;

      // Validate ObjectId
      if (!validateObjectId(id)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid video ID format'
        });
      }

      const video = await Video.findById(id);
      
      if (!video) {
        return res.status(404).json({
          success: false,
          message: 'Video not found'
        });
      }

      // Update fields if provided
      if (title !== undefined) video.title = title;
      if (description !== undefined) video.description = description;
      if (tags !== undefined) video.tags = tags;

      video.updatedAt = new Date();
      
      await video.save();

      logger.info(`Video updated: ${id}`);

      res.json({
        success: true,
        message: 'Video updated successfully',
        data: {
          video: {
            _id: video._id,
            title: video.title,
            description: video.description,
            tags: video.tags,
            updatedAt: video.updatedAt
          }
        }
      });

    } catch (error) {
      logger.error('Update video error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update video',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
      });
    }
  }

  /**
   * Delete video
   */
  async deleteVideo(req, res) {
    try {
      const { id } = req.params;

      // Validate ObjectId
      if (!validateObjectId(id)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid video ID format'
        });
      }

      const video = await Video.findById(id);
      
      if (!video) {
        return res.status(404).json({
          success: false,
          message: 'Video not found'
        });
      }

      // Delete from Cloudinary if uploaded
      if (video.cloudinaryPublicId) {
        try {
          await deleteFromCloudinary(video.cloudinaryPublicId, 'video');
        } catch (cloudinaryError) {
          logger.warn(`Failed to delete video from Cloudinary: ${cloudinaryError.message}`);
        }
      }

      // Delete thumbnail from Cloudinary if exists
      if (video.thumbnailPublicId) {
        try {
          await deleteFromCloudinary(video.thumbnailPublicId, 'image');
        } catch (cloudinaryError) {
          logger.warn(`Failed to delete thumbnail from Cloudinary: ${cloudinaryError.message}`);
        }
      }

      // Delete related records
      await Promise.all([
        Summary.deleteMany({ videoId: id }),
        ProcessingJob.deleteMany({ videoId: id }),
        Video.findByIdAndDelete(id)
      ]);

      // Emit socket event
      const io = req.app.get('io');
      io.emit('video-deleted', {
        videoId: id,
        message: 'Video deleted successfully'
      });

      logger.info(`Video deleted: ${id}`);

      res.json({
        success: true,
        message: 'Video deleted successfully',
        data: {
          deletedVideoId: id
        }
      });

    } catch (error) {
      logger.error('Delete video error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to delete video',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
      });
    }
  }

  /**
   * Get video statistics
   */
  async getVideoStats(req, res) {
    try {
      const { id } = req.params;

      // Validate ObjectId
      if (!validateObjectId(id)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid video ID format'
        });
      }

      const video = await Video.findById(id).lean();
      
      if (!video) {
        return res.status(404).json({
          success: false,
          message: 'Video not found'
        });
      }

      // Get processing job for processing stats
      const processingJob = await ProcessingJob.findOne({ videoId: id }).lean();

      // Calculate processing time if completed
      let processingTime = null;
      if (processingJob && processingJob.completedAt && processingJob.createdAt) {
        processingTime = processingJob.completedAt - processingJob.createdAt;
      }

      const stats = {
        videoId: id,
        title: video.title,
        uploadedAt: video.uploadedAt,
        fileSize: video.fileSize,
        duration: video.duration,
        viewCount: video.viewCount || 0,
        status: video.status,
        processingTime,
        hasTranscription: !!video.transcriptionUrl,
        hasSummary: !!(await Summary.findOne({ videoId: id })),
        transcriptionWordCount: video.transcriptionWordCount || 0,
        quality: video.quality || 'unknown',
        format: video.mimeType
      };

      res.json({
        success: true,
        data: stats
      });

    } catch (error) {
      logger.error('Get video stats error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve video statistics',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
      });
    }
  }

  /**
   * Get videos by status
   */
  async getVideosByStatus(req, res) {
    try {
      const { status } = req.params;
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const skip = (page - 1) * limit;

      const validStatuses = ['uploaded', 'processing', 'completed', 'failed', 'cancelled'];
      
      if (!validStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          message: `Invalid status. Valid statuses are: ${validStatuses.join(', ')}`
        });
      }

      const videos = await Video.find({ status })
        .sort({ uploadedAt: -1 })
        .skip(skip)
        .limit(limit)
        .select('-__v -localPath')
        .lean();

      const total = await Video.countDocuments({ status });

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
          },
          status
        }
      });

    } catch (error) {
      logger.error('Get videos by status error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve videos by status',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
      });
    }
  }
}

module.exports = new VideoController();