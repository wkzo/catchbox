import { randomBytes } from 'node:crypto';
import { count, eq } from 'drizzle-orm';
import { hash, verify } from '@node-rs/argon2';
import { TOTP, Secret } from 'otpauth';
import { nanoid } from 'nanoid';
import {
  setupSchema,
  loginSchema,
  passwordChangeSchema,
} from '@catchbox/types';
import { users, sessions, aliases } from '@catchbox/db';
import type { App } from '../lib/context.js';
import {
  audit,
  createSession,
  destroySession,
  httpError,
  optionalUser,
  requireCsrf,
  requireUser,
  sha256,
} from '../lib/auth.js';

const ARGON2 = { memoryCost: 65536, timeCost: 3, parallelism: 1 };

export const RESERVED_ALIASES = ['postmaster', 'abuse'];

export async function ensureReservedAliases(app: App, userId: string) {
  for (const lp of RESERVED_ALIASES) {
    const existing = await app.ctx.db
      .select({ id: aliases.id })
      .from(aliases)
      .where(eq(aliases.localpart, lp))
      .limit(1);
    if (existing.length === 0) {
      await app.ctx.db.insert(aliases).values({
        id: nanoid(16),
        userId,
        localpart: lp,
        source: 'system',
        displayName: lp === 'abuse' ? 'Abuse reports' : 'Postmaster',
      });
    }
  }
}

export async function authRoutes(app: App) {
  app.get('/api/auth/state', { onRequest: optionalUser }, async (req, reply) => {
    // bootstrap: issue a CSRF cookie so setup/login can pass the double-submit check
    if (!req.cookies[app.ctx.cfg.CSRF_COOKIE]) {
      reply.setCookie(app.ctx.cfg.CSRF_COOKIE, randomBytes(24).toString('base64url'), {
        path: '/',
        secure: app.ctx.cfg.NODE_ENV === 'production',
        sameSite: 'strict',
      });
    }
    const rows = await app.ctx.db.select({ n: count() }).from(users);
    const n = rows[0]?.n ?? 0;
    if (n === 0) return { setupRequired: true, authenticated: false };
    if (!req.user) return { setupRequired: false, authenticated: false };
    return {
      setupRequired: false,
      authenticated: true,
      user: {
        email: req.user.email,
        displayName: req.user.displayName,
        totpEnabled: req.user.totpEnabled,
        theme: req.user.theme,
      },
    };
  });

  app.post(
    '/api/auth/setup',
    { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } }, onRequest: [requireCsrf] },
    async (req, reply) => {
      const rows = await app.ctx.db.select({ n: count() }).from(users);
      const n = rows[0]?.n ?? 0;
      if (n > 0) throw httpError(409, 'Owner already exists');
      const input = setupSchema.parse(req.body);
      const id = nanoid(16);
      const passwordHash = await hash(input.password, ARGON2);
      const recoveryKey = randomBytes(16).toString('base64url');
      await app.ctx.db.insert(users).values({
        id,
        email: input.email.toLowerCase(),
        displayName: input.displayName,
        passwordHash,
        recoveryKeyHash: sha256(recoveryKey),
      });
      await ensureReservedAliases(app, id);
      await createSession(app, id, req, reply, app.ctx.cfg.SESSION_TTL_DAYS);
      await audit(app, id, 'setup.completed', { email: input.email }, req.ip);
      return reply.code(201).send({ recoveryKey });
    },
  );

  app.post(
    '/api/auth/login',
    { config: { rateLimit: { max: 8, timeWindow: '15 minutes' } }, onRequest: [requireCsrf] },
    async (req, reply) => {
      const input = loginSchema.parse(req.body);
      const [user] = await app.ctx.db
        .select()
        .from(users)
        .where(eq(users.email, input.email.toLowerCase()))
        .limit(1);
      const fail = () => {
        void audit(app, null, 'login.failed', { email: input.email }, req.ip);
        throw httpError(401, 'Invalid credentials');
      };
      if (!user || !(await verify(user.passwordHash, input.password).catch(() => false))) fail();
      if (user!.totpEnabled && user!.totpSecret) {
        const totp = new TOTP({ secret: Secret.fromBase32(user!.totpSecret) });
        if (!input.totpToken || totp.validate({ token: input.totpToken, window: 1 }) === null) {
          throw httpError(401, 'TOTP code required');
        }
      }
      await createSession(app, user!.id, req, reply, app.ctx.cfg.SESSION_TTL_DAYS);
      await audit(app, user!.id, 'login.success', {}, req.ip);
      return {
        user: {
          email: user!.email,
          displayName: user!.displayName,
          totpEnabled: user!.totpEnabled,
          theme: user!.theme,
        },
      };
    },
  );

  app.post('/api/auth/recover', { onRequest: [requireCsrf] }, async (req, reply) => {
    const { email, recoveryKey, newPassword } = (req.body ?? {}) as Record<string, string>;
    if (!email || !recoveryKey || !newPassword || newPassword.length < 10) {
      throw httpError(400, 'email, recoveryKey and newPassword (min 10) required');
    }
    const [user] = await app.ctx.db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);
    if (!user || !user.recoveryKeyHash || user.recoveryKeyHash !== sha256(recoveryKey)) {
      throw httpError(401, 'Invalid recovery key');
    }
    const newRecovery = randomBytes(16).toString('base64url');
    await app.ctx.db
      .update(users)
      .set({
        passwordHash: await hash(newPassword, ARGON2),
        recoveryKeyHash: sha256(newRecovery),
        totpEnabled: false,
        totpSecret: null,
      })
      .where(eq(users.id, user.id));
    await app.ctx.db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.userId, user.id));
    await audit(app, user.id, 'account.recovered', {}, req.ip);
    return reply.send({ recoveryKey: newRecovery });
  });

  app.post('/api/auth/logout', { onRequest: [requireUser, requireCsrf] }, async (req, reply) => {
    const token = req.cookies[app.ctx.cfg.SESSION_COOKIE];
    if (token) {
      await app.ctx.db
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(eq(sessions.tokenHash, sha256(token)));
    }
    destroySession(app, reply);
    return { ok: true };
  });

  app.get('/api/auth/sessions', { onRequest: requireUser }, async (req) => {
    const rows = await app.ctx.db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, req.user!.id));
    const currentHash = sha256(req.cookies[app.ctx.cfg.SESSION_COOKIE] ?? '');
    return {
      sessions: rows
        .filter((s) => !s.revokedAt && s.expiresAt > new Date())
        .map((s) => ({
          id: s.id,
          userAgent: s.userAgent,
          ip: s.ip,
          createdAt: s.createdAt.toISOString(),
          lastSeenAt: s.lastSeenAt.toISOString(),
          current: s.tokenHash === currentHash,
        })),
    };
  });

  app.delete('/api/auth/sessions/:id', { onRequest: [requireUser, requireCsrf] }, async (req) => {
    const { id } = req.params as { id: string };
    await app.ctx.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(eq(sessions.id, id));
    await audit(app, req.user!.id, 'session.revoked', { sessionId: id }, req.ip);
    return { ok: true };
  });

  app.post('/api/auth/password', { onRequest: [requireUser, requireCsrf] }, async (req) => {
    const input = passwordChangeSchema.parse(req.body);
    const [user] = await app.ctx.db.select().from(users).where(eq(users.id, req.user!.id)).limit(1);
    if (!user || !(await verify(user.passwordHash, input.currentPassword).catch(() => false))) {
      throw httpError(401, 'Current password incorrect');
    }
    await app.ctx.db
      .update(users)
      .set({ passwordHash: await hash(input.newPassword, ARGON2) })
      .where(eq(users.id, user.id));
    await audit(app, req.user!.id, 'password.changed', {}, req.ip);
    return { ok: true };
  });

  app.post('/api/auth/totp/enroll', { onRequest: [requireUser, requireCsrf] }, async (req) => {
    const secret = new Secret({ size: 20 });
    const [user] = await app.ctx.db.select().from(users).where(eq(users.id, req.user!.id)).limit(1);
    await app.ctx.db
      .update(users)
      .set({ totpSecret: secret.base32, totpEnabled: false })
      .where(eq(users.id, user!.id));
    const totp = new TOTP({ issuer: 'QUIT', label: user!.email, secret });
    return { secret: secret.base32, uri: totp.toString() };
  });

  app.post('/api/auth/totp/confirm', { onRequest: [requireUser, requireCsrf] }, async (req) => {
    const { token } = (req.body ?? {}) as { token?: string };
    const [user] = await app.ctx.db.select().from(users).where(eq(users.id, req.user!.id)).limit(1);
    if (!user?.totpSecret || !token) throw httpError(400, 'Enroll first and provide token');
    const totp = new TOTP({ secret: Secret.fromBase32(user.totpSecret) });
    if (totp.validate({ token, window: 1 }) === null) throw httpError(400, 'Invalid code');
    await app.ctx.db.update(users).set({ totpEnabled: true }).where(eq(users.id, user.id));
    await audit(app, user.id, 'totp.enabled', {}, req.ip);
    return { ok: true };
  });

  app.post('/api/auth/totp/disable', { onRequest: [requireUser, requireCsrf] }, async (req) => {
    const { password } = (req.body ?? {}) as { password?: string };
    const [user] = await app.ctx.db.select().from(users).where(eq(users.id, req.user!.id)).limit(1);
    if (!user || !password || !(await verify(user.passwordHash, password).catch(() => false))) {
      throw httpError(401, 'Password required');
    }
    await app.ctx.db
      .update(users)
      .set({ totpEnabled: false, totpSecret: null })
      .where(eq(users.id, user.id));
    await audit(app, user.id, 'totp.disabled', {}, req.ip);
    return { ok: true };
  });
}
