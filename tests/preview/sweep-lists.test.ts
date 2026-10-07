import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadSweepItems } from '../../scripts/preview/sweep-lists.mjs';
import { startDevServer } from '../../scripts/preview/server.mjs';
import { SCENES } from '../../src/preview/scenes';

// The sweep must run EVERY scene and EVERY gallery page. It reads both lists through the dev server of the preview,
// the module resolution the application itself uses: the scene modules (`./scenes-run`, `./scenes-stats`, ...) are
// imported without a file extension, which Vite resolves and plain Node does not. This is the very function the script
// calls, on a real dev server, compared with the code that registers the scenes and the pages.

type Started = Awaited<ReturnType<typeof startDevServer>>;
let started: Started;

beforeAll(async () => {
  started = await startDevServer({ quiet: true });
}, 60_000);

afterAll(async () => {
  await started.server.close();
});

describe('what the sweep would run', () => {
  it('has every scene of SCENES, the ones of the scene modules as well, and nothing else', async () => {
    const items = await loadSweepItems(started.server);
    const scenes = items.filter((i) => i.name.startsWith('scene ')).map((i) => i.name.slice('scene '.length));
    expect(scenes).toEqual(SCENES.map((s) => s.name));
    expect(scenes.length).toBeGreaterThan(25); // the scenes of src/preview/scenes.ts alone were 25: the modules add more
  });

  it('has every page of the gallery that the gallery itself knows', async () => {
    const items = await loadSweepItems(started.server);
    const registry = (await started.server.ssrLoadModule('/src/preview/gallery/registry.ts')) as { PAGES: Record<string, unknown> };
    const pages = items.filter((i) => i.name.startsWith('gallery ')).map((i) => i.name.slice('gallery '.length));
    expect([...pages].sort()).toEqual(Object.keys(registry.PAGES).sort());
  });

  it('visits the scenes first, then the pages, once each', async () => {
    const items = await loadSweepItems(started.server);
    expect(new Set(items.map((i) => i.name)).size).toBe(items.length);
    const firstPage = items.findIndex((i) => i.name.startsWith('gallery '));
    expect(items.slice(0, firstPage).every((i) => i.name.startsWith('scene '))).toBe(true);
    expect(items.slice(firstPage).every((i) => i.name.startsWith('gallery '))).toBe(true);
  });

  it('gives a scene the monitor it declares, and every other one the default', async () => {
    const items = await loadSweepItems(started.server);
    const monitorOf = (name: string) => items.find((i) => i.name === `scene ${name}`)?.monitor;
    expect(monitorOf('expanded-tall')).toBe('1366x768@1');
    expect(monitorOf('mini')).toBe('1920x1080@1');
    for (const scene of SCENES) expect(monitorOf(scene.name)).toBe(scene.monitor ?? '1920x1080@1');
  });
});

describe('loadSweepItems', () => {
  it('reads the lists through the module loader of the server it is given, not from the file system', async () => {
    const asked: string[] = [];
    const server = {
      ssrLoadModule: async (url: string) => {
        asked.push(url);
        return url.endsWith('scenes.ts') ? { SCENES: [{ name: 'a' }, { name: 'b', monitor: '800x600@1' }] } : { GALLERY_PAGES: ['p'] };
      },
    };
    const items = await loadSweepItems(server);
    expect(asked).toEqual(['/src/preview/scenes.ts', '/src/preview/gallery/page-names.ts']);
    expect(items.map((i) => [i.name, i.monitor])).toEqual([['scene a', '1920x1080@1'], ['scene b', '800x600@1'], ['gallery p', '1920x3200@1']]);
  });

  it('fails loudly when a list cannot be read, instead of sweeping nothing', async () => {
    const server = { ssrLoadModule: async () => { throw new Error('cannot resolve ./scenes-new'); } };
    await expect(loadSweepItems(server)).rejects.toThrow('cannot resolve ./scenes-new');
  });
});
