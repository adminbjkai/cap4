import Fastify from "fastify";
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

if ((app as any).serviceLogger) {
  (app as any).serviceLogger.info('web-api log', { event: "server.started", port: env.WEB_API_PORT });
} else {
  console.log(JSON.stringify({ service: "web-api", event: "server.started", port: env.WEB_API_PORT }));
}
