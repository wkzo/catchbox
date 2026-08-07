import { verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { generateDkimKeyPair, signMessage } from '../src/lib/dkim.js';

function extractSig(signed: string): { b: string; signedHeaders: string[]; body: string } {
  const [head = '', ...rest] = signed.split('\r\n\r\n');
  const sigLine = head.split('\r\n').find((l) => l.startsWith('DKIM-Signature:'))!;
  const b = sigLine.match(/b=([^;]+)$/)?.[1] ?? '';
  const h = sigLine.match(/h=([^;]+);/)?.[1] ?? '';
  return { b, signedHeaders: h.split(':'), body: rest.join('\r\n\r\n') };
}

describe('DKIM signing', () => {
  it('produces a verifiable relaxed/relaxed rsa-sha256 signature', () => {
    const { privateKeyPem, publicKeyPem } = generateDkimKeyPair();
    const raw = [
      'From: a@example.com',
      'To: b@example.com',
      'Subject: Test',
      'Date: Thu, 07 Aug 2026 10:00:00 +0000',
      'Message-ID: <m1@example.com>',
      '',
      'Hello body',
    ].join('\r\n');
    const signed = signMessage(raw, { domain: 'example.com', selector: 'quit', privateKeyPem });
    expect(signed.startsWith('DKIM-Signature:')).toBe(true);
    expect(signed).toContain('c=relaxed/relaxed');
    expect(signed).toContain('d=example.com');

    const { b, signedHeaders } = extractSig(signed);
    // rebuild canonicalized signer input the same way as the signer
    const relaxed = (name: string, value: string) => `${name.toLowerCase()}:${value.replace(/[ \t]+/g, ' ').trim()}`;
    const lines = raw.split('\r\n\r\n')[0]!.split('\r\n').map((l) => {
      const i = l.indexOf(':');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()] as [string, string];
    });
    const parts: string[] = [];
    for (const hname of signedHeaders) {
      const found = [...lines].reverse().find(([n]) => n.toLowerCase() === hname);
      if (found) parts.push(relaxed(found[0], found[1]) + '\r\n');
    }
    const sigValue = signed.split('\r\n')[0]!.replace('DKIM-Signature: ', '').replace(/b=[^;]*$/, 'b=');
    parts.push(relaxed('DKIM-Signature', sigValue));
    const ok = verify('RSA-SHA256', Buffer.from(parts.join('')), publicKeyPem, Buffer.from(b, 'base64'));
    expect(ok).toBe(true);
  });
});
