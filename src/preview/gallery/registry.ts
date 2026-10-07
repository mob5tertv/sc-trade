import type { Component } from 'svelte';
import TerminalTablePage from './pages/TerminalTablePage.svelte';

// The pages of the gallery: one per component, each with all the states of the component stacked. A page is
// opened with `gallery=<page>` (every state) or `gallery=<page>/<state>` (one state).

export const PAGES: Record<string, { title: string; component: Component }> = {
  'terminal-table': { title: 'Таблица терминала', component: TerminalTablePage as Component },
};

export const pageNames = (): string[] => Object.keys(PAGES);

/** `terminal-table/buy-expanded` is the page and the state. */
export function parseGalleryName(name: string): { page: string; state: string | null } {
  const [page, state] = name.split('/');
  return { page, state: state === undefined || state === '' ? null : state };
}
