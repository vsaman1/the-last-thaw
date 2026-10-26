/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { storyAgentsPlugin } from './src/server/vitePlugin';

export default defineConfig({
  // Story Mode's agent service (/api/story/*) runs inside the dev and preview servers.
  plugins: [react(), storyAgentsPlugin()],
  base: './',
  server: {
    port: 5173,
    strictPort: true,
    // Git worktrees under .claude/ are other copies of this repo: watching them let an edit there reload
    // this page and even clear this server's dependency cache (a worktree's tsconfig.json), which left the
    // page blank with "504 Outdated Optimize Dep" (2026-10-23). The agent service's logs change on every
    // request and are not app code either.
    watch: { ignored: ['**/.claude/**', '**/logs/**'] },
  },
  // Scan only the game's own entry for dependencies: by default Vite crawls every index.html under the
  // root, the worktrees' copies included, which made the first start slow.
  optimizeDeps: { entries: ['index.html'] },
  // One ~6 MB chunk is expected: @dimforge/rapier3d-compat embeds its WASM as base64 (so the game runs
  // offline with no extra asset hosting) and three.js is large. A local game, not a website.
  build: { chunkSizeWarningLimit: 6500 },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    testTimeout: 30000,
  },
});
