import { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { createLogger, Logger, REQUEST_ID_HEADER, LogContext } from '@cap/logger';

// Augment Fastify types to include our custom logger
declare module 'fastify' {
  interface FastifyRequest {
    requestId: string;
    serviceLog: Logger;
  }
  interface FastifyInstance {
    serviceLogger: Logger;
  }
}

const loggingPlugin: FastifyPluginAsync<{
  serviceName: string;
  version?: string;
}> = async (fastify, opts) => {
  const requestedLevel = typeof process.env.LOG_LEVEL === 'string'
    ? process.env.LOG_LEVEL.trim()
    : '';
  const level = ['trace', 'debug', 'info', 'warn', 'error'].includes(requestedLevel)
    ? requestedLevel as 'trace' | 'debug' | 'info' | 'warn' | 'error'
    : 'info';
  const rootLogger = createLogger({
    name: opts.serviceName,
    version: opts.version,
    pretty: process.env.LOG_PRETTY === 'true',
    level,
  });

  fastify.decorate('serviceLogger', rootLogger);

  // Add request ID and child logger to each request
  fastify.addHook('onRequest', async (request, reply) => {
    const requestId =
      (request.headers[REQUEST_ID_HEADER] as string) ||
      Logger.generateRequestId();

    // Set request ID on request and response
    request.requestId = requestId;
    reply.header(REQUEST_ID_HEADER, requestId);

    // Create child logger with request context
    const context: LogContext = {
      requestId,
      method: request.method,
      path: request.url,
      ip: request.ip,
    };

    if (request.headers['user-agent']) {
      context.userAgent = request.headers['user-agent'] as string;
    }

    request.serviceLog = rootLogger.withContext(context);

    // Log request start
    request.serviceLog.debug('Request started');
  });

  // Log request completion
  fastify.addHook('onResponse', async (request, reply) => {
    const duration = reply.elapsedTime;
    const statusCode = reply.statusCode;

    const logData = {
      method: request.method,
      path: request.routeOptions?.url || request.url,
      statusCode,
      durationMs: Math.round(duration),
      requestId: request.requestId,
    };

    if (statusCode >= 500) {
      request.serviceLog.error('Request failed', new Error(`HTTP ${statusCode}`), logData);
    } else if (statusCode >= 400) {
      request.serviceLog.warn('Request warning', logData);
    } else {
      request.serviceLog.info('Request completed', logData);
    }
  });

  // Log errors
  fastify.addHook('onError', async (request, reply, error) => {
    request.serviceLog?.error('Request error', error instanceof Error ? error : new Error(String(error)), {
      method: request.method,
      path: request.url,
      statusCode: reply.statusCode,
    });
  });
};

export default fp(loggingPlugin, { name: 'logging' });
