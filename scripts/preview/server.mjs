import { createServer as createNetServer } from 'node:net';
import { resolve } from 'node:path';
import { createServer } from 'vite';

// The dev server of the preview, through the JS API of Vite: on a free port (1420 may be taken by a neighbouring
// working copy), with the project's vite.config.ts, which adds the preview plugin.

export const projectRoot = resolve(import.meta.dirname, '..', '..');

/** A port nobody listens on now. */
export function freePort() {
  return new Promise((resolvePort, reject) => {
    const probe = createNetServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = /** @type {import('node:net').AddressInfo} */ (probe.address());
      probe.close(() => resolvePort(port));
    });
  });
}

/**
 * Starts the server and returns it with its address. `quiet` leaves Vite's own messages out but errors.
 * @param {{ port?: number, quiet?: boolean }} [options]
 */
export async function startDevServer(options = {}) {
  const port = options.port ?? (await freePort());
  const server = await createServer({
    root: projectRoot,
    configFile: resolve(projectRoot, 'vite.config.ts'),
    logLevel: options.quiet ? 'error' : 'info',
    clearScreen: false,
    // the console of the page is read by the screenshot script itself; Vite would also copy it into this terminal
    server: { port, strictPort: true, forwardConsole: false },
  });
  await server.listen();
  return { server, url: `http://localhost:${port}` };
}
