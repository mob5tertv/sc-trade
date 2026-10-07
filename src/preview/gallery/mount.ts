import { mount, tick } from 'svelte';
import { createLogger } from '../../data/logger';
import { createUexClient } from '../../data/uex-client';
import { openTauriDb } from '../../platform/tauri-db';
import { tauriFetchJson } from '../../platform/tauri-http';
import '../../ui/theme.css';
import type { PreviewWindow } from '../window-state';
import { settled } from './acts';
import { auditGallery } from './audit';
import { loadGalleryData } from './data';
import Gallery from './Gallery.svelte';
import { PAGES, pageNames, parseGalleryName } from './registry';

// The component gallery: the real components of the interface on the real data of the preview dataset, one page
// per component. It stands in for the application in the iframe of the desktop page (`entry.ts` calls it when the
// address has `gallery=<page>[/<state>]`) and is shot with `npm run preview:shot -- --gallery <page>[/<state>]`.

export interface GalleryOptions {
  /** `<page>` or `<page>/<state>`. */
  name: string;
  /** `light` puts a bright scene under the glass. */
  bg: string | null;
  /** The opacity of the glass, 0.3 to 1; the setting of the player when absent. */
  opacity: string | null;
  win: PreviewWindow;
  /** The scale of the preview monitor: the window is sized in physical pixels. */
  scale: number;
}

const nowSec = (): number => Math.floor(Date.now() / 1000);
/** Where the window stands on the desktop, in physical pixels. */
const WINDOW_AT = 40;

export async function mountGallery(options: GalleryOptions): Promise<void> {
  const { page, state } = parseGalleryName(options.name);
  const entry = PAGES[page];
  if (entry === undefined) {
    throw new Error(`unknown gallery page "${page}"; known pages: ${pageNames().join(', ')}`);
  }
  if (options.bg !== null && options.bg !== 'dark' && options.bg !== 'light') {
    throw new Error(`bg must be dark or light, not "${options.bg}"`);
  }

  // only what went wrong is said; the data layer is chatty at debug level
  const log = createLogger({ write: (level, line) => (level === 'warn' || level === 'error' ? console[level](line) : undefined) }, 'warn');
  const db = await openTauriDb(log);
  const data = await loadGalleryData({ db, log, uex: createUexClient(tauriFetchJson, log), now: nowSec() });

  const opacity = options.opacity ?? String(data.settings.opacity);
  document.documentElement.style.setProperty('--overlay-opacity', opacity);

  const target = document.getElementById('app');
  if (target === null) throw new Error('the page has no #app');
  mount(Gallery, { target, props: { data, page: entry.component, only: state, bg: options.bg === 'light' ? 'light' : 'dark' } });
  await tick();
  await settled();
  await tick();
  await document.fonts.ready;

  (window as unknown as { __galleryAudit: typeof auditGallery }).__galleryAudit = auditGallery;
  const root = target.querySelector('.gallery');
  if (root === null) throw new Error('the gallery did not draw');
  if (state !== null && target.querySelector('[data-state]') === null) {
    throw new Error(`the page "${page}" has no state "${state}"`);
  }
  // the window is the page: as big as the states stacked on it
  const box = root.getBoundingClientRect();
  options.win.setSize({ width: Math.ceil(box.width * options.scale), height: Math.ceil(box.height * options.scale) });
  options.win.setPosition({ x: WINDOW_AT, y: WINDOW_AT });
  options.win.show();
}
