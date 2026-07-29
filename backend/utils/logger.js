/**
 * BARBER ENGINE V1  |  backend/utils/logger.js
 * Winston Logger v2 FINAL
 */

import crypto from 'crypto'; // ✅ FIX #2
import { mkdirSync } from 'fs'; // ✅ FIX #4
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import winston from 'winston';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR   = path.join(__dirname, '../logs');
const isDev     = process.env.NODE_ENV !== 'production';

mkdirSync(LOG_DIR, { recursive: true });     // ✅ FIX #4

// ─── Levels ────────────────────────────────────────────────────────
const LEVELS = {
  levels: { fatal:0, error:1, warn:2, info:3, http:4, debug:5 },
  colors: { fatal:'red', error:'red', warn:'yellow',
            info:'green', http:'cyan', debug:'white' },
};
winston.addColors(LEVELS.colors);

// ─── Base Metadata ─────────────────────────────────────────────────
const BASE_META = {
  service:     process.env.SERVICE_NAME || 'barber-engine-admin',
  environment: process.env.NODE_ENV     || 'development',
  hostname:    os.hostname(),
  pid:         process.pid,
  nodeVersion: process.version,             // ✅ FIX #6
};

// ─── Formats ───────────────────────────────────────────────────────
const { combine, timestamp, json,
        colorize, printf, errors, metadata } = winston.format;

const devFormat = combine(
  colorize({ all: true }),
  timestamp({ format: 'HH:mm:ss' }),
  errors({ stack: true }),
  printf(({ level, message, timestamp, stack, metadata: m }) => {
    const ms = m && Object.keys(m).length ? ' ' + JSON.stringify(m) : '';
    return `[${timestamp}] ${level}: ${message}${ms}`
         + (stack ? '\n' + stack : '');
  })
);

const prodFormat = combine(
  timestamp(),
  errors({ stack: true }),
  metadata({ fillExcept: ['message', 'level', 'timestamp', 'stack'] }),
  json()
);

// ─── Transports ────────────────────────────────────────────────────
// File transports now attach in every environment, not just
// production — dev logs were previously silently console-only, with
// nothing on disk to inspect after the fact. Files always use
// prodFormat (JSON) regardless of environment — colorized/ANSI
// devFormat output would look like garbage in a text file.
const transports = [
  new winston.transports.Console({
    format: isDev ? devFormat : prodFormat,
  }),
  new winston.transports.File({
    level:    'error',
    filename: path.join(LOG_DIR, 'error.log'),
    format:   prodFormat,
    maxsize:  10 * 1024 * 1024,
    maxFiles: 14,
  }),
  new winston.transports.File({
    filename: path.join(LOG_DIR, 'combined.log'),
    format:   prodFormat,
    maxsize:  20 * 1024 * 1024,
    maxFiles: 14,
  }),
];

// ─── Logger Instance ───────────────────────────────────────────────
const logger = winston.createLogger({
  levels:      LEVELS.levels,
  level:       isDev ? 'debug' : 'info',
  defaultMeta: BASE_META,
  transports,
  exitOnError: false,

  exceptionHandlers: [
    new winston.transports.Console({ format: isDev ? devFormat : prodFormat }),
    new winston.transports.File({
      filename: path.join(LOG_DIR, 'exceptions.log'),
      format:   prodFormat,
    }),
  ],

  rejectionHandlers: [
    new winston.transports.Console({ format: isDev ? devFormat : prodFormat }),
    new winston.transports.File({
      filename: path.join(LOG_DIR, 'rejections.log'),
      format:   prodFormat,
    }),
  ],
});

// ─── HTTP Logger ───────────────────────────────────────────────────
export const httpLogger = (req, res, next) => {
  res.on('finish', () => {
    const duration = req.startTime
      ? Date.now() - req.startTime + 'ms' : 'N/A';

    const ip =
      req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
      req.socket?.remoteAddress ||
      req.ip || 'unknown';

    const meta = {
      requestId:    req.requestId             ?? null,
      method:       req.method,
      url:          req.originalUrl,
      status:       res.statusCode,
      duration,
      ip,
      userId:       req.user?._id             ?? null,
      userAgent:    req.headers['user-agent'] ?? null,
      responseSize: res.getHeader('content-length') ?? null,  // ✅ FIX #5
    };

    if      (res.statusCode >= 500) logger.error('HTTP Request', meta);
    else if (res.statusCode >= 400) logger.warn ('HTTP Request', meta);
    else                            logger.http ('HTTP Request', meta);
  });
  next();
};

// ─── Request Timer ─────────────────────────────────────────────────
export const requestTimer = (req, res, next) => {
  req.requestId = req.requestId ?? crypto.randomUUID();  // ✅ FIX #2
  req.startTime = Date.now();
  res.setHeader('X-Request-Id', req.requestId);

  next();
};

export default logger;