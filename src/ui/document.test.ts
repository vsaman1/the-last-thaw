import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const html = readFileSync(fileURLToPath(new URL('../../index.html', import.meta.url)), 'utf8');

describe('index.html', () => {
  // Regression (review spec-ux #4): no icon link → the browser requests /favicon.ico → a 404 console
  // error on every fresh load. An inline data: icon needs no file and works offline.
  it('declares an inline favicon so no /favicon.ico request is made', () => {
    const link = /<link\s[^>]*rel="icon"[^>]*>/.exec(html)?.[0] ?? '';
    expect(link).not.toBe('');
    expect(link).toMatch(/href="data:image\/svg\+xml,/);
  });
});
