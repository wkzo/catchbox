import { eq, sql } from 'drizzle-orm';
import { profileSchema } from '@catchbox/types';
import { users, messages, attachments, outboundJobs } from '@catchbox/db';
import type { App } from '../lib/context.js';
import { requireCsrf, requireUser } from '../lib/auth.js';

export async function settingsRoutes(app: App) {
  app.get('/api/settings', { onRequest: requireUser }, async (req) => {
    const [msgStats] = await app.ctx.db
      .select({
        count: sql<number>`count(*)::int`,
        bytes: sql<number>`coalesce(sum(size),0)::bigint`,
      })
      .from(messages)
      .where(eq(messages.userId, req.user!.id));
    const [attStats] = await app.ctx.db
      .select({
        count: sql<number>`count(*)::int`,
        bytes: sql<number>`coalesce(sum(${attachments.size}),0)::bigint`,
      })
      .from(attachments)
      .innerJoin(messages, eq(attachments.messageId, messages.id))
      .where(eq(messages.userId, req.user!.id));
    return {
      profile: {
        email: req.user!.email,
        displayName: req.user!.displayName,
        theme: req.user!.theme,
        totpEnabled: req.user!.totpEnabled,
      },
      transport: app.ctx.cfg.MAIL_TRANSPORT,
      domain: app.ctx.cfg.DOMAIN,
      storage: {
        messageCount: msgStats?.count ?? 0,
        attachmentCount: attStats?.count ?? 0,
        bytes: Number(msgStats?.bytes ?? 0) + Number(attStats?.bytes ?? 0),
      },
    };
  });

  app.patch('/api/settings/profile', { onRequest: [requireUser, requireCsrf] }, async (req) => {
    const input = profileSchema.parse(req.body);
    await app.ctx.db
      .update(users)
      .set({ displayName: input.displayName, theme: input.theme ?? 'system' })
      .where(eq(users.id, req.user!.id));
    return { ok: true };
  });

  app.get('/api/settings/outbox', { onRequest: requireUser }, async (req) => {
    const rows = await app.ctx.db
      .select()
      .from(outboundJobs)
      .where(eq(outboundJobs.userId, req.user!.id))
      .orderBy(sql`created_at desc`)
      .limit(50);
    return { jobs: rows };
  });

  app.post('/api/settings/export', { onRequest: [requireUser, requireCsrf] }, async () => {
    return {
      ok: true,
      note: 'Raw MIME files live in object storage; use infrastructure/backup.sh for a full export.',
    };
  });

  app.delete('/api/settings/data', { onRequest: [requireUser, requireCsrf] }, async (req) => {
    const { confirm } = (req.body ?? {}) as { confirm?: string };
    if (confirm !== 'DELETE ALL DATA') return { ok: false, error: 'Confirmation phrase required' };
    await app.ctx.db.delete(messages).where(eq(messages.userId, req.user!.id));
    return { ok: true };
  });
}
