import { describe, expect, it } from 'vitest';
import { normalizeSubject, parseMime } from '../src/lib/mime.js';

const MULTIPART = Buffer.from(
  [
    'From: =?UTF-8?B?0KLQtdGB0YI=?= <sender@example.com>',
    'To: rcpt@example.com',
    'Subject: =?UTF-8?B?0J/RgNC40LLQtdGC?= order #42',
    'Message-ID: <mm1@example.com>',
    'Date: Thu, 07 Aug 2026 09:00:00 +0000',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="mix"',
    '',
    '--mix',
    'Content-Type: multipart/alternative; boundary="alt"',
    '',
    '--alt',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    'plain =D0=BF=D1=80=D0=B8=D0=B2=D0=B5=D1=82',
    '--alt',
    'Content-Type: text/html; charset=utf-8',
    '',
    '<html><body><b>html</b><script>x</script></body></html>',
    '--alt--',
    '--mix',
    'Content-Type: text/plain; name="note.txt"',
    'Content-Disposition: attachment; filename="note.txt"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from('attachment body').toString('base64'),
    '--mix--',
  ].join('\r\n'),
);

describe('parseMime', () => {
  it('decodes unicode headers, quoted-printable, multipart and attachments', async () => {
    const m = await parseMime(MULTIPART);
    expect(m.subject).toContain('Привет');
    expect(m.from.name).toContain('Тест');
    expect(m.textBody).toContain('привет');
    expect(m.htmlBody).toContain('<b>html</b>');
    expect(m.htmlBody).not.toContain('<script>');
    expect(m.attachments.length).toBe(1);
    expect(m.attachments[0]!.filename).toBe('note.txt');
    expect(m.attachments[0]!.content.toString()).toBe('attachment body');
  });

  it('handles missing subject and malformed MIME gracefully', async () => {
    const m = await parseMime(Buffer.from('garbage\r\nnot a mime\r\n\r\nbody text'));
    expect(typeof m.subject).toBe('string');
    expect(m.textBody).toContain('body text');
  });

  it('truncates absurdly long subjects', async () => {
    const raw = Buffer.from(`From: a@b.c\r\nTo: d@e.f\r\nSubject: ${'x'.repeat(3000)}\r\n\r\nb`);
    const m = await parseMime(raw);
    expect(m.subject.length).toBeLessThanOrEqual(998);
  });
});

describe('normalizeSubject', () => {
  it('strips reply prefixes and normalizes', () => {
    expect(normalizeSubject('Re: Re[2]: Hello   World')).toBe('hello world');
    expect(normalizeSubject('Fwd: Привет')).toBe('привет');
    expect(normalizeSubject('  ')).toBe('');
  });
});
