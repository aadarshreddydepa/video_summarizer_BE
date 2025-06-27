const redis = require('redis');
const logger = require('../utils/logger');

let redisClient = null;

const connectRedis = async () => {
  try {
    redisClient = redis.createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379'
    });

    redisClient.on('error', (err) => {
      logger.error('Redis Client Error:', err);
    });

    redisClient.on('connect', () => {
      logger.info('✅ Redis Client Connected');
    });

    redisClient.on('ready', () => {
      logger.info('✅ Redis Client Ready');
    });

    redisClient.on('end', () => {
      logger.warn('Redis Client Disconnected');
    });

    await redisClient.connect();
    
    // Test the connection
    await redisClient.ping();
    logger.info('✅ Redis connection test successful');

  } catch (error) {
    logger.error('❌ Redis connection failed:', error.message);
    // Don't exit process - Redis is optional for development
    if (process.env.NODE_ENV === 'production') {
      process.exit(1);
    }
  }
};

const getRedisClient = () => {
  if (!redisClient) {
    logger.warn('Redis client not initialized');
    return null;
  }
  return redisClient;
};

const disconnectRedis = async () => {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
    logger.info('Redis connection closed');
  }
};

module.exports = {
  connectRedis,
  getRedisClient,
  disconnectRedis
};