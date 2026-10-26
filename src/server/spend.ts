import { createHash, randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { OWN_KEY_MODEL } from './config';
import { BudgetError } from './llm';

/**
 * The own-key provider's daily spending limit (OPENAI_DAILY_USD_LIMIT): the player's own money.
 *
 * Every own-key request HOLDS its ceiling (the most it could cost: costCeilingUsd in pricing.ts) before
 * it is sent, and is refused when today's charges plus that ceiling would pass the limit. A hold counts
 * like money spent while its request is in flight, so narratives running at once cannot pass the limit
 * together. When the response arrives the hold is SETTLED to the response's real cost, from its own
 * usage object; a request that returned no usage (timed out, cancelled, unreadable) may still have been
 * billed, so it stays charged at its ceiling. That is the limit's own count: the usage logs still record
 * only what responses report. The day's charges therefore stay within the limit as long as no request
 * costs more than its ceiling.
 *
 * Charges are kept in a ledger shared by every server on the same key: one small file per key and UTC
 * day in the OS temp folder, named by a hash of the key (never the key). `npm run dev` and `npm run
 * preview`, or the main checkout and a worktree, count against one limit, and a restart keeps the day.
 * Each decision reads the file and appends its hold in one synchronous step, so requests within one
 * server never race; two servers deciding in the same instant could each pass one request (no lock).
 */

/** One line of the ledger: a request's hold before it is sent, or what it finally counts for. */
export interface LedgerEntry {
  /** Unique per request (process, instance and sequence). */
  readonly id: string;
  /** 'hold': the ceiling, while the request is in flight. 'settle': the final charge (replaces the hold). */
  readonly kind: 'hold' | 'settle';
  readonly usd: number;
}

/** Where the charges are kept, per UTC day. `read` throws when the charges cannot be read. */
export interface SpendLedger {
  read(day: string): LedgerEntry[];
  append(day: string, entry: LedgerEntry): void;
}

/** One process's ledger (tests, and a server without an OpenAI key). */
export function memoryLedger(): SpendLedger {
  const days = new Map<string, LedgerEntry[]>();
  return {
    read: (day) => [...(days.get(day) ?? [])],
    append: (day, entry) => void days.set(day, [...(days.get(day) ?? []), entry]),
  };
}

/** The file ledgers' folder: the OS user's temp folder, which every checkout on this machine shares. */
export const defaultLedgerDir = (): string => path.join(os.tmpdir(), 'last-thaw-own-key-spend');

/** The ledger's name for a key: a hash of it, so the key itself is never written anywhere. */
export const ledgerKeyId = (apiKey: string): string =>
  createHash('sha256').update(`last-thaw own-key ledger\n${apiKey}`).digest('hex').slice(0, 16);

const isEntry = (v: unknown): v is LedgerEntry => {
  const e = v as Partial<LedgerEntry> | null;
  return typeof e?.id === 'string' && (e.kind === 'hold' || e.kind === 'settle') && typeof e.usd === 'number' && Number.isFinite(e.usd) && e.usd >= 0;
};

/** The file ledger for `apiKey` in `dir`: <dir>/<hash of the key>-<UTC day>.jsonl, one entry per line. */
export function fileLedger(dir: string, apiKey: string): SpendLedger & { readonly fileFor: (day: string) => string } {
  const fileFor = (day: string): string => path.join(dir, `${ledgerKeyId(apiKey)}-${day}.jsonl`);
  return {
    fileFor,
    read(day) {
      const file = fileFor(day);
      if (!existsSync(file)) return [];
      const out: LedgerEntry[] = [];
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try {
          const e: unknown = JSON.parse(line);
          if (isEntry(e)) out.push(e);
        } catch {
          // a torn line (a process killed mid-write) is skipped
        }
      }
      return out;
    },
    append(day, entry) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      appendFileSync(fileFor(day), `${JSON.stringify(entry)}\n`, { encoding: 'utf8', mode: 0o600 });
    },
  };
}

/** A request's claim on the limit, from before it is sent until its cost is known. */
export interface SpendHold {
  /** What the request holds against the limit until it is settled. */
  readonly ceilingUsd: number;
  /** Replaces the hold with what the request finally counts for (once; later calls do nothing). */
  settle(usd: number): void;
}

const utcDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const clampUsd = (v: number): number => (Number.isFinite(v) ? Math.round(Math.max(0, v) * 1e8) / 1e8 : 0);
const usd2 = (v: number): string => `$${v.toFixed(2)}`;
const usd4 = (v: number): string => `$${v.toFixed(4)}`;
/** Below the ledger's resolution (1e-8 USD): sums of rounded amounts compare as the amounts do. */
const EPS = 1e-9;

/** Why own-key requests stop when the ledger cannot be read or written: an unknown spend fails closed. */
export const LEDGER_ERROR_REASON = `today's spending on your own OpenAI key cannot be read or recorded (the ledger in the temp folder), so ${OWN_KEY_MODEL} is paused`;

export class SpendCap {
  private seq = 0;
  private readonly instance = randomBytes(4).toString('hex');
  /** The last ceiling refused for want of room today: less than that left means no narrative can start. */
  private refused: { readonly day: string; readonly ceiling: number } | undefined;

  constructor(
    readonly limitUsd: number,
    private readonly now: () => number = Date.now,
    /**
     * USD of today's own-key records in logs/agent-usage.jsonl. The ledger is topped up to it, so a ledger
     * file that was lost (the temp folder cleaned) does not reset the day.
     */
    seedUsdToday = 0,
    private readonly ledger: SpendLedger = memoryLedger(),
  ) {
    const seed = clampUsd(seedUsdToday);
    if (seed === 0) return;
    try {
      const day = utcDay(this.now());
      const missing = clampUsd(seed - this.tally(day).spent);
      if (missing > 0) this.ledger.append(day, { id: this.nextId('log'), kind: 'settle', usd: missing });
    } catch {
      // reported by reason() and refused by hold()
    }
  }

  private nextId(tag: string): string {
    return `${tag}-${process.pid}-${this.instance}-${++this.seq}`;
  }

  /** A day's charges: each settled request at what it counts for, each open hold at its ceiling. */
  private tally(day: string): { readonly spent: number; readonly inFlight: number } {
    const holds = new Map<string, number>();
    const settled = new Map<string, number>();
    for (const e of this.ledger.read(day)) (e.kind === 'hold' ? holds : settled).set(e.id, e.usd);
    let spent = 0;
    let inFlight = 0;
    for (const v of settled.values()) spent += v;
    for (const [id, v] of holds) {
      if (settled.has(id)) continue;
      spent += v;
      inFlight += v;
    }
    return { spent: clampUsd(spent), inFlight: clampUsd(inFlight) };
  }

  /** Why a request of `ceiling` (or, without one, any request) is refused with `spent` charged; undefined when it fits. */
  private refusal(day: string, spent: number, ceiling?: number): string | undefined {
    const limit = usd2(this.limitUsd);
    if (spent >= this.limitUsd - EPS) return `today's spending on your own OpenAI key (${usd4(spent)}) reached OPENAI_DAILY_USD_LIMIT (${limit}); it resets at 00:00 UTC`;
    const need = ceiling ?? (this.refused?.day === day ? this.refused.ceiling : 0);
    if (spent + need <= this.limitUsd + EPS) return undefined;
    return (
      `today's spending on your own OpenAI key (${usd4(spent)}) leaves ${usd4(this.limitUsd - spent)} of OPENAI_DAILY_USD_LIMIT ` +
      `(${limit}), less than a request may cost (${usd4(need)}); it resets at 00:00 UTC`
    );
  }

  /**
   * Why own-key requests are refused now, or undefined: the limit reached, less left than the last
   * request refused today needed, or the ledger unreadable.
   */
  reason(): string | undefined {
    const day = utcDay(this.now());
    try {
      return this.refusal(day, this.tally(day).spent);
    } catch {
      return LEDGER_ERROR_REASON;
    }
  }

  /** Whether own-key requests are refused now (a limit of 0 is always reached). */
  reached(): boolean {
    return this.reason() !== undefined;
  }

  /**
   * Holds `ceilingUsd` for one own-key request before it is sent. Throws BudgetError, and holds nothing,
   * when today's charges plus the ceiling would pass the limit (or the ledger cannot be used).
   */
  hold(ceilingUsd: number): SpendHold {
    const day = utcDay(this.now());
    const ceiling = clampUsd(ceilingUsd);
    let spent: number;
    try {
      spent = this.tally(day).spent;
    } catch {
      throw new BudgetError(LEDGER_ERROR_REASON);
    }
    const why = this.refusal(day, spent, ceiling);
    if (why) {
      if (spent < this.limitUsd - EPS) this.refused = { day, ceiling };
      throw new BudgetError(why);
    }
    const id = this.nextId('req');
    try {
      this.ledger.append(day, { id, kind: 'hold', usd: ceiling });
    } catch {
      throw new BudgetError(LEDGER_ERROR_REASON);
    }
    let open = true;
    return {
      ceilingUsd: ceiling,
      settle: (amount) => {
        if (!open) return;
        open = false;
        try {
          // On the day it was held, whenever it ends.
          this.ledger.append(day, { id, kind: 'settle', usd: clampUsd(amount) });
        } catch {
          // the hold stands: the request stays charged at its ceiling
        }
      },
    };
  }

  /** Today's charges against the limit (`inFlightUsd` of them: holds of requests not yet settled). */
  snapshot(): { readonly day: string; readonly spentUsd: number | null; readonly inFlightUsd: number | null; readonly limitUsd: number } {
    const day = utcDay(this.now());
    try {
      const t = this.tally(day);
      return { day, spentUsd: t.spent, inFlightUsd: t.inFlight, limitUsd: this.limitUsd };
    } catch {
      return { day, spentUsd: null, inFlightUsd: null, limitUsd: this.limitUsd };
    }
  }
}
