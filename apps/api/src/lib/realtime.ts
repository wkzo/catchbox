import type { App } from './context.js';
import type { RealtimeEvent } from '@catchbox/types';

export async function publish(app: App, userId: string, event: RealtimeEvent) {
  await app.ctx.redis.publish(`rt:${userId}`, JSON.stringify(event));
}
