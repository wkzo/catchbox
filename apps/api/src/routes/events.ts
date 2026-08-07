import type { App } from '../lib/context.js';
import { requireUser } from '../lib/auth.js';
import type { RealtimeEvent } from '@catchbox/types';

export async function eventsRoutes(app: App) {
  app.get('/api/events', { onRequest: requireUser }, (req, reply) => {
    const userId = req.user!.id;
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    reply.raw.write(': connected\n\n');

    const channel = `rt:${userId}`;
    const sub = app.ctx.redis.duplicate();
    let closed = false;

    const heartbeat = setInterval(() => {
      if (!closed) reply.raw.write(': ping\n\n');
    }, 25_000);

    void sub.subscribe(channel);
    sub.on('message', (_ch: string, payload: string) => {
      if (closed) return;
      try {
        const event = JSON.parse(payload) as RealtimeEvent;
        reply.raw.write(`data: ${payload}\n\n`);
        void event;
      } catch {
        // ignore malformed events
      }
    });

    req.raw.on('close', () => {
      closed = true;
      clearInterval(heartbeat);
      void sub.unsubscribe(channel);
      sub.disconnect();
    });
  });
}
