import net from 'node:net';
import type { AppConfig } from '@catchbox/config';

export type VirusResult = 'clean' | 'infected' | 'skipped' | 'error';

export interface ScanResult {
  status: VirusResult;
  threat?: string;
}

/** ClamAV INSTREAM protocol over TCP. */
export function scanBuffer(cfg: AppConfig, data: Buffer): Promise<ScanResult> {
  if (!cfg.CLAMAV_HOST) return Promise.resolve({ status: 'skipped' });
  return new Promise((resolve) => {
    const socket = net.connect({ host: cfg.CLAMAV_HOST, port: cfg.CLAMAV_PORT, timeout: 30_000 });
    let response = '';
    const finish = (r: ScanResult) => {
      socket.destroy();
      resolve(r);
    };
    socket.on('connect', () => {
      socket.write(Buffer.from('zINSTREAM\0'));
      const len = Buffer.alloc(4);
      len.writeUInt32BE(data.length);
      socket.write(len);
      socket.write(data);
      socket.write(Buffer.from([0, 0, 0, 0]));
    });
    socket.on('data', (d) => {
      response += d.toString();
    });
    socket.on('end', () => {
      const r = response.trim();
      if (r.includes('OK')) finish({ status: 'clean' });
      else if (r.includes('FOUND')) finish({ status: 'infected', threat: r.replace('stream:', '').replace('FOUND', '').trim() });
      else finish({ status: 'error' });
    });
    socket.on('timeout', () => finish({ status: 'error' }));
    socket.on('error', () => finish({ status: 'error' }));
  });
}
