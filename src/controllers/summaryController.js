const Summary = require('../models/Summary');
const Video = require('../models/Video');
const { generateSummary } = require('../services/summarizationService');
const { addToSummarizationQueue } = require('../services/queueService');
const logger = require('../utils/logger');
const { validateObjectId } = require('../utils/validators');

class SummaryController {
  /**
   * Get summary by video ID
   */
  async getSummaryByVideoId(req, res) {
    try {
      const { id } = req.params;

      // Validate ObjectId
      if (!validateObjectId(id)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid video ID format'
        });
      }

      const video = await Video.findById(id).select('title status transcriptionUrl').lean();
      
      if (!video) {
        return res.status(404).json({
          success: false,
          message: 'Video not found'
        });
      }

      const summary = await Summary.findOne({ videoId: id }).lean();
      
      if (!summary) {
        return res.status(404).json({
          success: false,
          message: 'Summary not found for this video'
        });
      }

      res.json({
        success: true,
        data: {
          summary: {
            _id: summary._id,
            videoId: summary.videoId,
            content: summary.content,
            keyPoints: summary.keyPoints,
            tags: summary.tags,
            sentiment: summary.sentiment,
            wordCount: summary.wordCount,
            readingTime: summary.readingTime,
            confidence: summary.confidence,
            model: summary.model,
            version: summary.version,
            createdAt: summary.createdAt,
            updatedAt: summary.updatedAt
          },
          video: {
            title: video.title,
            status: video.status,
            hasTranscription: !!video.transcriptionUrl
          }
        }
      });

    } catch (error) {
      logger.error('Get summary error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve summary',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
      });
    }
  }

  /**
   * Generate new summary or regenerate existing one
   */
  async generateSummaryForVideo(req, res) {
    try {
      const { id } = req.params;
      const { 
        summaryType = 'detailed', 
        maxLength = 500, 
        includeKeyPoints = true,
        includeTimestamps = false,
        customPrompt 
      } = req.body;

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

      // Check if video has transcription
      if (!video.transcriptionUrl && !video.transcriptionText) {
        return res.status(400).json({
          success: false,
          message: 'Video must have transcription before generating summary'
        });
      }

      // Check if video processing is complete
      if (video.status === 'processing') {
        return res.status(400).json({
          success: false,
          message: 'Cannot generate summary while video is still processing'
        });
      }

      // Check if summary already exists
      const existingSummary = await Summary.findOne({ videoId: id });
      
      if (existingSummary && !req.body.regenerate) {
        return res.status(400).json({
          success: false,
          message: 'Summary already exists. Use regenerate=true to create a new one.'
        });
      }

      // Add to summarization queue
      const jobData = {
        videoId: id,
        summaryType,
        maxLength,
        includeKeyPoints,
        includeTimestamps,
        customPrompt,
        regenerate: req.body.regenerate || false
      };

      await addToSummarizationQueue(id, jobData);

      // Emit socket event
      const io = req.app.get('io');
      io.to(`video-${id}`).emit('summary-generation-started', {
        videoId: id,
        message: existingSummary ? 'Summary regeneration started' : 'Summary generation started'
      });

      logger.info(`Summary generation started for video: ${id}`);

      res.json({
        success: true,
        message: existingSummary ? 'Summary regeneration started' : 'Summary generation started',
        data: {
          videoId: id,
          summaryType,
          maxLength,
          includeKeyPoints,
          includeTimestamps,
          regenerate: req.body.regenerate || false,
          estimatedTime: '2-5 minutes'
        }
      });

    } catch (error) {
      logger.error('Generate summary error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to start summary generation',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
      });
    }
  }

  /**
   * Regenerate existing summary
   */
  async regenerateSummary(req, res) {
    try {
      const { id } = req.params;

      // Validate ObjectId
      if (!validateObjectId(id)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid video ID format'
        });
      }

      const existingSummary = await Summary.findOne({ videoId: id });
      
      if (!existingSummary) {
        return res.status(404).json({
          success: false,
          message: 'No existing summary found to regenerate'
        });
      }

      // Set regenerate flag and call generate method
      req.body.regenerate = true;
      return this.generateSummaryForVideo(req, res);

    } catch (error) {
      logger.error('Regenerate summary error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to regenerate summary',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
      });
    }
  }

  /**
   * Update summary metadata
   */
  async updateSummary(req, res) {
    try {
      const { id } = req.params;
      const { tags, isPublic, customTitle } = req.body;

      // Validate ObjectId
      if (!validateObjectId(id)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid summary ID format'
        });
      }

      const summary = await Summary.findById(id);
      
      if (!summary) {
        return res.status(404).json({
          success: false,
          message: 'Summary not found'
        });
      }

      // Update fields if provided
      if (tags !== undefined) summary.tags = tags;
      if (isPublic !== undefined) summary.isPublic = isPublic;
      if (customTitle !== undefined) summary.customTitle = customTitle;

      summary.updatedAt = new Date();
      
      await summary.save();

      logger.info(`Summary updated: ${id}`);

      res.json({
        success: true,
        message: 'Summary updated successfully',
        data: {
          summaryId: summary._id,
          videoId: summary.videoId,
          tags: summary.tags,
          isPublic: summary.isPublic,
          customTitle: summary.customTitle,
          updatedAt: summary.updatedAt
        }
      });

    } catch (error) {
      logger.error('Update summary error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update summary',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
      });
    }
  }

  /**
   * Delete summary
   */
  async deleteSummary(req, res) {
    try {
      const { id } = req.params;

      // Validate ObjectId
      if (!validateObjectId(id)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid summary ID format'
        });
      }

      const summary = await Summary.findById(id);
      
      if (!summary) {
        return res.status(404).json({
          success: false,
          message: 'Summary not found'
        });
      }

      await Summary.findByIdAndDelete(id);

      // Emit socket event
      const io = req.app.get('io');
      io.to(`video-${summary.videoId}`).emit('summary-deleted', {
        videoId: summary.videoId,
        summaryId: id,
        message: 'Summary deleted'
      });

      logger.info(`Summary deleted: ${id}`);

      res.json({
        success: true,
        message: 'Summary deleted successfully',
        data: {
          deletedSummaryId: id,
          videoId: summary.videoId
        }
      });

    } catch (error) {
      logger.error('Delete summary error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to delete summary',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
      });
    }
  }

  /**
   * Get multiple summaries with filtering and pagination
   */
  async getAllSummaries(req, res) {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const skip = (page - 1) * limit;

      const query = {};
      
      // Filter by tags
      if (req.query.tags) {
        const tags = req.query.tags.split(',').map(tag => tag.trim());
        query.tags = { $in: tags };
      }

      // Filter by sentiment
      if (req.query.sentiment) {
        query.sentiment = req.query.sentiment;
      }

      // Filter by public status
      if (req.query.isPublic !== undefined) {
        query.isPublic = req.query.isPublic === 'true';
      }

      // Filter by date range
      if (req.query.startDate && req.query.endDate) {
        query.createdAt = {
          $gte: new Date(req.query.startDate),
          $lte: new Date(req.query.endDate)
        };
      }

      // Search in content
      if (req.query.search) {
        query.$or = [
          { content: { $regex: req.query.search, $options: 'i' } },
          { keyPoints: { $regex: req.query.search, $options: 'i' } },
          { tags: { $regex: req.query.search, $options: 'i' } }
        ];
      }

      const summaries = await Summary.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('videoId', 'title duration thumbnailUrl')
        .lean();

      const total = await Summary.countDocuments(query);

      res.json({
        success: true,
        data: {
          summaries,
          pagination: {
            currentPage: page,
            totalPages: Math.ceil(total / limit),
            totalItems: total,
            itemsPerPage: limit,
            hasNextPage: page < Math.ceil(total / limit),
            hasPrevPage: page > 1
          },
          filters: {
            tags: req.query.tags,
            sentiment: req.query.sentiment,
            isPublic: req.query.isPublic,
            search: req.query.search,
            startDate: req.query.startDate,
            endDate: req.query.endDate
          }
        }
      });

    } catch (error) {
      logger.error('Get all summaries error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve summaries',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
      });
    }
  }

  /**
   * Get summary statistics
   */
  async getSummaryStats(req, res) {
    try {
      const { id } = req.params;

      // Validate ObjectId
      if (!validateObjectId(id)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid summary ID format'
        });
      }

      const summary = await Summary.findById(id).lean();
      
      if (!summary) {
        return res.status(404).json({
          success: false,
          message: 'Summary not found'
        });
      }

      const stats = {
        summaryId: summary._id,
        videoId: summary.videoId,
        wordCount: summary.wordCount,
        readingTime: summary.readingTime,
        keyPointsCount: summary.keyPoints ? summary.keyPoints.length : 0,
        tagsCount: summary.tags ? summary.tags.length : 0,
        sentiment: summary.sentiment,
        confidence: summary.confidence,
        model: summary.model,
        version: summary.version,
        createdAt: summary.createdAt,
        charactersCount: summary.content ? summary.content.length : 0,
        avgWordsPerSentence: summary.content ? 
          Math.round(summary.wordCount / (summary.content.split('.').length - 1)) : 0
      };

      res.json({
        success: true,
        data: stats
      });

    } catch (error) {
      logger.error('Get summary stats error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve summary statistics',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
      });
    }
  }

  /**
   * Export summary in different formats
   */
  async exportSummary(req, res) {
    try {
      const { id } = req.params;
      const { format = 'json' } = req.query;

      // Validate ObjectId
      if (!validateObjectId(id)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid summary ID format'
        });
      }

      const summary = await Summary.findById(id)
        .populate('videoId', 'title duration originalFilename')
        .lean();
      
      if (!summary) {
        return res.status(404).json({
          success: false,
          message: 'Summary not found'
        });
      }

      const exportData = {
        summary: {
          content: summary.content,
          keyPoints: summary.keyPoints,
          tags: summary.tags,
          sentiment: summary.sentiment,
          wordCount: summary.wordCount,
          readingTime: summary.readingTime,
          confidence: summary.confidence
        },
        video: {
          title: summary.videoId?.title,
          duration: summary.videoId?.duration,
          originalFilename: summary.videoId?.originalFilename
        },
        metadata: {
          model: summary.model,
          version: summary.version,
          createdAt: summary.createdAt,
          exportedAt: new Date().toISOString()
        }
      };

      switch (format.toLowerCase()) {
        case 'json':
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Content-Disposition', `attachment; filename="summary-${id}.json"`);
          res.json(exportData);
          break;

        case 'txt':
          let textContent = `Summary for: ${exportData.video.title}\n`;
          textContent += `Generated: ${exportData.metadata.createdAt}\n\n`;
          textContent += `${exportData.summary.content}\n\n`;
          
          if (exportData.summary.keyPoints && exportData.summary.keyPoints.length > 0) {
            textContent += `Key Points:\n`;
            exportData.summary.keyPoints.forEach((point, index) => {
              textContent += `${index + 1}. ${point}\n`;
            });
          }

          res.setHeader('Content-Type', 'text/plain');
          res.setHeader('Content-Disposition', `attachment; filename="summary-${id}.txt"`);
          res.send(textContent);
          break;

        case 'md':
          let markdownContent = `# Summary: ${exportData.video.title}\n\n`;
          markdownContent += `**Generated:** ${exportData.metadata.createdAt}  \n`;
          markdownContent += `**Duration:** ${exportData.video.duration || 'N/A'}  \n`;
          markdownContent += `**Word Count:** ${exportData.summary.wordCount}  \n`;
          markdownContent += `**Reading Time:** ${exportData.summary.readingTime} minutes  \n\n`;
          markdownContent += `## Summary\n\n${exportData.summary.content}\n\n`;
          
          if (exportData.summary.keyPoints && exportData.summary.keyPoints.length > 0) {
            markdownContent += `## Key Points\n\n`;
            exportData.summary.keyPoints.forEach(point => {
              markdownContent += `- ${point}\n`;
            });
          }

          if (exportData.summary.tags && exportData.summary.tags.length > 0) {
            markdownContent += `\n## Tags\n\n`;
            markdownContent += exportData.summary.tags.map(tag => `\`${tag}\``).join(', ');
          }

          res.setHeader('Content-Type', 'text/markdown');
          res.setHeader('Content-Disposition', `attachment; filename="summary-${id}.md"`);
          res.send(markdownContent);
          break;

        default:
          return res.status(400).json({
            success: false,
            message: 'Invalid format. Supported formats: json, txt, md'
          });
      }

      logger.info(`Summary exported: ${id}, format: ${format}`);

    } catch (error) {
      logger.error('Export summary error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to export summary',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
      });
    }
  }
}

module.exports = new SummaryController();