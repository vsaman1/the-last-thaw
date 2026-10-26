// @vitest-environment node
/**
 * The agent service's Vite plugin recovers from a failed load. Vite keeps a module's evaluation error and
 * throws it again on every later ssrLoadModule until the file changes; on a slow first start (the module
 * transport timed out while dependencies were still being bundled, 2026-10-22) that turned the agents off
 * until a restart. A stand-in handler whose first evaluation throws plays that failure here.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createServer, type ViteDevServer } from 'vite';
import { afterEach, expect, it } from 'vitest';
import { storyAgentsPlugin } from './vitePlugin';

const FAKE_HANDLER = `
const g = globalThis as { __ltPluginLoads?: number };
g.__ltPluginLoads = (g.__ltPluginLoads ?? 0) + 1;
if (g.__ltPluginLoads === 1) throw new Error('the first load fails');
export async function handleStoryRequest(_req: unknown, res: { setHeader(k: string, v: string): void; end(s: string): void }): Promise<void> {
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ ok: true, loads: g.__ltPluginLoads }));
}
`;

const loads = (): number => (globalThis as { __ltPluginLoads?: number }).__ltPluginLoads ?? 0;
let server: ViteDevServer | undefined;
let root: string | undefined;

afterEach(async () => {
  await server?.close();
  if (root) rmSync(root, { recursive: true, force: true });
  delete (globalThis as { __ltPluginLoads?: number }).__ltPluginLoads;
});

it('a failed load does not stick: the next request loads the handler again', async () => {
  root = mkdtempSync(path.join(os.tmpdir(), 'lt-plugin-'));
  mkdirSync(path.join(root, 'src', 'server'), { recursive: true });
  writeFileSync(path.join(root, 'src', 'server', 'handler.ts'), FAKE_HANDLER);
  server = await createServer({
    root,
    configFile: false,
    logLevel: 'silent',
    plugins: [storyAgentsPlugin()],
    server: { port: 0, host: '127.0.0.1', hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  await server.listen();
  const port = (server.httpServer?.address() as AddressInfo).port;
  const url = `http://127.0.0.1:${port}/api/story/status`;
  // The first load fails: in the preload when the server starts listening, or else in a first request.
  for (const t0 = Date.now(); loads() < 1 && Date.now() - t0 < 3000; ) await new Promise((r) => setTimeout(r, 20));
  if (loads() < 1) expect((await fetch(url)).status).toBe(500);
  expect(loads()).toBe(1);
  // The next request must load the handler afresh rather than meet the remembered error.
  const res = await fetch(url);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true, loads: 2 });
  // Loaded once it worked, not again per request.
  const again = await fetch(url);
  expect(await again.json()).toEqual({ ok: true, loads: 2 });
}, 30_000);
