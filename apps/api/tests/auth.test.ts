import { beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { App } from '../src/lib/context.js';

let app: App;

beforeAll(async () => {
  process.env['STORE_DRIVER'] = 'fs';
  app = await buildApp();
});

describe('auth & guards (integration)', () => {
  it('health endpoint is public', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
  });

  it('rejects unauthenticated message access', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/messages' });
    expect(res.statusCode).toBe(401);
  });

  it('issues CSRF cookie on state and enforces double-submit on login', async () => {
    const state = await app.inject({ method: 'GET', url: '/api/auth/state' });
    expect(state.statusCode).toBe(200);
    const setCookie = state.headers['set-cookie'];
    const csrf = Array.isArray(setCookie)
      ? setCookie.find((c) => c.startsWith('quit_csrf='))
      : setCookie;
    expect(csrf).toBeTruthy();
    const token = csrf!.split(';')[0]!.split('=')[1]!;

    // without header -> 403
    const noCsrf = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'owner@example.com', password: 'CHANGE_ME_dev_only' },
      cookies: { quit_csrf: token },
    });
    expect(noCsrf.statusCode).toBe(403);

    // with header -> success (seeded dev owner)
    const ok = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'owner@example.com', password: 'CHANGE_ME_dev_only' },
      cookies: { quit_csrf: token },
      headers: { 'x-csrf-token': token },
    });
    expect(ok.statusCode).toBe(200);
    const sid = ok.headers['set-cookie'];
    expect(JSON.stringify(sid)).toContain('quit_sid');
  });

  it('setup is closed once an owner exists', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      payload: { email: 'x@y.z', displayName: 'X', password: 'longenoughpassword' },
      cookies: { quit_csrf: 't' },
      headers: { 'x-csrf-token': 't' },
    });
    expect(res.statusCode).toBe(409);
  });
});
