const cloudinary = require('cloudinary').v2;
const logger = require('../utils/logger');

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

// Test connection
const testCloudinaryConnection = async () => {
  try {
    const result = await cloudinary.api.ping();
    logger.info('✅ Cloudinary connection successful:', result);
    return true;
  } catch (error) {
    logger.error('❌ Cloudinary connection failed:', error.message);
    return false;
  }
};

// Upload video to Cloudinary
const uploadVideo = async (filePath, options = {}) => {
  try {
    const result = await cloudinary.uploader.upload(filePath, {
      resource_type: 'video',
      folder: 'video-summarizer',
      use_filename: true,
      unique_filename: true,
      ...options
    });
    
    logger.info(`✅ Video uploaded to Cloudinary: ${result.public_id}`);
    return result;
  } catch (error) {
    logger.error('❌ Cloudinary upload failed:', error.message);
    throw error;
  }
};

// Delete video from Cloudinary
const deleteVideo = async (publicId) => {
  try {
    const result = await cloudinary.uploader.destroy(publicId, {
      resource_type: 'video'
    });
    
    logger.info(`✅ Video deleted from Cloudinary: ${publicId}`);
    return result;
  } catch (error) {
    logger.error('❌ Cloudinary delete failed:', error.message);
    throw error;
  }
};

// Generate video thumbnail
const generateThumbnail = async (publicId, options = {}) => {
  try {
    const thumbnailUrl = cloudinary.url(publicId, {
      resource_type: 'video',
      format: 'jpg',
      quality: 'auto',
      width: 640,
      height: 360,
      crop: 'fill',
      ...options
    });
    
    return thumbnailUrl;
  } catch (error) {
    logger.error('❌ Thumbnail generation failed:', error.message);
    throw error;
  }
};

// Get video info
const getVideoInfo = async (publicId) => {
  try {
    const result = await cloudinary.api.resource(publicId, {
      resource_type: 'video'
    });
    
    return result;
  } catch (error) {
    logger.error('❌ Get video info failed:', error.message);
    throw error;
  }
};

module.exports = {
  cloudinary,
  testCloudinaryConnection,
  uploadVideo,
  deleteVideo,
  generateThumbnail,
  getVideoInfo
};