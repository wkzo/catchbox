import { promises as dns } from 'node:dns';
import net from 'node:net';
import tls from 'node:tls';
import type { App } from '../lib/context.js';
import { requireUser } from '../lib/auth.js';

const BLOCKLISTS = ['zen.spamhaus.org', 'bl.spamcop.net', 'b.barracudacentral.org'];

function serverIp(req: App extends never ? never : { headers: Record<string, unknown> }): string | null {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0]!.trim();
  return null;
}

async function checkSmtp(host: string, port: number): Promise<{ ok: boolean; detail: string }> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port, timeout: 6000 });
    let banner = '';
    const done = (ok: boolean, detail: string) => {
      socket.destroy();
      resolve({ ok, detail });
    };
    socket.on('connect', () => {});
    socket.on('data', (d) => {
      banner += d.toString();
      if (banner.includes('\n')) {
        socket.write('QUIT\r\n');
        done(banner.startsWith('220'), banner.trim().slice(0, 120));
      }
    });
    socket.on('timeout', () => done(false, 'timeout connecting'));
    socket.on('error', (e) => done(false, e.message));
  });
}

async function checkStarttls(host: string, port: number, servername?: string): Promise<{ ok: boolean; detail: string }> {
  const smtp = await checkSmtp(host, port);
  if (!smtp.ok) return { ok: false, detail: `SMTP not reachable: ${smtp.detail}` };
  const sn = servername ?? host;
  return new Promise((resolve) => {
    const socket = net.connect({ host, port, timeout: 8000 });
    let state: 'banner' | 'ehlo' | 'starttls' = 'banner';
    let buf = '';
    let ehloSawStarttls = false;
    const fail = (d: string) => {
      socket.destroy();
      resolve({ ok: false, detail: d });
    };
    const onLine = (line: string, final: boolean) => {
      if (state === 'banner' && final && line.startsWith('220')) {
        state = 'ehlo';
        socket.write('EHLO diagnostics.example.com\r\n');
      } else if (state === 'ehlo') {
        if (line.includes('STARTTLS')) ehloSawStarttls = true;
        if (final) {
          if (ehloSawStarttls) {
            state = 'starttls';
            socket.write('STARTTLS\r\n');
          } else {
            fail('Server does not advertise STARTTLS');
          }
        }
      } else if (state === 'starttls' && final && line.startsWith('220')) {
        const tlsSocket = tls.connect({ socket, servername: sn }, () => {
          const cert = tlsSocket.getPeerCertificate();
          tlsSocket.end();
          socket.destroy();
          resolve({
            ok: true,
            detail: `TLS OK, cert CN=${cert.subject?.CN ?? 'unknown'}, valid to ${cert.valid_to}, verified against system CA store`,
          });
        });
        tlsSocket.on('error', (e) => fail(`TLS handshake/verification failed: ${e.message}`));
      } else if (/^[45]\d\d/.test(line)) {
        fail(`SMTP error: ${line.trim().slice(0, 100)}`);
      }
    };
    socket.on('data', (d) => {
      buf += d.toString();
      let idx: number;
      while ((idx = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, idx).replace(/\r$/, '');
        buf = buf.slice(idx + 1);
        const final = !(line.length >= 4 && line[3] === '-');
        onLine(line, final);
      }
    });
    socket.on('timeout', () => fail('timeout'));
    socket.on('error', (e) => fail(e.message));
  });
}

export async function diagnosticsRoutes(app: App) {
  app.get('/api/health', async () => ({ ok: true, time: new Date().toISOString() }));

  app.get('/api/diagnostics/dns', { onRequest: requireUser }, async (req) => {
    const domain = app.ctx.cfg.DOMAIN;
    const result: Record<string, unknown> = {};

    try {
      const mx = await dns.resolveMx(domain);
      const ours = mx.filter((m) => m.exchange.endsWith(domain));
      result['mx'] = {
        ok: ours.length > 0,
        detail: mx.map((m) => `${m.priority} ${m.exchange}`).join(', ') || 'no MX records',
      };
    } catch (e) {
      result['mx'] = { ok: false, detail: (e as Error).message };
    }

    try {
      const txt = (await dns.resolveTxt(domain)).flat().join(' ');
      result['spf'] = {
        ok: /v=spf1/.test(txt),
        detail: (txt.match(/v=spf1[^\s"]*/) ?? ['no SPF record found'])[0]!,
      };
    } catch (e) {
      result['spf'] = { ok: false, detail: (e as Error).message };
    }

    try {
      const sel = app.ctx.cfg.DKIM_SELECTOR;
      const txt = (await dns.resolveTxt(`${sel}._domainkey.${domain}`)).flat().join('');
      result['dkim'] = { ok: txt.includes('p='), detail: txt.slice(0, 120) || 'no DKIM record' };
    } catch (e) {
      result['dkim'] = { ok: false, detail: (e as Error).message };
    }

    try {
      const txt = (await dns.resolveTxt(`_dmarc.${domain}`)).flat().join(' ');
      result['dmarc'] = { ok: /v=DMARC1/.test(txt), detail: txt.slice(0, 160) || 'no DMARC record' };
    } catch (e) {
      result['dmarc'] = { ok: false, detail: (e as Error).message };
    }

    const ip = serverIp(req as never) ?? process.env['PUBLIC_IP'] ?? null;
    if (ip) {
      try {
        const ptr = await dns.reverse(ip);
        result['ptr'] = { ok: ptr.some((p) => p.endsWith(domain)), detail: ptr.join(', ') };
      } catch (e) {
        result['ptr'] = { ok: false, detail: (e as Error).message };
      }
    } else {
      result['ptr'] = { ok: false, detail: 'server IP unknown' };
    }

    result['smtp'] = await checkSmtp(app.ctx.cfg.SELF_HOSTED_SMTP_HOST, app.ctx.cfg.SELF_HOSTED_SMTP_PORT);
    result['tls'] = await checkStarttls(
      app.ctx.cfg.SELF_HOSTED_SMTP_HOST,
      app.ctx.cfg.SELF_HOSTED_SMTP_PORT,
      `mail.${app.ctx.cfg.DOMAIN}`,
    );

    const lists: { list: string; listed: boolean; detail: string }[] = [];
    if (ip) {
      const rev = ip.split('.').reverse().join('.');
      for (const list of BLOCKLISTS) {
        try {
          const res = await dns.resolve4(`${rev}.${list}`);
          lists.push({ list, listed: true, detail: res.join(',') });
        } catch {
          lists.push({ list, listed: false, detail: 'not listed' });
        }
      }
    }
    result['blocklists'] = lists;
    return result;
  });
}
