import { describe, expect, it } from 'vitest';
import { sanitizeEmailHtml, stripHtmlToText } from '../src/lib/sanitize.js';

describe('sanitizeEmailHtml', () => {
  it('removes scripts, forms and iframes', () => {
    const html = '<p>ok</p><script>alert(1)</script><iframe src="https://evil"></iframe><form action="https://evil"><input name="x"></form>';
    const out = sanitizeEmailHtml(html);
    expect(out).not.toContain('<script');
    expect(out).not.toContain('<iframe');
    expect(out).not.toContain('<form');
    expect(out).not.toContain('<input');
    expect(out).toContain('ok');
  });

  it('blocks remote images by default (anti tracking-pixel)', () => {
    const out = sanitizeEmailHtml('<img src="https://tracker.example/pixel.png" alt="t">');
    // The live src must not point at the remote URL (data-remote-src holds it for opt-in).
    expect(out).not.toMatch(/(?<![-\w])src="https?:/);
    expect(out).toContain('data-remote-src="https://tracker.example/pixel.png"');
    expect(out).toContain('data:image/gif');
  });

  it('keeps inline data images', () => {
    const out = sanitizeEmailHtml('<img src="data:image/png;base64,QUJD" alt="t">');
    expect(out).toContain('src="data:image/png;base64,QUJD"');
  });

  it('strips javascript: links', () => {
    const out = sanitizeEmailHtml('<a href="javascript:alert(1)">x</a>');
    expect(out).not.toContain('javascript:');
  });

  it('removes on* handlers', () => {
    const out = sanitizeEmailHtml('<img src="data:image/gif;base64,R0" onerror="alert(1)">');
    expect(out).not.toContain('onerror');
  });
});

describe('stripHtmlToText', () => {
  it('converts to plain text', () => {
    expect(stripHtmlToText('<p>a</p><p>b</p>')).toContain('a');
    expect(stripHtmlToText('<p>a</p><p>b</p>')).not.toContain('<p>');
  });
});
