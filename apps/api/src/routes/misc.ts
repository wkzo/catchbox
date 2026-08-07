import { eq, and, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { ruleSchema, blockedSenderSchema, savedViewSchema } from '@catchbox/types';
import { rules, blockedSenders, savedViews, labels, ruleHits } from '@catchbox/db';
import type { App } from '../lib/context.js';
import { httpError, requireCsrf, requireUser } from '../lib/auth.js';

export async function rulesRoutes(app: App) {
  app.get('/api/rules', { onRequest: requireUser }, async (req) => {
    const rows = await app.ctx.db
      .select()
      .from(rules)
      .where(eq(rules.userId, req.user!.id))
      .orderBy(rules.position);
    return { rules: rows };
  });

  app.post('/api/rules', { onRequest: [requireUser, requireCsrf] }, async (req, reply) => {
    const input = ruleSchema.parse(req.body);
    const id = nanoid(16);
    const posRows = await app.ctx.db
      .select({ maxPos: sql<number>`coalesce(max(position),0)` })
      .from(rules)
      .where(eq(rules.userId, req.user!.id));
    await app.ctx.db.insert(rules).values({
      id,
      userId: req.user!.id,
      position: Number(posRows[0]?.maxPos ?? 0) + 1,
      ...input,
    });
    return reply.code(201).send({ id });
  });

  app.patch('/api/rules/:id', { onRequest: [requireUser, requireCsrf] }, async (req) => {
    const { id } = req.params as { id: string };
    const input = ruleSchema.partial().parse(req.body);
    await app.ctx.db
      .update(rules)
      .set(input as Record<string, unknown>)
      .where(and(eq(rules.id, id), eq(rules.userId, req.user!.id)));
    return { ok: true };
  });

  app.delete('/api/rules/:id', { onRequest: [requireUser, requireCsrf] }, async (req) => {
    const { id } = req.params as { id: string };
    await app.ctx.db.delete(rules).where(and(eq(rules.id, id), eq(rules.userId, req.user!.id)));
    return { ok: true };
  });

  app.get('/api/rules/:id/hits', { onRequest: requireUser }, async (req) => {
    const { id } = req.params as { id: string };
    const hits = await app.ctx.db.select().from(ruleHits).where(eq(ruleHits.ruleId, id)).limit(50);
    return { hits };
  });

  app.get('/api/blocked-senders', { onRequest: requireUser }, async (req) => {
    const rows = await app.ctx.db.select().from(blockedSenders).where(eq(blockedSenders.userId, req.user!.id));
    return { blockedSenders: rows };
  });

  app.post('/api/blocked-senders', { onRequest: [requireUser, requireCsrf] }, async (req, reply) => {
    const input = blockedSenderSchema.parse(req.body);
    const id = nanoid(16);
    await app.ctx.db
      .insert(blockedSenders)
      .values({ id, userId: req.user!.id, kind: input.kind, value: input.value.toLowerCase() })
      .onConflictDoNothing();
    return reply.code(201).send({ id });
  });

  app.delete('/api/blocked-senders/:id', { onRequest: [requireUser, requireCsrf] }, async (req) => {
    const { id } = req.params as { id: string };
    await app.ctx.db
      .delete(blockedSenders)
      .where(and(eq(blockedSenders.id, id), eq(blockedSenders.userId, req.user!.id)));
    return { ok: true };
  });

  app.get('/api/views', { onRequest: requireUser }, async (req) => {
    const rows = await app.ctx.db.select().from(savedViews).where(eq(savedViews.userId, req.user!.id));
    return { views: rows };
  });

  app.post('/api/views', { onRequest: [requireUser, requireCsrf] }, async (req, reply) => {
    const input = savedViewSchema.parse(req.body);
    const id = nanoid(16);
    await app.ctx.db.insert(savedViews).values({ id, userId: req.user!.id, ...input });
    return reply.code(201).send({ id });
  });

  app.delete('/api/views/:id', { onRequest: [requireUser, requireCsrf] }, async (req) => {
    const { id } = req.params as { id: string };
    await app.ctx.db.delete(savedViews).where(and(eq(savedViews.id, id), eq(savedViews.userId, req.user!.id)));
    return { ok: true };
  });

  app.get('/api/labels', { onRequest: requireUser }, async (req) => {
    const rows = await app.ctx.db.select().from(labels).where(eq(labels.userId, req.user!.id));
    return { labels: rows };
  });

  app.post('/api/labels', { onRequest: [requireUser, requireCsrf] }, async (req, reply) => {
    const { name, color } = (req.body ?? {}) as { name?: string; color?: string };
    if (!name || name.length > 120) throw httpError(400, 'Label name required');
    const id = nanoid(16);
    await app.ctx.db
      .insert(labels)
      .values({ id, userId: req.user!.id, name, color: color ?? null })
      .onConflictDoNothing();
    return reply.code(201).send({ id });
  });

  app.delete('/api/labels/:id', { onRequest: [requireUser, requireCsrf] }, async (req) => {
    const { id } = req.params as { id: string };
    await app.ctx.db.delete(labels).where(and(eq(labels.id, id), eq(labels.userId, req.user!.id)));
    return { ok: true };
  });
}
