/**
 * The names of the pages of the gallery, as plain text so that Node can read them without compiling Svelte: the sweep
 * (`npm run preview:sweep`) takes its list of pages from here. `registry.ts` is checked against this list by the type
 * checker (a page missing from either side is an error), so the list cannot go stale.
 */
export const GALLERY_PAGES = [
  'terminal-table', 'route-list', 'section', 'quick-entry', 'search-box', 'strip', 'dialog', 'run', 'stats', 'badge',
] as const;

export type GalleryPage = (typeof GALLERY_PAGES)[number];
