import pino, { Logger as PinoLogger, LoggerOptions } from 'pino';
import { randomUUID } from 'crypto';

// Redact sensitive fields from logs
const SENSITIVE_FIELDS = [
  'password',
  'secret',
  'token',
  'apiKey',
  'api_key',
  'authorization',
  'cookie',
  'session',
  'DATABASE_URL',
  'DEEPGRAM_API_KEY',
  'GROQ_API_KEY',
  'MEDIA_SERVER_WEBHOOK_SECRET',
];

export interface LogContext {
  requestId?: string;
  userId?: string;
  videoId?: string;
  jobId?: string;
  workerId?: string;
  [key: string]: string | number | boolean | undefined;
}

export interface LoggerConfig {
  name: string;
  level?: 'trace' | 'debug' | 'info' | 'warn' | 'error';
  pretty?: boolean;
  version?: string;
}

export class Logger {
  private logger: PinoLogger;
  private context: LogContext = {};

  constructor(config: LoggerConfig) {
    const options: LoggerOptions = {
      name: config.name,
      level: config.level || process.env.LOG_LEVEL || 'info',
      base: {
        pid: process.pid,
        service: config.name,
        version: config.version || process.env.npm_package_version || '0.1.0',
        env: process.env.NODE_ENV || 'development',
      },
      redact: {
        paths: SENSITIVE_FIELDS,
        remove: true,
      },
      timestamp: pino.stdTimeFunctions.isoTime,
    };

    if (config.pretty || process.env.LOG_PRETTY === 'true') {
      options.transport = {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss Z',
          ignore: 'pid,hostname',
        },
      };
    }

    this.logger = pino(options);
  }

  /**
   * Create a child logger with additional context
   */
  withContext(context: LogContext): Logger {
    const child = new Logger({
      name: this.logger.bindings().service as string,
      level: this.logger.level as LoggerConfig['level'],
    });
    child.context = { ...this.context, ...context };
    child.logger = this.logger.child(child.context);
    return child;
  }

  /**
   * Generate a new request ID
   */
  static generateRequestId(): string {
    return randomUUID();
  }

  /**
   * Log at trace level
   */
  trace(msg: string, meta?: Record<string, unknown>): void {
    this.logger.trace(meta || {}, msg);
  }

  /**
   * Log at debug level
   */
  debug(msg: string, meta?: Record<string, unknown>): void {
    this.logger.debug(meta || {}, msg);
  }

  /**
   * Log at info level
   */
  info(msg: string, meta?: Record<string, unknown>): void {
    this.logger.info(meta || {}, msg);
  }

  /**
   * Log at warn level
   */
  warn(msg: string, meta?: Record<string, unknown>): void {
    this.logger.warn(meta || {}, msg);
  }

  /**
   * Log at error level
   */
  error(msg: string, error?: Error, meta?: Record<string, unknown>): void {
    const errorMeta = error
      ? {
          error: {
            message: error.message,
            name: error.name,
            stack: error.stack,
          },
          ...meta,
        }
      : meta;
    this.logger.error(errorMeta || {}, msg);
  }

  /**
   * Log a request/response cycle
   */
  logRequest(meta: {
    method: string;
    path: string;
    statusCode?: number;
    durationMs?: number;
    userAgent?: string;
    ip?: string;
    error?: Error;
  }): void {
    const logData = {
      ...meta,
      type: meta.statusCode ? 'response' : 'request',
    };

    if (meta.error) {
      this.error(`${meta.method} ${meta.path} failed`, meta.error, logData);
    } else if (meta.statusCode && meta.statusCode >= 400) {
      this.warn(`${meta.method} ${meta.path} ${meta.statusCode}`, logData);
    } else {
      this.info(`${meta.method} ${meta.path}${meta.statusCode ? ` ${meta.statusCode}` : ''}`, logData);
    }
  }
}

// Factory function for creating service loggers
export function createLogger(config: LoggerConfig): Logger {
  return new Logger(config);
}

// Default request ID header
export const REQUEST_ID_HEADER = 'x-request-id';

// AsyncLocalStorage for request context (Node.js 14.8+)
import { AsyncLocalStorage } from 'async_hooks';

interface RequestStore {
  requestId: string;
  logger: Logger;
}

const asyncLocalStorage = new AsyncLocalStorage<RequestStore>();

export function runWithRequestContext<T>(
  requestId: string,
  logger: Logger,
  fn: () => T
): T {
  return asyncLocalStorage.run({ requestId, logger }, fn);
}

export function getRequestContext(): RequestStore | undefined {
  return asyncLocalStorage.getStore();
}

export { pino };
export default Logger;
