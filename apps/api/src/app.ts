import Fastify from 'fastify';
import type { FastifyError } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import { Queue } from 'bullmq';
import { Redis as IORedis } from 'ioredis';
import { loadConfig } from '@catchbox/config';
import { createDb } from '@catchbox/db';
import { createStore } from '@catchbox/store';
import type { App, AppContext } from './lib/context.js';
import { requireUser } from './lib/auth.js';
import { authRoutes } from './routes/auth.js';
import { messagesRoutes, aliasRoutes } from './routes/messages.js';
import { composeRoutes } from './routes/compose.js';
import { rulesRoutes } from './routes/misc.js';
import { searchRoutes } from './routes/search.js';
import { settingsRoutes } from './routes/settings.js';
import { diagnosticsRoutes } from './routes/diagnostics.js';
import { eventsRoutes } from './routes/events.js';

export async function buildApp(ctxOverride?: Partial<AppContext>) {
  const cfg = loadConfig();
  const db = ctxOverride?.db ?? createDb(cfg.DATABASE_URL);
  const redis = ctxOverride?.redis ?? new IORedis(cfg.REDIS_URL, { maxRetriesPerRequest: null });
  const store = ctxOverride?.store ?? createStore(cfg);
  const outboundQueue =
    ctxOverride?.outboundQueue ??
    new Queue('outbound', { connection: { url: cfg.REDIS_URL } });

  const app = Fastify({
    logger: cfg.NODE_ENV === 'production' ? { level: 'info' } : { level: 'warn' },
    trustProxy: true,
  }) as unknown as App;

  app.ctx = { cfg, db, store, redis, outboundQueue };

  await app.register(cookie);
  await app.register(cors, { origin: cfg.WEB_ORIGIN, credentials: true });
  await app.register(rateLimit, {
    max: 600,
    timeWindow: '1 minute',
    redis: redis as never,
    keyGenerator: (req) => req.ip,
  });
  await app.register(multipart, { limits: { fileSize: cfg.MAX_ATTACHMENT_BYTES } });
  app.addHook('preHandler', async (req) => {
    req.ctx = app.ctx;
  });
  app.setErrorHandler((err: FastifyError, _req, reply) => {
    const status = err.statusCode;
    if (status && status < 500) {
      return reply.code(status).send({ error: err.message });
    }
    if (err.name === 'ZodError') {
      return reply.code(400).send({ error: 'Validation failed', issues: (err as unknown as { issues: unknown[] }).issues });
    }
    app.log.error(err);
    return reply.code(500).send({ error: 'Internal server error' });
  });

  await authRoutes(app);
  await messagesRoutes(app);
  await aliasRoutes(app);
  await composeRoutes(app);
  await rulesRoutes(app);
  await searchRoutes(app);
  await settingsRoutes(app);
  await diagnosticsRoutes(app);
  await eventsRoutes(app);

  app.get('/api/messages-guard-test', { onRequest: requireUser }, async () => ({ ok: true }));

  return app;
}
