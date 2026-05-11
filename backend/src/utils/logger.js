const winston = require('winston');
const path = require('path');

const LOG_FILE = process.env.LOG_FILE || path.join(process.cwd(), 'logs', 'app.log');

const { combine, timestamp, printf, colorize, errors } = winston.format;

const logFormat = printf(({ level, message, timestamp, stack }) => {
  return `${timestamp} [${level.toUpperCase()}] ${stack || message}`;
});

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  format: combine(
    errors({ stack: true }),
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    logFormat
  ),
  transports: [
    new winston.transports.Console({
      format: combine(
        colorize(),
        errors({ stack: true }),
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        logFormat
      )
    }),
    new winston.transports.File({
      filename: LOG_FILE,
      maxsize: 10 * 1024 * 1024, // 10 MB
      maxFiles: 5,
      tailable: true
    })
  ]
});

module.exports = logger;
