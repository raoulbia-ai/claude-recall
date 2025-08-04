// Redis configuration
module.exports = {
  development: {
    host: 'localhost',
    port: 6379,
    password: null,
    db: 0,
    retryDelayOnFailover: 100,
    enableReadyCheck: false,
    maxRetriesPerRequest: null,
  },
  production: {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD,
    db: process.env.REDIS_DB || 0,
    tls: process.env.REDIS_TLS === 'true' ? {} : undefined,
  },
  test: {
    host: 'localhost',
    port: 6379,
    db: 1, // Use different DB for tests
  }
};