const Joi = require('joi');
const logger = require('../utils/logger');

/**
 * Generic validation middleware
 * @param {Object} schema - Joi validation schema
 * @param {string} source - Source of data to validate ('body', 'query', 'params')
 */
const validate = (schema, source = 'body') => {
  return (req, res, next) => {
    const dataToValidate = req[source];
    
    const { error, value } = schema.validate(dataToValidate, {
      abortEarly: false, // Collect all errors
      stripUnknown: true, // Remove unknown fields
      convert: true // Convert strings to appropriate types
    });

    if (error) {
      const errorDetails = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message,
        value: detail.context?.value
      }));

      logger.warn('Validation failed:', { 
        source, 
        errors: errorDetails,
        originalData: dataToValidate 
      });

      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errorDetails
      });
    }

    // Replace original data with validated data
    req[source] = value;
    next();
  };
};

// Common validation schemas
const schemas = {
  // Video upload validation
  videoUpload: Joi.object({
    title: Joi.string()
      .trim()
      .min(1)
      .max(200)
      .optional(),
    
    description: Joi.string()
      .trim()
      .max(1000)
      .optional()
      .allow(''),
    
    tags: Joi.array()
      .items(Joi.string().trim().max(50))
      .max(10)
      .optional(),
    
    category: Joi.string()
      .valid('education', 'entertainment', 'business', 'technology', 'health', 'sports', 'news', 'other')
      .default('other'),
    
    isPublic: Joi.boolean()
      .default(false)
  }),

  // Video update validation
  videoUpdate: Joi.object({
    title: Joi.string()
      .trim()
      .min(1)
      .max(200)
      .optional(),
    
    description: Joi.string()
      .trim()
      .max(1000)
      .optional()
      .allow(''),
    
    tags: Joi.array()
      .items(Joi.string().trim().max(50))
      .max(10)
      .optional(),
    
    category: Joi.string()
      .valid('education', 'entertainment', 'business', 'technology', 'health', 'sports', 'news', 'other')
      .optional(),
    
    isPublic: Joi.boolean()
      .optional()
  }),

  // Query parameters for listing videos
  videoQuery: Joi.object({
    page: Joi.number()
      .integer()
      .min(1)
      .default(1),
    
    limit: Joi.number()
      .integer()
      .min(1)
      .max(100)
      .default(10),
    
    status: Joi.string()
      .valid('uploaded', 'processing', 'completed', 'failed', 'cancelled')
      .optional(),
    
    search: Joi.string()
      .trim()
      .max(100)
      .optional(),
    
    startDate: Joi.date()
      .iso()
      .optional(),
    
    endDate: Joi.date()
      .iso()
      .min(Joi.ref('startDate'))
      .optional(),
    
    sortBy: Joi.string()
      .valid('uploadedAt', 'title', 'duration', 'fileSize', 'viewCount', 'createdAt', 'updatedAt')
      .default('uploadedAt'),
    
    sortOrder: Joi.string()
      .valid('asc', 'desc')
      .default('desc'),
    
    category: Joi.string()
      .valid('education', 'entertainment', 'business', 'technology', 'health', 'sports', 'news', 'other')
      .optional(),
    
    isPublic: Joi.boolean()
      .optional()
  }),

  // MongoDB ObjectId validation
  mongoId: Joi.object({
    id: Joi.string()
      .pattern(/^[0-9a-fA-F]{24}$/)
      .required()
      .messages({
        'string.pattern.base': 'Invalid ID format'
      })
  }),

  // Processing job validation
  processingStart: Joi.object({
    videoId: Joi.string()
      .pattern(/^[0-9a-fA-F]{24}$/)
      .required(),
    
    options: Joi.object({
      generateThumbnail: Joi.boolean().default(true),
      extractKeyframes: Joi.boolean().default(false),
      transcriptionLanguage: Joi.string().default('en'),
      summaryLength: Joi.string()
        .valid('short', 'medium', 'long')
        .default('medium'),
      summaryType: Joi.string()
        .valid('bullet_points', 'paragraph', 'key_highlights')
        .default('paragraph')
    }).optional()
  }),

  // Summary generation validation
  summaryGenerate: Joi.object({
    videoId: Joi.string()
      .pattern(/^[0-9a-fA-F]{24}$/)
      .required(),
    
    type: Joi.string()
      .valid('bullet_points', 'paragraph', 'key_highlights', 'detailed')
      .default('paragraph'),
    
    length: Joi.string()
      .valid('short', 'medium', 'long')
      .default('medium'),
    
    language: Joi.string()
      .min(2)
      .max(5)
      .default('en'),
    
    focusAreas: Joi.array()
      .items(Joi.string().trim().max(50))
      .max(5)
      .optional()
  }),

  // User registration validation (for future use)
  userRegister: Joi.object({
    email: Joi.string()
      .email()
      .required()
      .messages({
        'string.email': 'Please provide a valid email address'
      }),
    
    password: Joi.string()
      .min(8)
      .max(128)
      .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
      .required()
      .messages({
        'string.min': 'Password must be at least 8 characters long',
        'string.pattern.base': 'Password must contain at least one lowercase letter, one uppercase letter, and one number'
      }),
    
    firstName: Joi.string()
      .trim()
      .min(1)
      .max(50)
      .required(),
    
    lastName: Joi.string()
      .trim()
      .min(1)
      .max(50)
      .required(),
    
    terms: Joi.boolean()
      .valid(true)
      .required()
      .messages({
        'any.only': 'You must accept the terms and conditions'
      })
  }),

  // User login validation
  userLogin: Joi.object({
    email: Joi.string()
      .email()
      .required(),
    
    password: Joi.string()
      .required()
  }),

  // Password reset validation
  passwordReset: Joi.object({
    email: Joi.string()
      .email()
      .required()
  }),

  // Password update validation
  passwordUpdate: Joi.object({
    currentPassword: Joi.string()
      .required(),
    
    newPassword: Joi.string()
      .min(8)
      .max(128)
      .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
      .required()
      .messages({
        'string.min': 'Password must be at least 8 characters long',
        'string.pattern.base': 'Password must contain at least one lowercase letter, one uppercase letter, and one number'
      })
  }),

  // File upload validation (additional validation beyond multer)
  fileUpload: Joi.object({
    maxFileSize: Joi.number()
      .integer()
      .min(1)
      .default(500 * 1024 * 1024), // 500MB default
    
    allowedFormats: Joi.array()
      .items(Joi.string())
      .default(['mp4', 'avi', 'mov', 'wmv', 'flv', 'webm', 'mkv'])
  })
};

// Specific validation middleware functions
const validateVideoUpload = validate(schemas.videoUpload, 'body');
const validateVideoUpdate = validate(schemas.videoUpdate, 'body');
const validateVideoQuery = validate(schemas.videoQuery, 'query');
const validateMongoId = validate(schemas.mongoId, 'params');
const validateProcessingStart = validate(schemas.processingStart, 'body');
const validateSummaryGenerate = validate(schemas.summaryGenerate, 'body');
const validateUserRegister = validate(schemas.userRegister, 'body');
const validateUserLogin = validate(schemas.userLogin, 'body');
const validatePasswordReset = validate(schemas.passwordReset, 'body');
const validatePasswordUpdate = validate(schemas.passwordUpdate, 'body');

/**
 * Custom validation for file uploads
 */
const validateFileUpload = (options = {}) => {
  const schema = schemas.fileUpload;
  const { error, value } = schema.validate(options);
  
  if (error) {
    throw new Error(`File upload validation error: ${error.details[0].message}`);
  }
  
  return (req, res, next) => {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    const file = req.file;
    const { maxFileSize, allowedFormats } = value;

    // Check file size
    if (file.size > maxFileSize) {
      return res.status(400).json({
        success: false,
        message: `File size exceeds limit of ${Math.round(maxFileSize / (1024 * 1024))}MB`
      });
    }

    // Check file format
    const fileExtension = file.originalname.split('.').pop().toLowerCase();
    if (!allowedFormats.includes(fileExtension)) {
      return res.status(400).json({
        success: false,
        message: `File format not supported. Allowed formats: ${allowedFormats.join(', ')}`
      });
    }

    // Check MIME type
    const allowedMimeTypes = [
      'video/mp4', 'video/avi', 'video/mov', 'video/wmv', 
      'video/flv', 'video/webm', 'video/mkv'
    ];
    
    if (!allowedMimeTypes.includes(file.mimetype)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid file type. Please upload a valid video file.'
      });
    }

    next();
  };
};

/**
 * Sanitize input to prevent XSS and injection attacks
 */
const sanitizeInput = (req, res, next) => {
  const sanitize = (obj) => {
    if (typeof obj === 'string') {
      return obj
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/javascript:/gi, '')
        .replace(/on\w+\s*=/gi, '');
    }
    
    if (Array.isArray(obj)) {
      return obj.map(sanitize);
    }
    
    if (obj && typeof obj === 'object') {
      const sanitized = {};
      for (const [key, value] of Object.entries(obj)) {
        sanitized[key] = sanitize(value);
      }
      return sanitized;
    }
    
    return obj;
  };

  req.body = sanitize(req.body);
  req.query = sanitize(req.query);
  req.params = sanitize(req.params);
  
  next();
};

module.exports = {
  validate,
  schemas,
  validateVideoUpload,
  validateVideoUpdate,
  validateVideoQuery,
  validateMongoId,
  validateProcessingStart,
  validateSummaryGenerate,
  validateUserRegister,
  validateUserLogin,
  validatePasswordReset,
  validatePasswordUpdate,
  validateFileUpload,
  sanitizeInput
};