import { formatAge, formatCompact, formatUec } from '../../core/format';
import { placeKey, storageValue, type StorageLine } from '../../core/storage';
import type { Reference } from '../../core/types';
import { terminalLabel } from './terminal-name';
import { tr, trn } from '../../i18n';

// The storage of the places (version 1.4, `core/storage.ts`) in the words of the window: the rows of the tab «Склад» of the terminal, the
// list of every storage, the part of the mini line and the button of the header. Pure.

export interface StorageRow {
  key: string;
  terminalId: number; commodityId: number;
  code: string; name: string;
  scu: number;
  /** 'LARA 488 SCU' as numbers: the quantity, the average purchase price, what it all cost. */
  scuText: string; price: string; cost: string;
  /** The average purchase price as a number (what «Исправить» starts from). */
  priceValue: number;
  /** How long it has lain: '3 д', '40 мин'. */
  age: string;
  /** The terminal it lies at, when it is another terminal of the same station than the one shown; `null` for the same. */
  otherTerminal: string | null;
}

const code = (ref: Reference, id: number): string => ref.commodities.get(id)?.code || `#${id}`;
const name = (ref: Reference, id: number): string => ref.commodities.get(id)?.name || `#${id}`;

/** The rows of the lines, as they are given (the oldest first); `shownTerminalId` is the terminal whose tab shows them. */
export function storageRows(lines: readonly StorageLine[], ref: Reference, now: number, shownTerminalId: number | null = null): StorageRow[] {
  return lines.map((line) => ({
    key: `${line.terminalId}:${line.commodityId}`,
    terminalId: line.terminalId, commodityId: line.commodityId,
    code: code(ref, line.commodityId), name: name(ref, line.commodityId),
    scu: line.scu, scuText: `${line.scu}`,
    price: formatUec(Math.round(line.price)), cost: formatUec(Math.round(line.cost)), priceValue: line.price,
    age: formatAge(Math.max(0, now - line.since)),
    otherTerminal: shownTerminalId === null || line.terminalId === shownTerminalId ? null : terminalLabel(ref, line.terminalId),
  }));
}

export interface StoragePlace { key: string; terminalId: number; place: string; rows: StorageRow[]; value: string }

/** The list of every storage: the places in the order of their oldest line, each with its rows and what lies there. */
export function storagePlaces(lines: readonly StorageLine[], ref: Reference, now: number): StoragePlace[] {
  const places = new Map<string, StorageLine[]>();
  for (const line of lines) {
    const terminal = ref.terminals.get(line.terminalId);
    const key = terminal === undefined ? `terminal:${line.terminalId}` : placeKey(terminal);
    const list = places.get(key);
    if (list) list.push(line); else places.set(key, [line]);
  }
  return [...places].map(([key, list]) => ({
    key, terminalId: list[0].terminalId, place: terminalLabel(ref, list[0].terminalId),
    rows: storageRows(list, ref, now), value: formatUec(Math.round(storageValue(list))),
  }));
}

/**
 * The part of the mini line while the ship stands at a place where something lies (the author: the program reminds by itself, without
 * windows): 'склад 488 LARA', or 'склад: 3 товара · 1 200 SCU' for several. `null`: nothing lies here.
 */
export function stripStorageText(linesHere: readonly StorageLine[], ref: Reference): string | null {
  if (linesHere.length === 0) return null;
  if (linesHere.length === 1) return tr('склад {scu} {code}', { scu: linesHere[0].scu, code: code(ref, linesHere[0].commodityId) });
  const scu = linesHere.reduce((sum, line) => sum + line.scu, 0);
  return trn(linesHere.length, 'склад: {n} товар · {scu} SCU|склад: {n} товара · {scu} SCU|склад: {n} товаров · {scu} SCU', { scu });
}

/** The button of the header (only while something lies anywhere): 'Склад 2', and its tooltip with the money that lies there. */
export function storageButton(lines: readonly StorageLine[]): { label: string; title: string } | null {
  if (lines.length === 0) return null;
  return {
    label: tr('Склад {n}', { n: lines.length }),
    title: trn(lines.length, 'Твой склад на станциях: {n} товар, по цене закупки {value} UEC|Твой склад на станциях: {n} товара, по цене закупки {value} UEC|Твой склад на станциях: {n} товаров, по цене закупки {value} UEC', { value: formatCompact(storageValue(lines)) }),
  };
}

/**
 * The line a sale of goods that are not in the hold most likely comes from (version 1.4, the author chose «Погрузил» plus a guess at the
 * sale): the commodity lying at the storage of ANOTHER place (it cannot be sold where it lies), the largest line when there are several.
 * `undefined`: it lies nowhere else, and the sale is an income as before.
 */
export function storageElsewhere(
  lines: readonly StorageLine[], terminals: Reference['terminals'], terminalId: number, commodityId: number,
): StorageLine | undefined {
  const here = terminals.get(terminalId);
  const hereKey = here === undefined ? `terminal:${terminalId}` : placeKey(here);
  return lines
    .filter((line) => {
      if (line.commodityId !== commodityId || line.terminalId === terminalId) return false;
      const there = terminals.get(line.terminalId);
      return (there === undefined ? `terminal:${line.terminalId}` : placeKey(there)) !== hereKey;
    })
    .sort((a, b) => b.scu - a.scu)[0];
}

/**
 * What the notice of a closed run adds when goods of that run still lie at a storage (the second trip, the author: «оставить сразу на
 * вторую ходку»): ' · на складе HUR-L1 ещё 488 LARA' for the largest such line. `null`: nothing of it lies anywhere.
 */
export function storageLeftText(commodityIds: readonly number[], lines: readonly StorageLine[], ref: Reference): string | null {
  const left = lines.filter((line) => commodityIds.includes(line.commodityId)).sort((a, b) => b.scu - a.scu)[0];
  if (left === undefined) return null;
  return tr(' · на складе {place} ещё {scu} {code}', { place: terminalLabel(ref, left.terminalId), scu: left.scu, code: code(ref, left.commodityId) });
}
