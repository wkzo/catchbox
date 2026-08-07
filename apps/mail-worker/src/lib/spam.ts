import type { AppConfig } from '@catchbox/config';

export interface SpamResult {
  score: number;
  isSpam: boolean;
  action: string;
  symbols: string[];
}

export async function checkRspamd(cfg: AppConfig, raw: Buffer, ip?: string): Promise<SpamResult> {
  if (!cfg.RSPAMD_URL) return { score: 0, isSpam: false, action: 'no check', symbols: [] };
  try {
    const res = await fetch(`${cfg.RSPAMD_URL}/checkv2`, {
      method: 'POST',
      headers: {
        'content-type': 'text/plain',
        ...(ip ? { 'x-forwarded-for': ip } : {}),
        deliver: 'local',
      },
      body: raw,
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { score: 0, isSpam: false, action: `rspamd http ${res.status}`, symbols: [] };
    const data = (await res.json()) as {
      score?: number;
      action?: string;
      symbols?: Record<string, { score?: number }>;
    };
    const score = data.score ?? 0;
    return {
      score,
      isSpam: data.action === 'reject' || data.action === 'add header' || score >= 15,
      action: data.action ?? 'unknown',
      symbols: Object.keys(data.symbols ?? {}).slice(0, 40),
    };
  } catch (err) {
    return { score: 0, isSpam: false, action: `rspamd error: ${(err as Error).message}`, symbols: [] };
  }
}
