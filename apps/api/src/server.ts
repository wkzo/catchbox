import { buildApp } from './app.js';
import { loadConfig } from '@catchbox/config';

async function main() {
  const cfg = loadConfig();
  const app = await buildApp();
  await app.listen({ host: cfg.API_HOST, port: cfg.API_PORT });
  app.log.info(`api listening on ${cfg.API_HOST}:${cfg.API_PORT}`);

  const shutdown = async (signal: string) => {
    app.log.info(`${signal} received, shutting down`);
    try {
      await app.close();
      await app.ctx.outboundQueue.close();
      app.ctx.redis.disconnect();
      await app.ctx.db.close();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
