import { createRequire } from 'node:module';
import { Redis as IORedis } from 'ioredis';
import { loadConfig } from '@catchbox/config';
import { createDb } from '@catchbox/db';
import { createStore } from '@catchbox/store';
import type { RealtimeEvent } from '@catchbox/types';
import type { SMTPServer as SMTPServerClass } from 'smtp-server';
import { ingestMessage } from './ingest.js';
import { startOutboundWorker } from './outbound/processor.js';

const require = createRequire(import.meta.url);
const { SMTPServer } = require('smtp-server') as { SMTPServer: typeof SMTPServerClass };

async function main() {
  const cfg = loadConfig();
  const db = createDb(cfg.DATABASE_URL);
  const store = createStore(cfg);
  const redis = new IORedis(cfg.REDIS_URL, { maxRetriesPerRequest: null });

  const publish = async (userId: string, event: RealtimeEvent) => {
    await redis.publish(`rt:${userId}`, JSON.stringify(event));
  };

  const server = new SMTPServer({
    lmtp: true,
    banner: `${cfg.SMTP_HOSTNAME} QUIT mail LMTP`,
    hideSTARTTLS: true,
    authOptional: true,
    disableReverseLookup: true,
    size: cfg.MAX_MESSAGE_BYTES,
    onMailFrom(address, _session, callback) {
      // bounces arrive with empty envelope sender — allow
      if (address.address && address.address.length > 320) {
        return callback(new Error('550 Sender address too long'));
      }
      callback();
    },
    onRcptTo(address, _session, callback) {
      const at = address.address.lastIndexOf('@');
      const domain = at === -1 ? '' : address.address.slice(at + 1).toLowerCase();
      if (domain !== cfg.DOMAIN.toLowerCase()) {
        // never relay: we only accept mail for our own domain
        return callback(new Error(`550 5.1.1 Relay denied for <${address.address}>`));
      }
      callback();
    },
    onData(stream, session, callback) {
      const chunks: Buffer[] = [];
      let size = 0;
      let overflow = false;
      stream.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > cfg.MAX_MESSAGE_BYTES) {
          overflow = true;
          stream.resume();
          return;
        }
        chunks.push(chunk);
      });
      stream.on('end', () => {
        void (async () => {
          if (overflow) {
            return callback(new Error('552 5.3.4 Message exceeds size limit'));
          }
          const raw = Buffer.concat(chunks);
          const mailFrom = session.envelope.mailFrom;
          const envelope = {
            from: mailFrom && typeof mailFrom === 'object' ? mailFrom.address : '',
            to: session.envelope.rcptTo.map((r) => r.address),
            clientIp: session.remoteAddress,
          };
          try {
            const outcome = await ingestMessage({ cfg, db, store, publish }, envelope, raw);
            if (outcome.status === 'rejected') {
              return callback(new Error(outcome.reason));
            }
            console.log(
              `[ingest] accepted message=${outcome.messageId || '-'} duplicate=${Boolean(outcome.duplicate)} to=${envelope.to.join(',')}`,
            );
            callback();
          } catch (err) {
            console.error('[ingest] pipeline error', err);
            // temporary failure → Postfix will retry
            callback(new Error('451 4.3.0 Temporary processing error'));
          }
        })();
      });
      stream.on('error', (err) => callback(err));
    },
  });

  await new Promise<void>((resolve, reject) => {
    server.on('error', reject);
    server.listen(cfg.LMTP_PORT, cfg.LMTP_HOST, () => resolve());
  });
  console.log(`[lmtp] listening on ${cfg.LMTP_HOST}:${cfg.LMTP_PORT}`);

  const outboundWorker = startOutboundWorker({ cfg, db, store, publish });
  outboundWorker.on('failed', (job, err) => {
    console.error(`[outbound] job ${job?.id} failed:`, err.message);
  });
  outboundWorker.on('completed', (job) => {
    console.log(`[outbound] job ${job.id} completed`);
  });
  console.log(`[outbound] worker started (transport=${cfg.MAIL_TRANSPORT})`);

  const shutdown = (signal: string) => {
    console.log(`[worker] ${signal} received, shutting down`);
    void (async () => {
      try {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await outboundWorker.close();
        redis.disconnect();
        await db.close();
      } finally {
        process.exit(0);
      }
    })();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
