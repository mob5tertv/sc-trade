import { formatAge } from '../../core/format';
import { search } from '../../core/search';
import type { Searchable } from '../../core/search';
import type { Settings } from '../../core/settings';
import type { Reference, Terminal } from '../../core/types';
import { terminalFullPlace, terminalPlace, terminalSystem } from './terminal-place';

export interface HeaderModel { location: string; ship: string; system: string; uex: string; uexStale: boolean }

const NO_LOCATION = 'Локация не выбрана';
const NO_SHIP = 'Корабль не выбран';
const ALL_SYSTEMS = 'Все системы';

// UEX leaves displayname empty on some terminals; the nickname is what players know them by
const terminalLabel = (t: Terminal): string => t.displayname || t.nickname || t.name;

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
  if (name === null) return s.scuCapacity > 0 ? `${s.scuCapacity} SCU` : NO_SHIP;
  return s.scuCapacity > 0 ? `${name} · ${s.scuCapacity} SCU` : name;
}

function uexLine(pricesSyncedAt: number | null, uexOk: boolean, now: number): string {
  if (!uexOk) return pricesSyncedAt === null ? 'UEX недоступен' : `UEX недоступен, данные от ${formatStamp(pricesSyncedAt)}`;
  if (pricesSyncedAt === null) return 'UEX ещё не загружен';
  const age = Math.max(0, now - pricesSyncedAt);
  return age < 60 ? 'UEX сейчас' : `UEX ${formatAge(age)} назад`;
}

export function headerModel(ref: Reference, s: Settings, pricesSyncedAt: number | null, uexOk: boolean, now: number): HeaderModel {
  const terminal = s.currentTerminalId === null ? undefined : ref.terminals.get(s.currentTerminalId);
  const system = s.starSystemId === null ? undefined : ref.starSystems.find(x => x.id === s.starSystemId);
  return {
    location: terminal ? terminalLabel(terminal) : NO_LOCATION,
    ship: shipLine(ref, s),
    system: system ? system.name : ALL_SYSTEMS,
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
    const name = terminalLabel(t);
    const place = terminalPlace(t, ref.starSystems);
    const whole = terminalFullPlace(t, ref.starSystems);
    const system = terminalSystem(t, ref.starSystems);
    items.push({
      id: t.id,
      code: t.code,
      name,
      aliases: [t.nickname, t.name, t.planetName ?? ''].filter(a => a !== ''),
      ...(system === '' ? {} : { system }),
      ...(place === '' ? {} : { place }),
      title: whole === '' ? name : `${name}\n${whole}`,
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
