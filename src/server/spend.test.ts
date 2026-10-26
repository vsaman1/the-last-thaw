import { appendFileSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { BudgetError } from './llm';
import { costCeilingUsd, costUsd } from './pricing';
import { fileLedger, LEDGER_ERROR_REASON, ledgerKeyId, memoryLedger, SpendCap, type SpendLedger } from './spend';

const KEY = 'sk-own-spend-test-0123456789';
const dirs: string[] = [];
const tempDir = (): string => {
  const d = mkdtempSync(path.join(os.tmpdir(), 'lt-spend-'));
  dirs.push(d);
  return d;
};
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe('costCeilingUsd: the most a request can cost', () => {
  it('every body byte at the dearest input rate plus the whole output allowance; above the measured cost', () => {
    // The first Archivist request of playthrough 2's chapter 1 reflection: 14,163 bytes, 3,200 output allowed.
    // (14,163 × 2.50 + 3,200 × 10.00) / 1e6 at gpt-6-sol; 20 times less at gpt-6-luna.
    expect(costCeilingUsd('gpt-6-sol', 14_163, 3200)).toBe(0.0674075);
    expect(costCeilingUsd('gpt-6-luna', 14_163, 3200)).toBeCloseTo(0.0674075 / 20, 7);
    // What the API measured for it (2,826 in, 2,823 of them written to the cache, 88 out), at gpt-6-sol.
    const measured = costUsd('gpt-6-sol', { inputTokens: 2826, cachedInputTokens: 0, cacheWriteTokens: 2823, outputTokens: 88 });
    expect(measured).toBe(0.0079435);
    expect(measured!).toBeLessThan(costCeilingUsd('gpt-6-sol', 14_163, 3200)!);
    expect(costCeilingUsd('unpriced', 1000, 100)).toBeNull();
    expect(costCeilingUsd('constructor', 1000, 100)).toBeNull();
  });
});

describe('SpendCap: the own-key daily USD limit', () => {
  it('refuses once reached, and resets on the next UTC day; a limit of 0 is always reached', () => {
    let now = Date.parse('2026-10-21T23:59:00Z');
    const cap = new SpendCap(2, () => now, 1.99);
    expect(cap.reason()).toBeUndefined();
    const h = cap.hold(0.01); // exactly fits
    // While the request is out, its ceiling counts: nothing else fits.
    expect(cap.snapshot()).toEqual({ day: '2026-10-21', spentUsd: 2, inFlightUsd: 0.01, limitUsd: 2 });
    expect(cap.reached()).toBe(true);
    expect(() => cap.hold(0.0001)).toThrow(BudgetError);
    h.settle(0.004); // its real cost
    expect(cap.snapshot()).toEqual({ day: '2026-10-21', spentUsd: 1.994, inFlightUsd: 0, limitUsd: 2 });
    // A request that could cost more than is left is refused, and from then on the status says so too.
    expect(() => cap.hold(0.01)).toThrow(/\(\$1\.9940\) leaves \$0\.0060 of OPENAI_DAILY_USD_LIMIT \(\$2\.00\), less than a request may cost \(\$0\.0100\); it resets at 00:00 UTC/);
    expect(cap.reason()).toMatch(/leaves \$0\.0060 of OPENAI_DAILY_USD_LIMIT/);
    cap.hold(0.006).settle(0.006);
    expect(cap.reason()).toMatch(/\(\$2\.0000\) reached OPENAI_DAILY_USD_LIMIT \(\$2\.00\); it resets at 00:00 UTC/);
    expect(() => cap.hold(0)).toThrow(/reached OPENAI_DAILY_USD_LIMIT/);
    now = Date.parse('2026-10-22T00:00:01Z');
    expect(cap.reached()).toBe(false);
    expect(cap.snapshot()).toEqual({ day: '2026-10-22', spentUsd: 0, inFlightUsd: 0, limitUsd: 2 });
    // Junk never lowers the total, and a hold is settled once.
    const j = cap.hold(0.5);
    j.settle(-5);
    j.settle(1.5);
    cap.hold(0.5).settle(Number.NaN);
    expect(cap.snapshot().spentUsd).toBe(0);
    expect(new SpendCap(0).reached()).toBe(true);
    expect(() => new SpendCap(0).hold(0)).toThrow(BudgetError);
  });

  it('a request settles on the day it was held, even when it answers after midnight', () => {
    let now = Date.parse('2026-10-21T23:59:59Z');
    const ledger = memoryLedger();
    const cap = new SpendCap(2, () => now, 0, ledger);
    const h = cap.hold(0.3);
    now = Date.parse('2026-10-22T00:00:30Z');
    h.settle(0.1);
    expect(cap.snapshot()).toMatchObject({ day: '2026-10-22', spentUsd: 0 });
    expect(ledger.read('2026-10-21').map((e) => [e.kind, e.usd])).toEqual([['hold', 0.3], ['settle', 0.1]]);
  });

  it('the usage-log seed tops the ledger up, never adds to what the ledger already has', () => {
    const now = (): number => Date.parse('2026-10-21T12:00:00Z');
    const ledger = memoryLedger();
    new SpendCap(2, now, 0.5, ledger); // a lost ledger: restored from this checkout's log
    expect(new SpendCap(2, now, 0, ledger).snapshot().spentUsd).toBe(0.5);
    new SpendCap(2, now, 0.3, ledger).hold(0.1).settle(0.2); // another checkout's log knows less
    expect(new SpendCap(2, now, 0.7, ledger).snapshot().spentUsd).toBe(0.7);
  });

  it('fails closed: a ledger that cannot be read or written stops own-key requests, with the reason', () => {
    const broken: SpendLedger = {
      read: () => {
        throw new Error('EACCES');
      },
      append: () => {
        throw new Error('EACCES');
      },
    };
    const cap = new SpendCap(2, Date.now, 0, broken);
    expect(cap.reason()).toBe(LEDGER_ERROR_REASON);
    expect(() => cap.hold(0.01)).toThrow(LEDGER_ERROR_REASON);
    expect(cap.snapshot()).toMatchObject({ spentUsd: null, inFlightUsd: null });
    const readOnly: SpendLedger = { read: () => [], append: broken.append };
    expect(() => new SpendCap(2, Date.now, 0, readOnly).hold(0.01)).toThrow(LEDGER_ERROR_REASON);
    expect(LEDGER_ERROR_REASON).toMatch(/gpt-6-sol is paused$/);
  });
});

describe('fileLedger: one limit for every server on the same key', () => {
  it('two servers on one key share the day: holds in flight and charges of each count for both', () => {
    const dir = tempDir();
    const now = (): number => Date.parse('2026-10-21T12:00:00Z');
    // `npm run dev` and `npm run preview`, or the main checkout and a worktree: two processes, one key.
    const a = new SpendCap(2, now, 0, fileLedger(dir, KEY));
    const b = new SpendCap(2, now, 0, fileLedger(dir, KEY));
    const held = a.hold(0.4);
    expect(b.snapshot()).toMatchObject({ spentUsd: 0.4, inFlightUsd: 0.4 });
    held.settle(1.5);
    b.hold(0.1).settle(0.5);
    expect(a.reason()).toMatch(/\(\$2\.0000\) reached OPENAI_DAILY_USD_LIMIT/);
    expect(() => b.hold(0.01)).toThrow(/reached OPENAI_DAILY_USD_LIMIT/);
    // A server started later, or after a restart, has the day too.
    expect(new SpendCap(2, now, 0, fileLedger(dir, KEY)).reached()).toBe(true);
    // Another key has its own limit.
    expect(new SpendCap(2, now, 0, fileLedger(dir, 'sk-another-key-0123456789')).snapshot().spentUsd).toBe(0);
  });

  it('the file is named by a hash of the key; neither its name nor its lines carry the key; torn lines are skipped', () => {
    const dir = tempDir();
    const ledger = fileLedger(dir, KEY);
    const cap = new SpendCap(2, () => Date.parse('2026-10-21T12:00:00Z'), 0, ledger);
    cap.hold(0.2).settle(0.05);
    const file = ledger.fileFor('2026-10-21');
    expect(path.basename(file)).toBe(`${ledgerKeyId(KEY)}-2026-10-21.jsonl`);
    expect(ledgerKeyId(KEY)).toMatch(/^[0-9a-f]{16}$/);
    expect(ledgerKeyId(KEY)).not.toBe(ledgerKeyId(`${KEY}x`));
    for (const name of readdirSync(dir)) {
      expect(name).not.toContain(KEY);
      expect(readFileSync(path.join(dir, name), 'utf8')).not.toContain(KEY);
    }
    appendFileSync(file, '{"id":"torn","kind":"ho\nnot json\n{"id":"x","kind":"settle","usd":-3}\n');
    expect(cap.snapshot().spentUsd).toBe(0.05);
  });
});
