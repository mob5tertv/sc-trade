/**
 * The names of the pages of the gallery. They are plain data in a file of their own, without the Svelte components of
 * `registry.ts`: the sweep (`npm run preview:sweep`) loads this file through the dev server's module loader to know which
 * pages to visit, without loading the pages themselves. `registry.ts` is checked against this list by the type checker
 * (a page that is in one and not in the other does not compile), and `tests/preview/sweep-lists.test.ts` compares the list
 * the sweep gets with the pages the registry really has, so the list cannot go stale.
 */
export const GALLERY_PAGES = [
  'terminal-table', 'route-list', 'section', 'quick-entry', 'search-box', 'strip', 'dialog', 'run', 'stats', 'badge',
] as const;

export type GalleryPage = (typeof GALLERY_PAGES)[number];
