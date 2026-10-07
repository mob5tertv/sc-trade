import type { Component } from 'svelte';
import BadgePage from './pages/BadgePage.svelte';
import DialogPage from './pages/DialogPage.svelte';
import QuickEntryPage from './pages/QuickEntryPage.svelte';
import RouteListPage from './pages/RouteListPage.svelte';
import RunPage from './pages/RunPage.svelte';
import SearchBoxPage from './pages/SearchBoxPage.svelte';
import SectionPage from './pages/SectionPage.svelte';
import StatsPage from './pages/StatsPage.svelte';
import StripPage from './pages/StripPage.svelte';
import TerminalTablePage from './pages/TerminalTablePage.svelte';

// The pages of the gallery: one per component (or a few that go together), each with all its states stacked.
// A page is opened with `gallery=<page>` (every state) or `gallery=<page>/<state>` (one state).

export const PAGES: Record<string, { title: string; component: Component }> = {
  'terminal-table': { title: 'Таблица терминала: стороны, выдвинутая строка, ошибка, пустая', component: TerminalTablePage as Component },
  'route-list': { title: 'Варианты: from/to, оба конца, цель, пять ступеней ROI, подробности', component: RouteListPage as Component },
  section: { title: 'Секция: открыта, закрыта, действия, длинная сводка, прокрутка', component: SectionPage as Component },
  'quick-entry': { title: 'Быстрый ввод: пустой, список поиска, заполнен, ошибка', component: QuickEntryPage as Component },
  'search-box': { title: 'Поиск со значением', component: SearchBoxPage as Component },
  strip: { title: 'Мини-строка: без рейса, в рейсе, сообщение, длинный груз', component: StripPage as Component },
  dialog: { title: 'Диалог сделки', component: DialogPage as Component },
  run: { title: 'Карточка рейса и «продать или лететь дальше»', component: RunPage as Component },
  stats: { title: 'История, сессии, таблица маршрутов', component: StatsPage as Component },
  badge: { title: 'Метки и плашки свежести', component: BadgePage as Component },
};

export const pageNames = (): string[] => Object.keys(PAGES);

/** `terminal-table/buy-expanded` is the page and the state. */
export function parseGalleryName(name: string): { page: string; state: string | null } {
  const [page, state] = name.split('/');
  return { page, state: state === undefined || state === '' ? null : state };
}
