import { formatAge } from '../../core/format';
import type { Searchable } from '../../core/search';
import type { Settings } from '../../core/settings';
import type { Reference, Terminal } from '../../core/types';

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

/** Terminals of one star system (all when null); found by display name, nickname, name or planet. */
export function terminalSearchItems(ref: Reference, starSystemId: number | null): Searchable[] {
  const items: Searchable[] = [];
  for (const t of ref.terminals.values()) {
    if (starSystemId !== null && t.starSystemId !== starSystemId) continue;
    items.push({
      id: t.id,
      code: t.code,
      name: terminalLabel(t),
      aliases: [t.nickname, t.name, t.planetName ?? ''].filter(a => a !== ''),
    });
  }
  return items;
}

export function commoditySearchItems(ref: Reference): Searchable[] {
  return [...ref.commodities.values()].map(c => ({ id: c.id, code: c.code, name: c.name }));
}
