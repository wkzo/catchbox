import { describe, expect, it } from 'vitest';
import { formatBytes, initialOf, senderLabel } from '../src/lib/format.js';

describe('format helpers', () => {
  it('formats bytes', () => {
    expect(formatBytes(500)).toBe('500 Б');
    expect(formatBytes(2048)).toBe('2 КБ');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 МБ');
  });

  it('prefers display name, falls back to local part', () => {
    expect(senderLabel('Alice', 'alice@x.y')).toBe('Alice');
    expect(senderLabel(null, 'alice@x.y')).toBe('alice');
    expect(senderLabel(null, null)).toContain('неизвестный');
  });

  it('derives avatar initial', () => {
    expect(initialOf('alice', null)).toBe('A');
    expect(initialOf(null, 'bob@x.y')).toBe('B');
  });
});
