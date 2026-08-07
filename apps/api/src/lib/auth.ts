import { createHash, randomBytes } from 'node:crypto';
import { eq, and, gt, isNull } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { App } from './context.js';
import { sessions, users, auditLog } from '@catchbox/db';
import { nanoid } from 'nanoid';

export const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

export function httpError(status: number, message: string) {
  const err = new Error(message) as Error & { statusCode: number };
  err.statusCode = status;
  return err;
}

export async function audit(
  app: App,
  userId: string | null,
  action: string,
  meta: Record<string, unknown> = {},
  ip?: string,
) {
  await app.ctx.db.insert(auditLog).values({ id: nanoid(16), userId, action, meta, ip });
}

export function cookieOpts(cfg: { NODE_ENV: string }) {
  return {
    path: '/',
    httpOnly: true,
    secure: cfg.NODE_ENV === 'production',
    sameSite: 'lax' as const,
  };
}

export async function createSession(
  app: App,
  userId: string,
  req: FastifyRequest,
  reply: FastifyReply,
  rememberDays: number,
) {
  const token = randomBytes(32).toString('base64url');
  const id = nanoid(16);
  const expiresAt = new Date(Date.now() + rememberDays * 86400_000);
  await app.ctx.db.insert(sessions).values({
    id,
    userId,
    tokenHash: sha256(token),
    userAgent: req.headers['user-agent']?.slice(0, 300) ?? null,
    ip: req.ip,
    expiresAt,
  });
  reply.setCookie(app.ctx.cfg.SESSION_COOKIE, token, {
    ...cookieOpts(app.ctx.cfg),
    expires: expiresAt,
  });
  const csrf = randomBytes(24).toString('base64url');
  reply.setCookie(app.ctx.cfg.CSRF_COOKIE, csrf, {
    path: '/',
    secure: app.ctx.cfg.NODE_ENV === 'production',
    sameSite: 'strict',
    expires: expiresAt,
  });
  return { sessionId: id };
}

export function destroySession(app: App, reply: FastifyReply) {
  reply.clearCookie(app.ctx.cfg.SESSION_COOKIE, { path: '/' });
  reply.clearCookie(app.ctx.cfg.CSRF_COOKIE, { path: '/' });
}

export async function optionalUser(req: FastifyRequest, _reply: FastifyReply) {
  const app = req.server as App;
  const token = req.cookies[app.ctx.cfg.SESSION_COOKIE];
  if (!token) return;
  const rows = await app.ctx.db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(
      and(
        eq(sessions.tokenHash, sha256(token)),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return;
  req.user = {
    id: row.user.id,
    email: row.user.email,
    displayName: row.user.displayName,
    totpEnabled: row.user.totpEnabled,
    theme: row.user.theme,
  };
}

export async function requireUser(req: FastifyRequest, reply: FastifyReply) {
  const app = req.server as App;
  const token = req.cookies[app.ctx.cfg.SESSION_COOKIE];
  if (!token) return reply.code(401).send({ error: 'unauthorized' });
  const rows = await app.ctx.db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(
      and(
        eq(sessions.tokenHash, sha256(token)),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return reply.code(401).send({ error: 'unauthorized' });
  const { session, user } = row;
  if (Date.now() - session.lastSeenAt.getTime() > 60_000) {
    await app.ctx.db
      .update(sessions)
      .set({ lastSeenAt: new Date() })
      .where(eq(sessions.id, session.id));
  }
  req.user = {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    totpEnabled: user.totpEnabled,
    theme: user.theme,
  };
}

export async function requireCsrf(req: FastifyRequest, reply: FastifyReply) {
  const app = req.server as App;
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
  const cookieToken = req.cookies[app.ctx.cfg.CSRF_COOKIE];
  const header = req.headers['x-csrf-token'];
  if (!cookieToken || typeof header !== 'string' || header !== cookieToken) {
    return reply.code(403).send({ error: 'csrf token mismatch' });
  }
}
