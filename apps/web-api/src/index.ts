import Fastify, { FastifyRequest } from "fastify";
import rateLimit, { errorResponseBuilderContext } from "@fastify/rate-limit";
import rawBody from "fastify-raw-body";
import { getEnv } from "@cap/config";
import loggingPlugin from "./plugins/logging.js";
import healthPlugin from "./plugins/health.js";
import { systemRoutes } from "./routes/system.js";
import { videoRoutes } from "./routes/videos.js";
import { uploadRoutes } from "./routes/uploads.js";
import { libraryRoutes } from "./routes/library.js";
import { jobRoutes } from "./routes/jobs.js";
import { webhookRoutes } from "./routes/webhooks.js";

const env = getEnv();
const app = Fastify({ logger: false });

// Register logging plugin first
await app.register(loggingPlugin, {
  serviceName: 'web-api',
  version: '0.1.0',
});

// Register health check endpoints
await app.register(healthPlugin, {
  version: '0.1.0',
});

// ---------------------------------------------------------------------------
// Rate limiting — 100 requests/minute per IP on all routes.
// Webhooks are excluded because they carry HMAC signatures and are server-to-
// server calls that can legitimately burst (e.g. progress events).
// ---------------------------------------------------------------------------
await app.register(rateLimit, {
  global: true,
  max: 100,
  timeWindow: "1 minute",
  // Use a consistent key regardless of X-Forwarded-For spoofing; nginx always
  // sets the real IP via proxy_set_header X-Real-IP in production.
  keyGenerator: (req: FastifyRequest) =>
    (req.headers["x-real-ip"] as string) ||
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
    req.ip,
  allowList: (req: FastifyRequest) => req.url?.startsWith('/api/webhooks/') ?? false,
  errorResponseBuilder: (_req: FastifyRequest, context: errorResponseBuilderContext) => ({
    statusCode: 429,
    error: "Too Many Requests",
    message: `Rate limit exceeded. Try again in ${context.after}.`,
  }),
});

// rawBody needed by the webhook route (registered with global: false so it
// only runs on routes that opt in via { config: { rawBody: true } }).
await app.register(rawBody, {
  field: "rawBody",
  global: false,
  encoding: "utf8",
  runFirst: true
});

// ---------------------------------------------------------------------------
// Route modules
// ---------------------------------------------------------------------------

await app.register(systemRoutes);
await app.register(videoRoutes);
await app.register(uploadRoutes);
await app.register(libraryRoutes);
await app.register(jobRoutes);
await app.register(webhookRoutes);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

await app.listen({ host: "0.0.0.0", port: env.WEB_API_PORT });

if (app.serviceLogger) {
  app.serviceLogger.info('web-api log', { event: "server.started", port: env.WEB_API_PORT });
} else {
  console.log(JSON.stringify({ service: "web-api", event: "server.started", port: env.WEB_API_PORT }));
}
