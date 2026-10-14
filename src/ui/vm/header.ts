import { formatAge } from '../../core/format';
import { search } from '../../core/search';
import type { Searchable } from '../../core/search';
import type { Settings } from '../../core/settings';
import type { Reference } from '../../core/types';
import { terminalFullName, terminalName } from './terminal-name';
import { terminalFullPlace, terminalPlace, terminalSystem } from './terminal-place';
import { tr } from '../../i18n';

export interface HeaderModel { location: string; ship: string; system: string; uex: string; uexStale: boolean }

const NO_LOCATION = (): string => tr('Локация не выбрана');
const NO_SHIP = (): string => tr('Корабль не выбран');
const ALL_SYSTEMS = (): string => tr('Все системы');

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

// '06.10 14:05' in the machine's local time zone
function formatStamp(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function shipLine(ref: Reference, s: Settings): string {
  const name = s.vehicleId === null ? null : ref.vehicles.find(v => v.id === s.vehicleId)?.name ?? null;
  if (name === null) return s.scuCapacity > 0 ? `${s.scuCapacity} SCU` : NO_SHIP();
  return s.scuCapacity > 0 ? `${name} · ${s.scuCapacity} SCU` : name;
}

function uexLine(pricesSyncedAt: number | null, uexOk: boolean, now: number): string {
  if (!uexOk) return pricesSyncedAt === null ? tr('UEX недоступен') : tr('UEX недоступен, данные от {v1}', { v1: formatStamp(pricesSyncedAt) });
  if (pricesSyncedAt === null) return tr('UEX ещё не загружен');
  const age = Math.max(0, now - pricesSyncedAt);
  return age < 60 ? tr('UEX сейчас') : tr('UEX {v1} назад', { v1: formatAge(age) });
}

export function headerModel(ref: Reference, s: Settings, pricesSyncedAt: number | null, uexOk: boolean, now: number): HeaderModel {
  const terminal = s.currentTerminalId === null ? undefined : ref.terminals.get(s.currentTerminalId);
  const system = s.starSystemId === null ? undefined : ref.starSystems.find(x => x.id === s.starSystemId);
  return {
    location: terminal ? terminalName(terminal) : NO_LOCATION(),
    ship: shipLine(ref, s),
    system: system ? system.name : ALL_SYSTEMS(),
    uex: uexLine(pricesSyncedAt, uexOk, now),
    uexStale: !uexOk,
  };
}

/**
 * An item of the list of a search box. `Searchable` (src/core/search.ts) is what the search needs; the box also draws, when
 * they are set, `place` (muted, after the name: where a terminal is) and `title` (the tooltip of the row: the whole name and
 * the whole place). A commodity has neither. `system` is the name of the star system a terminal stands in: a way to find it,
 * but a weaker one than its own names, so it is not among the `aliases` and `searchTerminals` looks at it second.
 */
export interface SearchItem extends Searchable { place?: string; title?: string; system?: string }

/** Terminals of one star system (all when null); found by display name, nickname, name or planet (and by star system, see `searchTerminals`), and told apart by where they are. */
export function terminalSearchItems(ref: Reference, starSystemId: number | null): SearchItem[] {
  const items: SearchItem[] = [];
  for (const t of ref.terminals.values()) {
    if (starSystemId !== null && t.starSystemId !== starSystemId) continue;
    const name = terminalName(t);
    const full = terminalFullName(t);
    const place = terminalPlace(t, ref.starSystems);
    const whole = terminalFullPlace(t, ref.starSystems);
    const system = terminalSystem(t, ref.starSystems);
    items.push({
      id: t.id,
      code: t.code,
      name,
      // the other spellings stay searchable: a player may type the display name as the game writes it ('Area 18 TDD')
      aliases: [...new Set([t.nickname, t.displayname, t.name, t.planetName ?? ''].filter(a => a !== ''))],
      ...(system === '' ? {} : { system }),
      ...(place === '' ? {} : { place }),
      title: whole === '' ? full : `${full}\n${whole}`,
    });
  }
  return items;
}

/**
 * The search of the list of terminals: the type-ahead search of the core (`search`, which stays as it is) over the names of
 * the terminals first, then over the same items with the name of their star system added, so that typing "stanton" shows the
 * terminals NAMED "Stanton Gateway" before the first few of the many terminals that merely stand in Stanton. The result is
 * the matches by name, then the matches by the system alone, each group ranked by the core search, cut to `limit`; no
 * terminal is there twice. Items without a `system` (a list of commodities) give exactly what `search` gives.
 */
export function searchTerminals(items: SearchItem[], query: string, boostIds: Set<number> | undefined, limit: number): SearchItem[] {
  const byName = search(items, query, boostIds, limit);
  if (byName.length >= limit) return byName;
  const withSystem = items.filter(item => item.system !== undefined);
  const known = new Set(byName.map(item => item.id));
  const bySystem = search(
    withSystem.map(item => ({ ...item, aliases: [...(item.aliases ?? []), item.system ?? ''] })),
    query, boostIds, withSystem.length,
  ).filter(item => !known.has(item.id));
  // the copies carry the system as an alias for the search only: what comes back are the items themselves
  const original = new Map(items.map(item => [item.id, item]));
  return [...byName, ...bySystem.map(item => original.get(item.id) ?? item)].slice(0, limit);
}

export function commoditySearchItems(ref: Reference): Searchable[] {
  return [...ref.commodities.values()].map(c => ({ id: c.id, code: c.code, name: c.name }));
}

/**
 * The width of the window from which the header has room for all of its parts at their full size. Since 1.2 it has two more
 * buttons («Маршрут» and the reference), and with «Я здесь» it needs 473 px, while the window is 440 px wide by default and may be
 * 380. Below this width the parts stand closer (`headerCompact`), so that at the default width nothing leaves the window: the
 * last icon of the header is the button that collapses it.
 */
export const HEADER_FULL_WIDTH = 480;

/** Whether the header of a window `panelWidth` wide draws its parts closer together. */
export const headerCompact = (panelWidth: number): boolean => panelWidth < HEADER_FULL_WIDTH;
