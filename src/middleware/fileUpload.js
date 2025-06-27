const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Storage configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Create subdirectory based on date
    const dateDir = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const fullPath = path.join(uploadsDir, dateDir);
    
    // Ensure directory exists
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
    }
    
    cb(null, fullPath);
  },
  
  filename: (req, file, cb) => {
    // Generate unique filename
    const uniqueId = uuidv4();
    const fileExtension = path.extname(file.originalname).toLowerCase();
    const sanitizedOriginalName = file.originalname
      .replace(/[^a-zA-Z0-9.\-_]/g, '_')
      .replace(/_{2,}/g, '_');
    
    const filename = `${uniqueId}_${Date.now()}_${sanitizedOriginalName}`;
    
    // Store original filename in request for later use
    if (!req.fileMetadata) {
      req.fileMetadata = {};
    }
    req.fileMetadata.originalName = file.originalname;
    req.fileMetadata.generatedName = filename;
    
    cb(null, filename);
  }
});

// File filter function
const fileFilter = (req, file, cb) => {
  // Allowed video MIME types
  const allowedMimeTypes = [
    'video/mp4',
    'video/avi',
    'video/mov',
    'video/quicktime',
    'video/wmv',
    'video/flv',
    'video/webm',
    'video/mkv',
    'video/x-msvideo',
    'video/x-ms-wmv'
  ];

  // Allowed file extensions
  const allowedExtensions = ['.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm', '.mkv'];
  
  // Get file extension
  const fileExtension = path.extname(file.originalname).toLowerCase();
  
  // Check MIME type and extension
  if (allowedMimeTypes.includes(file.mimetype) && allowedExtensions.includes(fileExtension)) {
    cb(null, true);
  } else {
    const error = new Error(`Invalid file type. Allowed formats: ${allowedExtensions.join(', ')}`);
    error.code = 'INVALID_FILE_TYPE';
    cb(error, false);
  }
};

// Multer configuration
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 500 * 1024 * 1024, // 500MB default
    files: 1, // Only allow one file at a time
    fields: 10, // Limit number of non-file fields
    fieldNameSize: 100, // Limit field name size
    fieldSize: 1024 * 1024 // 1MB limit for field values
  }
});

// Single file upload middleware
const uploadSingle = upload.single('video');

// Enhanced upload middleware with additional validation and error handling
const uploadVideo = (req, res, next) => {
  uploadSingle(req, res, (err) => {
    if (err) {
      logger.error('File upload error:', err);
      
      if (err instanceof multer.MulterError) {
        switch (err.code) {
          case 'LIMIT_FILE_SIZE':
            return res.status(400).json({
              success: false,
              message: `File too large. Maximum size allowed is ${Math.round((parseInt(process.env.MAX_FILE_SIZE) || 500 * 1024 * 1024) / (1024 * 1024))}MB`
            });
          
          case 'LIMIT_FILE_COUNT':
            return res.status(400).json({
              success: false,
              message: 'Too many files. Only one video file is allowed.'
            });
          
          case 'LIMIT_UNEXPECTED_FILE':
            return res.status(400).json({
              success: false,
              message: 'Unexpected field name. Use "video" as the field name.'
            });
          
          case 'LIMIT_FIELD_COUNT':
            return res.status(400).json({
              success: false,
              message: 'Too many fields in the request.'
            });
          
          default:
            return res.status(400).json({
              success: false,
              message: 'File upload error',
              error: err.message
            });
        }
      }
      
      if (err.code === 'INVALID_FILE_TYPE') {
        return res.status(400).json({
          success: false,
          message: err.message
        });
      }
      
      return res.status(500).json({
        success: false,
        message: 'Internal server error during file upload'
      });
    }
    
    // Check if file was uploaded
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No video file uploaded. Please select a video file.'
      });
    }
    
    // Add file metadata to request
    req.fileMetadata = {
      ...req.fileMetadata,
      uploadedAt: new Date(),
      fileSize: req.file.size,
      mimeType: req.file.mimetype,
      path: req.file.path,
      filename: req.file.filename
    };
    
    logger.info('File uploaded successfully:', {
      originalName: req.file.originalname,
      filename: req.file.filename,
      size: req.file.size,
      mimeType: req.file.mimetype
    });
    
    next();
  });
};

// Multiple files upload (for future use)
const uploadMultiple = upload.array('videos', 5); // Maximum 5 files

// Middleware for handling multiple file uploads
const uploadMultipleVideos = (req, res, next) => {
  uploadMultiple(req, res, (err) => {
    if (err) {
      logger.error('Multiple file upload error:', err);
      
      if (err instanceof multer.MulterError) {
        switch (err.code) {
          case 'LIMIT_FILE_SIZE':
            return res.status(400).json({
              success: false,
              message: `One or more files are too large. Maximum size allowed per file is ${Math.round((parseInt(process.env.MAX_FILE_SIZE) || 500 * 1024 * 1024) / (1024 * 1024))}MB`
            });
          
          case 'LIMIT_FILE_COUNT':
            return res.status(400).json({
              success: false,
              message: 'Too many files. Maximum 5 video files are allowed.'
            });
          
          default:
            return res.status(400).json({
              success: false,
              message: 'File upload error',
              error: err.message
            });
        }
      }
      
      return res.status(500).json({
        success: false,
        message: 'Internal server error during file upload'
      });
    }
    
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No video files uploaded.'
      });
    }
    
    // Add metadata for all files
    req.filesMetadata = req.files.map(file => ({
      originalName: file.originalname,
      filename: file.filename,
      fileSize: file.size,
      mimeType: file.mimetype,
      path: file.path,
      uploadedAt: new Date()
    }));
    
    logger.info(`${req.files.length} files uploaded successfully`);
    
    next();
  });
};

// Cleanup function to remove uploaded files
const cleanupUploadedFile = (filePath) => {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      logger.info(`Cleaned up file: ${filePath}`);
    }
  } catch (error) {
    logger.error(`Failed to cleanup file ${filePath}:`, error);
  }
};

// Cleanup multiple files
const cleanupUploadedFiles = (filePaths) => {
  filePaths.forEach(filePath => {
    cleanupUploadedFile(filePath);
  });
};

// Middleware to cleanup files on error
const cleanupOnError = (req, res, next) => {
  const originalSend = res.send;
  
  res.send = function(data) {
    // If response is an error and we have uploaded files, clean them up
    if (res.statusCode >= 400) {
      if (req.file) {
        cleanupUploadedFile(req.file.path);
      }
      
      if (req.files && req.files.length > 0) {
        const filePaths = req.files.map(file => file.path);
        cleanupUploadedFiles(filePaths);
      }
    }
    
    originalSend.call(this, data);
  };
  
  next();
};

// Get file info without uploading (for validation)
const getFileInfo = (req, res, next) => {
  if (!req.file) {
    return next();
  }
  
  const fileStats = fs.statSync(req.file.path);
  
  req.fileInfo = {
    originalName: req.file.originalname,
    filename: req.file.filename,
    path: req.file.path,
    size: req.file.size,
    mimeType: req.file.mimetype,
    uploadedAt: new Date(),
    lastModified: fileStats.mtime,
    extension: path.extname(req.file.originalname).toLowerCase()
  };
  
  next();
};

// Improved disk space check middleware
const checkDiskSpace = (req, res, next) => {
  try {
    // Check if uploads directory is accessible
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    
    // Basic accessibility check
    fs.accessSync(uploadsDir, fs.constants.W_OK);
    
    // For a more comprehensive disk space check, you could use:
    // const statvfs = require('statvfs'); // npm install statvfs
    // const stats = statvfs.statvfsSync(uploadsDir);
    // const freeSpace = stats.bavail * stats.frsize;
    // const requiredSpace = parseInt(process.env.MAX_FILE_SIZE) || 500 * 1024 * 1024;
    // 
    // if (freeSpace < requiredSpace) {
    //   return res.status(507).json({
    //     success: false,
    //     message: 'Insufficient storage space available'
    //   });
    // }
    
    next();
  } catch (error) {
    logger.error('Disk space check failed:', error);
    res.status(500).json({
      success: false,
      message: 'Server storage is temporarily unavailable'
    });
  }
};

// Validate video file metadata
const validateVideoFile = (req, res, next) => {
  if (!req.file) {
    return next();
  }
  
  try {
    const fileStats = fs.statSync(req.file.path);
    const maxSize = parseInt(process.env.MAX_FILE_SIZE) || 500 * 1024 * 1024;
    
    // Additional size validation
    if (fileStats.size > maxSize) {
      cleanupUploadedFile(req.file.path);
      return res.status(400).json({
        success: false,
        message: `File size exceeds maximum allowed size of ${Math.round(maxSize / (1024 * 1024))}MB`
      });
    }
    
    // Check if file is actually a video (basic check)
    const allowedExtensions = ['.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm', '.mkv'];
    const fileExtension = path.extname(req.file.originalname).toLowerCase();
    
    if (!allowedExtensions.includes(fileExtension)) {
      cleanupUploadedFile(req.file.path);
      return res.status(400).json({
        success: false,
        message: `Invalid file extension. Allowed: ${allowedExtensions.join(', ')}`
      });
    }
    
    next();
  } catch (error) {
    logger.error('File validation error:', error);
    if (req.file && req.file.path) {
      cleanupUploadedFile(req.file.path);
    }
    res.status(500).json({
      success: false,
      message: 'File validation failed'
    });
  }
};

// Get upload statistics
const getUploadStats = () => {
  try {
    const stats = {
      uploadsDir,
      totalFiles: 0,
      totalSize: 0,
      directories: []
    };
    
    if (fs.existsSync(uploadsDir)) {
      const walkDir = (dir, basePath = '') => {
        const files = fs.readdirSync(dir);
        
        files.forEach(file => {
          const filePath = path.join(dir, file);
          const fileStat = fs.statSync(filePath);
          
          if (fileStat.isDirectory()) {
            stats.directories.push(path.join(basePath, file));
            walkDir(filePath, path.join(basePath, file));
          } else {
            stats.totalFiles++;
            stats.totalSize += fileStat.size;
          }
        });
      };
      
      walkDir(uploadsDir);
    }
    
    return stats;
  } catch (error) {
    logger.error('Error getting upload stats:', error);
    return null;
  }
};

// Clean old uploads (utility function)
const cleanOldUploads = (daysOld = 30) => {
  try {
    if (!fs.existsSync(uploadsDir)) {
      return { success: true, message: 'No uploads directory found', deletedFiles: 0 };
    }
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);
    
    let deletedFiles = 0;
    
    const walkDir = (dir) => {
      const files = fs.readdirSync(dir);
      
      files.forEach(file => {
        const filePath = path.join(dir, file);
        const fileStat = fs.statSync(filePath);
        
        if (fileStat.isDirectory()) {
          walkDir(filePath);
          // Try to remove empty directories
          try {
            fs.rmdirSync(filePath);
          } catch (e) {
            // Directory not empty, ignore
          }
        } else if (fileStat.mtime < cutoffDate) {
          try {
            fs.unlinkSync(filePath);
            deletedFiles++;
            logger.info(`Deleted old file: ${filePath}`);
          } catch (error) {
            logger.error(`Failed to delete old file ${filePath}:`, error);
          }
        }
      });
    };
    
    walkDir(uploadsDir);
    
    return {
      success: true,
      message: `Cleanup completed. Deleted ${deletedFiles} files older than ${daysOld} days.`,
      deletedFiles
    };
  } catch (error) {
    logger.error('Error during cleanup:', error);
    return {
      success: false,
      message: 'Cleanup failed',
      error: error.message,
      deletedFiles: 0
    };
  }
};

module.exports = {
  uploadVideo,
  uploadMultipleVideos,
  cleanupUploadedFile,
  cleanupUploadedFiles,
  cleanupOnError,
  getFileInfo,
  checkDiskSpace,
  validateVideoFile,
  getUploadStats,
  cleanOldUploads,
  // Export the multer instance for custom use
  upload,
  // Export upload directory path
  uploadsDir
};