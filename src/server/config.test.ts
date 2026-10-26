import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { STORY_MODELS } from '../story/types';
import {
  canonicalHost,
  COURSE_MODEL,
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  DEFAULT_OWN_KEY_DAILY_USD,
  loadConfig,
  MAX_OWN_KEY_DAILY_USD,
  MODEL_PROVIDERS,
  OFFERED_MODELS,
  OPENAI_BASE_URL,
  providerOf,
  SECRET_CANARY,
  UNREADABLE_LIMIT_REASON,
} from './config';
import { loadEnv, parseEnv } from './env';

const root = mkdtempSync(path.join(tmpdir(), 'lt-env-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('.env loading', () => {
  it('parses the small dotenv subset', () => {
    const v = parseEnv(
      '﻿# comment\nexport A=1\nB = two words # trailing comment\nC="quoted # not a comment\\n"\nD=\'single $x\'\nbad line\n1X=no\nE=\n',
    );
    expect(v).toEqual({ A: '1', B: 'two words', C: 'quoted # not a comment\n', D: 'single $x', E: '' });
  });

  it('reads the project folder then its parents; nearest wins; the real environment wins over files', () => {
    const project = path.join(root, 'course', 'project');
    mkdirSync(project, { recursive: true });
    writeFileSync(path.join(root, 'course', '.env'), 'PORTKEY_API_KEY=from-parent\nMODEL_NAME=parent-model\n');
    writeFileSync(path.join(project, '.env'), 'MODEL_NAME=project-model\ntoString=from-file\n');
    const { vars, files } = loadEnv(project, { MODEL_NAME: undefined, OTHER: 'real' });
    expect(vars.PORTKEY_API_KEY).toBe('from-parent');
    expect(vars.MODEL_NAME).toBe('project-model');
    expect(vars.OTHER).toBe('real');
    // A key named like an Object.prototype member is an ordinary key (own-property check).
    expect(Object.entries(vars)).toContainEqual(['toString', 'from-file']);
    expect(files[0]).toBe(path.join(project, '.env'));
    expect(loadEnv(project, { MODEL_NAME: 'real-model' }).vars.MODEL_NAME).toBe('real-model');
  });
});

describe('loadConfig', () => {
  it('is unavailable without a key, with a reason that never contains a value', () => {
    const c = loadConfig(root, {});
    const course = c.providers.course;
    expect(course.apiKey).toBeUndefined();
    expect(course.unavailableReason).toMatch(/PORTKEY_API_KEY not set/);
    expect(c.model).toBe(DEFAULT_MODEL);
    expect(course.baseUrl).toBe(DEFAULT_BASE_URL);
    expect(c.secrets).toEqual([SECRET_CANARY]);
    const own = c.providers['own-key'];
    expect(own.apiKey).toBeUndefined();
    expect(own.unavailableReason).toMatch(/OPENAI_API_KEY not set .*gpt-6-sol runs only on your own OpenAI key, billed to you/);
    expect(own.baseUrl).toBe(OPENAI_BASE_URL);
    expect(c.ownKeyDailyUsdLimit).toBe(DEFAULT_OWN_KEY_DAILY_USD);
    expect(c.notes).toEqual([]);
  });

  it('uses the key and a safe base URL override; STORY_AI=off disables both providers', () => {
    const c = loadConfig(root, { PORTKEY_API_KEY: 'k-123456789', PORTKEY_BASE_URL: 'http://localhost:8787/v1/' });
    expect(c.providers.course.apiKey).toBe('k-123456789');
    expect(c.providers.course.unavailableReason).toBeUndefined();
    expect(c.model).toBe('gpt-6-luna');
    expect(c.providers.course.baseUrl).toBe('http://localhost:8787/v1');
    expect(c.secrets).toContain('k-123456789');
    const evil = loadConfig(root, { PORTKEY_API_KEY: 'k', PORTKEY_BASE_URL: 'http://evil.example/v1' });
    expect(evil.providers.course.baseUrl).toBe(DEFAULT_BASE_URL);
    expect(evil.notes).toEqual([expect.stringMatching(/PORTKEY_BASE_URL is not an https URL/)]);
    const off = loadConfig(root, { PORTKEY_API_KEY: 'k-123456789', OPENAI_API_KEY: 'sk-own-123456789', STORY_AI: 'off' });
    expect(off.providers.course.apiKey).toBeUndefined();
    expect(off.providers.course.unavailableReason).toMatch(/STORY_AI=off/);
    expect(off.providers['own-key'].apiKey).toBeUndefined();
    expect(off.providers['own-key'].unavailableReason).toMatch(/STORY_AI=off/);
    // Disabled keys are still secrets: neither may appear in any output.
    expect(off.secrets).toEqual([SECRET_CANARY, 'k-123456789', 'sk-own-123456789']);
  });

  it('reads OPENAI_API_KEY (exact name) for the own-key provider only; both keys are secrets', () => {
    const c = loadConfig(root, { PORTKEY_API_KEY: 'pk-course-123456789', OPENAI_API_KEY: ' sk-own-123456789 ' });
    expect(c.providers.course).toMatchObject({ id: 'course', keyName: 'PORTKEY_API_KEY', apiKey: 'pk-course-123456789', baseUrl: DEFAULT_BASE_URL });
    expect(c.providers['own-key']).toMatchObject({ id: 'own-key', keyName: 'OPENAI_API_KEY', apiKey: 'sk-own-123456789', baseUrl: OPENAI_BASE_URL });
    expect(c.providers['own-key'].unavailableReason).toBeUndefined();
    expect(c.secrets).toEqual([SECRET_CANARY, 'pk-course-123456789', 'sk-own-123456789']);
    // Other spellings are not the course's names and are ignored.
    for (const name of ['OPENAI_KEY', 'openai_api_key', 'OPEN_AI_API_KEY']) {
      expect(loadConfig(root, { [name]: 'sk-own-123456789' }).providers['own-key'].apiKey).toBeUndefined();
    }
  });

  it('MODEL_NAME sets the default only to an allowlisted model; anything else falls back to gpt-6-luna with a note', () => {
    expect(loadConfig(root, { MODEL_NAME: 'gpt-6-sol' }).model).toBe('gpt-6-sol');
    expect(loadConfig(root, { MODEL_NAME: ' gpt-6-luna ' }).model).toBe('gpt-6-luna');
    for (const bad of ['gpt-6-luna-mini', 'gpt-4o', 'bad model\nname', 'constructor', '__proto__', 'toString', 'sk-a-key-pasted-here']) {
      const c = loadConfig(root, { MODEL_NAME: bad });
      expect(c.model, bad).toBe(DEFAULT_MODEL);
      expect(c.notes, bad).toEqual([expect.stringMatching(/^MODEL_NAME is not an offered model \(gpt-6-luna, gpt-6-sol\); using gpt-6-luna$/)]);
      // The note never repeats the value (a key pasted into the wrong variable is not printed).
      expect(c.notes.join(' ')).not.toContain(bad.trim());
    }
  });

  it('the allowlist: luna on the course key, sol on your own key, nothing else (prototype names included)', () => {
    expect(OFFERED_MODELS).toEqual(['gpt-6-luna', 'gpt-6-sol']);
    expect(providerOf('gpt-6-luna')).toBe('course');
    expect(providerOf('gpt-6-sol')).toBe('own-key');
    // The course key serves exactly one model.
    expect(OFFERED_MODELS.filter((m) => providerOf(m) === 'course')).toEqual([COURSE_MODEL]);
    for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf', 'gpt-6-luna-mini', '', 'GPT-6-SOL']) {
      expect(providerOf(name), name).toBeUndefined();
    }
    expect(providerOf(undefined)).toBeUndefined();
    expect(providerOf(42)).toBeUndefined();
    expect(Object.getPrototypeOf(MODEL_PROVIDERS)).toBeNull();
    expect(Object.isFrozen(MODEL_PROVIDERS)).toBe(true);
    // The browser's list of models is the same list.
    expect([...STORY_MODELS]).toEqual(OFFERED_MODELS);
  });

  it('OPENAI_DAILY_USD_LIMIT is sanitised: plain dollars, capped; 0 turns gpt-6-sol off; unreadable fails closed', () => {
    const limit = (raw: string | undefined): number => loadConfig(root, { OPENAI_DAILY_USD_LIMIT: raw }).ownKeyDailyUsdLimit;
    expect(limit(undefined)).toBe(2);
    expect(limit('')).toBe(2);
    expect(limit('2.00')).toBe(2);
    expect(limit(' 0.5 ')).toBe(0.5);
    expect(limit('5')).toBe(5);
    // The natural ways to write a dollar amount mean what they say.
    expect(limit('.5')).toBe(0.5);
    expect(limit('$0.50')).toBe(0.5);
    expect(limit('$ 2')).toBe(2);
    expect(limit('0.00001')).toBe(0.00001);
    // Anything else is never the $2.00 default (which may be more than was meant): gpt-6-sol is off,
    // with the reason in /status, until the value is fixed.
    for (const bad of ['-1', 'abc', '1e3', '1e-1', '2,00', '0,50', '0.5 USD', 'NaN', 'Infinity', '0x10', '$', '.', '-0.5']) {
      const c = loadConfig(root, { OPENAI_API_KEY: 'sk-own-123456789', OPENAI_DAILY_USD_LIMIT: bad });
      expect(c.ownKeyDailyUsdLimit, bad).toBe(0);
      expect(c.providers['own-key'].apiKey, bad).toBeUndefined();
      expect(c.providers['own-key'].unavailableReason, bad).toBe(UNREADABLE_LIMIT_REASON);
      expect(c.notes, bad).toEqual([UNREADABLE_LIMIT_REASON]);
      expect(c.secrets, bad).toContain('sk-own-123456789');
    }
    expect(UNREADABLE_LIMIT_REASON).toBe('OPENAI_DAILY_USD_LIMIT is not a plain number of dollars (like 2.00), so gpt-6-sol is off until it is fixed');
    // Without a key, the missing key is the reason given.
    expect(loadConfig(root, { OPENAI_DAILY_USD_LIMIT: 'abc' }).providers['own-key'].unavailableReason).toMatch(/^OPENAI_API_KEY not set/);
    const big = loadConfig(root, { OPENAI_DAILY_USD_LIMIT: '2000' });
    expect(big.ownKeyDailyUsdLimit).toBe(MAX_OWN_KEY_DAILY_USD);
    expect(big.notes).toEqual([expect.stringMatching(/capped at 20\.00/)]);
    const zero = loadConfig(root, { OPENAI_API_KEY: 'sk-own-123456789', OPENAI_DAILY_USD_LIMIT: '0' });
    expect(zero.ownKeyDailyUsdLimit).toBe(0);
    expect(zero.providers['own-key'].apiKey).toBeUndefined();
    expect(zero.providers['own-key'].unavailableReason).toBe('disabled by OPENAI_DAILY_USD_LIMIT=0');
    expect(zero.secrets).toContain('sk-own-123456789');
  });

  it('a base URL override can never send one provider\'s key to the other\'s host', () => {
    const own = (url: string): ReturnType<typeof loadConfig> => loadConfig(root, { OPENAI_API_KEY: 'sk-own-123456789', OPENAI_BASE_URL: url });
    expect(own('https://proxy.example/v1/').providers['own-key'].baseUrl).toBe('https://proxy.example/v1');
    for (const url of ['https://api.portkey.ai/v1', 'https://eu.portkey.ai/v1']) {
      const c = own(url);
      expect(c.providers['own-key'].baseUrl, url).toBe(OPENAI_BASE_URL);
      expect(c.notes, url).toEqual([expect.stringMatching(/your OpenAI key goes only to OpenAI/)]);
    }
    // The same host as the course gateway (a local proxy for both) is refused for the OpenAI key.
    const same = loadConfig(root, { PORTKEY_BASE_URL: 'http://localhost:8787/v1', OPENAI_BASE_URL: 'http://localhost:8787/openai' });
    expect(same.providers['own-key'].baseUrl).toBe(OPENAI_BASE_URL);
    for (const url of ['https://api.openai.com/v1', 'https://eu.api.openai.com/v1']) {
      const c = loadConfig(root, { PORTKEY_API_KEY: 'pk-course-123456789', PORTKEY_BASE_URL: url });
      expect(c.providers.course.baseUrl, url).toBe(DEFAULT_BASE_URL);
      expect(c.notes, url).toEqual([expect.stringMatching(/the course key goes only to Portkey/)]);
    }
  });

  it('the host rules compare the host a URL reaches: a trailing dot or another loopback alias is the same host', () => {
    // A fully qualified name with its trailing dot (also spelled %2E, or an ideographic full stop) is the
    // same host to DNS and to TLS, so it is refused like the plain name.
    for (const url of [
      'https://api.openai.com./v1',
      'https://api.openai.com%2E/v1',
      'https://API.OPENAI.COM./v1',
      'https://api.openai.com。/v1',
      'https://api.openai.com../v1',
      'https://eu.api.openai.com./v1',
    ]) {
      const c = loadConfig(root, { PORTKEY_API_KEY: 'pk-course-123456789', PORTKEY_BASE_URL: url });
      expect(c.providers.course.baseUrl, url).toBe(DEFAULT_BASE_URL);
      expect(c.notes, url).toEqual([expect.stringMatching(/the course key goes only to Portkey/)]);
    }
    for (const url of ['https://api.portkey.ai./v1', 'https://api.portkey.ai%2E/v1', 'https://EU.PORTKEY.AI./v1']) {
      const c = loadConfig(root, { OPENAI_API_KEY: 'sk-own-123456789', OPENAI_BASE_URL: url });
      expect(c.providers['own-key'].baseUrl, url).toBe(OPENAI_BASE_URL);
      expect(c.notes, url).toEqual([expect.stringMatching(/your OpenAI key goes only to OpenAI/)]);
    }
    // Every loopback alias is this machine, so one local proxy: the OpenAI key never goes to the port the
    // course gateway listens on, whichever name either URL uses for it.
    for (const [course, own] of [
      ['http://localhost:8787/v1', 'http://127.0.0.1:8787/v1'],
      ['http://127.0.0.1:8787/v1', 'http://localhost:8787/v1'],
      ['http://localhost:8787/v1', 'https://localhost.:8787/v1'],
      ['http://localhost:8787/v1', 'https://[::1]:8787/v1'],
      ['http://localhost:8787/v1', 'https://127.0.0.2:8787/v1'],
      ['http://127.0.0.1:8787/v1', 'https://[::ffff:127.0.0.1]:8787/v1'],
      ['https://gateway.example/v1', 'https://gateway.example./v1'],
    ]) {
      const c = loadConfig(root, { PORTKEY_API_KEY: 'pk-course-123456789', OPENAI_API_KEY: 'sk-own-123456789', PORTKEY_BASE_URL: course, OPENAI_BASE_URL: own });
      const label = `${course} + ${own}`;
      expect(c.providers.course.baseUrl, label).toBe(course.replace(/\/$/, ''));
      expect(c.providers['own-key'].baseUrl, label).toBe(OPENAI_BASE_URL);
      expect(c.notes, label).toEqual([expect.stringMatching(/your OpenAI key goes only to OpenAI/)]);
    }
    // Other hosts, a trailing dot included, are not touched.
    const fine = loadConfig(root, { OPENAI_API_KEY: 'sk-own-123456789', OPENAI_BASE_URL: 'https://proxy.example./v1' });
    expect(fine.providers['own-key'].baseUrl).toBe('https://proxy.example./v1');
    expect(fine.notes).toEqual([]);
    expect(canonicalHost('https://Proxy.Example../v1')).toBe('proxy.example');
    expect(new Set(['http://localhost:1', 'http://127.0.0.1:2', 'http://[::1]:3', 'http://127.9.9.9', 'http://a.localhost'].map(canonicalHost)).size).toBe(1);
    expect(canonicalHost('https://127.example/v1')).toBe('127.example');
  });
});
