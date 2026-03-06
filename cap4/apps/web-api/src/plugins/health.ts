import { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { query } from '@cap/db';
import { getEnv } from '@cap/config';

const env = getEnv();

interface HealthStatus {
  status: 'healthy' | 'unhealthy';
  timestamp: string;
  version: string;
  service: string;
  checks: {
    database: {
      status: 'up' | 'down';
      latencyMs: number;
    };
  };
}

interface ReadyStatus {
  status: 'ready' | 'not_ready';
  timestamp: string;
  version: string;
  service: string;
  checks: {
    database: {
      status: 'up' | 'down';
      latencyMs: number;
    };
  };
}

const healthPlugin: FastifyPluginAsync<{
  version?: string;
}> = async (fastify, opts) => {
  // Liveness probe - basic health check
  fastify.get('/health', async (_request, reply) => {
    const startTime = Date.now();
    
    try {
      await query(env.DATABASE_URL, 'SELECT 1');
      const latencyMs = Date.now() - startTime;
      
      const status: HealthStatus = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: opts.version || '0.1.0',
        service: 'web-api',
        checks: {
          database: {
            status: 'up',
            latencyMs,
          },
        },
      };
      
      return reply.send(status);
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      
      const status: HealthStatus = {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        version: opts.version || '0.1.0',
        service: 'web-api',
        checks: {
          database: {
            status: 'down',
            latencyMs,
          },
        },
      };
      
      fastify.serviceLogger?.error('Health check failed', error as Error);
      return reply.code(503).send(status);
    }
  });

  // Readiness probe - can accept traffic
  fastify.get('/ready', async (_request, reply) => {
    const startTime = Date.now();
    
    try {
      await query(env.DATABASE_URL, 'SELECT 1');
      const latencyMs = Date.now() - startTime;
      
      // Check if response time is acceptable (< 500ms)
      const isReady = latencyMs < 500;
      
      const status: ReadyStatus = {
        status: isReady ? 'ready' : 'not_ready',
        timestamp: new Date().toISOString(),
        version: opts.version || '0.1.0',
        service: 'web-api',
        checks: {
          database: {
            status: 'up',
            latencyMs,
          },
        },
      };
      
      const statusCode = isReady ? 200 : 503;
      return reply.code(statusCode).send(status);
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      
      const status: ReadyStatus = {
        status: 'not_ready',
        timestamp: new Date().toISOString(),
        version: opts.version || '0.1.0',
        service: 'web-api',
        checks: {
          database: {
            status: 'down',
            latencyMs,
          },
        },
      };
      
      fastify.serviceLogger?.error('Readiness check failed', error as Error);
      return reply.code(503).send(status);
    }
  });
};

export default fp(healthPlugin, { name: 'health' });
