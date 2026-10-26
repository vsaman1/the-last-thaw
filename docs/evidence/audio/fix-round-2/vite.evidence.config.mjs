import base from '../../../../vite.config.ts';
import { readFileSync, existsSync } from 'node:fs';

import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Scratch files (the recordings before the lossless gain, the dependency cache) live outside the repository.
const SCRATCH = process.env.EVIDENCE_SCRATCH ?? path.join(os.tmpdir(), 'iceberg-audio-evidence');

function scratchTools() {
  return {
    name: 'fix2-scratch',
    configureServer(server) {
      // The recordings as they were before the lossless gain (for the before/after decode check).
      server.middlewares.use('/__orig/', (req, res, next) => {
        const f = `${SCRATCH}/orig-audio/${decodeURIComponent(req.url.split('?')[0].replace(/^\//, ''))}`;
        if (!existsSync(f)) return next();
        res.setHeader('content-type', 'audio/mpeg');
        res.end(readFileSync(f));
      });
      // HMR trigger: re-run a module's update the way an edit would (server.reloadModule).
      server.middlewares.use('/__fix2_hmr', async (req, res) => {
        const u = new URL(req.url, 'http://x');
        const file = u.searchParams.get('file');
        const mods = server.moduleGraph.getModulesByFile(file);
        let n = 0;
        for (const m of mods ?? []) { await server.reloadModule(m); n++; }
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ file, n }));
      });
    },
  };
}

const resolved = typeof base === 'function' ? base({ command: 'serve', mode: 'development' }) : base;
export default {
  ...resolved,
  root: fileURLToPath(new URL('../../../../', import.meta.url)),
  plugins: [...(resolved.plugins ?? []), scratchTools()],
  cacheDir: `${SCRATCH}/vite-cache`,
  server: { ...(resolved.server ?? {}), port: 5199, strictPort: true, hmr: process.env.FIX2_HMR === '1' ? (resolved.server?.hmr ?? true) : false, watch: process.env.FIX2_HMR === '1' ? resolved.server?.watch : null },
};
