// Database configuration file
module.exports = {
  development: {
    host: 'localhost',
    port: 5432,
    database: 'claude_recall_dev',
    username: 'dev_user',
    password: 'dev_password'
  },
  production: {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    username: process.env.DB_USER,
    password: process.env.DB_PASSWORD
  }
};