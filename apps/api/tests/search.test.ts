import { describe, expect, it } from 'vitest';
import { parseSearchQuery } from '../src/routes/search.js';

describe('search operator parser', () => {
  it('parses operators and free text', () => {
    const p = parseSearchQuery('from:alice alias:jobs has:attachment is:unread after:2026-01-01 invoice');
    expect(p.from).toBe('alice');
    expect(p.alias).toBe('jobs');
    expect(p.hasAttachment).toBe(true);
    expect(p.unread).toBe(true);
    expect(p.after).toBe('2026-01-01');
    expect(p.freeText).toContain('invoice');
  });

  it('supports quoted values', () => {
    const p = parseSearchQuery('subject:"hello world"');
    expect(p.subject).toBe('hello world');
  });

  it('keeps unknown tokens as free text', () => {
    const p = parseSearchQuery('foo:bar baz');
    expect(p.freeText).toContain('baz');
  });
});
