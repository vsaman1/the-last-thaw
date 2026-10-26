import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Connect, Plugin, ViteDevServer } from 'vite';

/**
 * Mounts the agent service on the Vite dev server (`npm run dev`) and the preview server
 * (`npm run preview`) under /api/story/. The handler module is loaded with ssrLoadModule on each request,
 * never imported here: the core's Vite-only module features keep working on the server side, and
 * nothing server-side (or any key) can end up in the browser bundle.
 *
 * A load that fails must not stick. Vite keeps a module's evaluation error and throws it again on every
 * later ssrLoadModule until the file changes, so one slow first load (2026-10-22: Vite's module transport
 * timed out after 60 s while it was still bundling dependencies on a busy machine) turned the agents off
 * until the server was restarted. On a failure the server-side module graph is invalidated, so the next
 * request loads afresh. The handler is also loaded once when the server starts listening, so the first
 * player request does not pay for the load.
 */

const PREFIX = '/api/story/';
const HANDLER = '/src/server/handler.ts';

interface HandlerModule {
  handleStoryRequest(req: IncomingMessage, res: ServerResponse, projectRoot: string): Promise<void>;
}

/** Loads the handler through a dev server; after a failure, forgets it so the next call starts again. */
function retryingLoader(dev: () => Promise<ViteDevServer>): () => Promise<HandlerModule> {
  return async () => {
    const server = await dev();
    try {
      return (await server.ssrLoadModule(HANDLER)) as unknown as HandlerModule;
    } catch (e) {
      server.environments.ssr.moduleGraph.invalidateAll();
      throw e;
    }
  };
}

function middleware(load: () => Promise<HandlerModule>, root: string, log: (msg: string) => void): Connect.NextHandleFunction {
  return (req, res, next) => {
    if (!req.url?.startsWith(PREFIX)) return next();
    load()
      .then((m) => m.handleStoryRequest(req, res, root))
      .catch((e: unknown) => {
        log(`[last-thaw agents] ${e instanceof Error ? e.message : String(e)} (the next request loads it again)`);
        if (!res.headersSent) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: 'the agent service failed to load' }));
        }
      });
  };
}

/** Load the handler in the background once the server listens (a failure is logged and retried later). */
function preload(httpServer: { once(event: 'listening', fn: () => void): unknown } | null, load: () => Promise<HandlerModule>, log: (msg: string) => void): void {
  httpServer?.once('listening', () => {
    load().catch((e: unknown) => log(`[last-thaw agents] preload failed: ${e instanceof Error ? e.message : String(e)} (the next request loads it again)`));
  });
}

export function storyAgentsPlugin(): Plugin {
  return {
    name: 'last-thaw-agents',
    configureServer(server) {
      const log = (m: string): void => server.config.logger.error(m);
      const load = retryingLoader(async () => server);
      preload(server.httpServer, load, log);
      server.middlewares.use(middleware(load, server.config.root, log));
    },
    configurePreviewServer(server) {
      // The preview server has no module loader of its own: a small middleware-mode dev server (no
      // config file, no HMR, no watcher) loads the handler on first use.
      const log = (m: string): void => server.config.logger.error(m);
      let dev: Promise<ViteDevServer> | undefined;
      const load = retryingLoader(() => {
        dev ??= import('vite').then((v) =>
          v.createServer({
            root: server.config.root,
            configFile: false,
            appType: 'custom',
            logLevel: 'warn',
            server: { middlewareMode: true, hmr: false, watch: null },
          }),
        );
        return dev;
      });
      preload(server.httpServer, load, log);
      server.httpServer?.on('close', () => void dev?.then((d) => d.close()));
      server.middlewares.use(middleware(load, server.config.root, log));
    },
  };
}
