// What `npm run preview:sweep` visits, read the way the application itself reads its code.
//
// The lists are loaded through the module loader of the dev server (`ssrLoadModule`), never by importing the files in
// plain Node: the scene modules (`./scenes-run`, `./scenes-stats`, ... registered in src/preview/scenes.ts) import each
// other without a file extension, which Vite resolves and Node does not, and every scene module added later would break
// a bare import the same way. Tested on a real dev server in tests/preview/sweep-lists.test.ts.
import { sweepItems } from './uncaught.mjs';

/** @typedef {{ ssrLoadModule: (url: string) => Promise<Record<string, any>> }} ModuleLoader a Vite dev server, or anything that loads a module by its address */

/**
 * Every scene and every page of the gallery, as `sweepItems` lists them. A list that cannot be read is an error: a
 * sweep of nothing is not a pass.
 * @param {ModuleLoader} server
 * @returns {Promise<import('./uncaught.mjs').SweepItem[]>}
 */
export async function loadSweepItems(server) {
  const { SCENES } = await server.ssrLoadModule('/src/preview/scenes.ts');
  const { GALLERY_PAGES } = await server.ssrLoadModule('/src/preview/gallery/page-names.ts');
  return sweepItems({
    scenes: SCENES.map((/** @type {{ name: string, monitor?: string }} */ scene) => ({ name: scene.name, monitor: scene.monitor })),
    pages: [...GALLERY_PAGES],
  });
}
