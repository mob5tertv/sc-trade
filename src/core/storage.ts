import type { Terminal } from './types';

// The storage of a place (version 1.4, party-mode.md sections 22–23): what the player bought over his hold and left at a station or an
// outpost for another trip. It cannot be sold from there, only carried on. It is a ledger of entries, each a change of the quantity and
// of the money in it; what a line holds now is their sum, and its price is the money over the quantity (the average purchase price).
// The money in the storage is no profit and no loss of any session until it is written off (`lost`). Pure: the entries come from
// `data/repo/storage.ts`.

/**
 * - `put`: what a purchase left at the place (more than the hold took);
 * - `load`: taken into the hold («Погрузил»); `late`: the same, written at a sale far away, when «Погрузил» was forgotten;
 * - `back`: put back from the hold (a lost cargo that was never aboard);
 * - `lost`: written off (gone, a wipe): a loss of the session at that moment;
 * - `fix`: a correction of the quantity or of the price, which changes no money of any session.
 */
export type StorageKind = 'put' | 'load' | 'late' | 'back' | 'lost' | 'fix';

export interface StorageEntry {
  id: number; ts: number; terminalId: number; commodityId: number;
  /** SCU in (+) or out (−). */
  scu: number;
  /** UEC of purchase in (+) or out (−): a put brings what it was bought for, what goes out takes the average price with it. */
  cost: number;
  kind: StorageKind;
  /** The run it came from or went to; `null` for none. The run may be gone from the history: the entry stays. */
  runId: number | null;
  /** The event of the run it is (a load, a put back); `null` for the others. */
  eventId: number | null;
}

export interface StorageLine {
  terminalId: number; commodityId: number; scu: number;
  /** What the goods that lie there cost when they were bought, all of them. */
  cost: number;
  /** The average purchase price per SCU. */
  price: number;
  /** Since when the line has lain: its first entry after it was last empty. */
  since: number;
}

/** What lies in the storage now: per terminal and commodity, the lines that hold something, the oldest first. */
export function storageLines(entries: readonly StorageEntry[]): StorageLine[] {
  const lines = new Map<string, StorageLine>();
  for (const e of [...entries].sort((a, b) => a.ts - b.ts || a.id - b.id)) {
    const key = `${e.terminalId}:${e.commodityId}`;
    const line = lines.get(key);
    if (line === undefined || line.scu <= 0) {
      lines.set(key, { terminalId: e.terminalId, commodityId: e.commodityId, scu: e.scu, cost: e.cost, price: 0, since: e.ts });
      continue;
    }
    line.scu += e.scu;
    line.cost += e.cost;
  }
  return [...lines.values()]
    .filter((line) => line.scu > 0)
    .map((line) => ({ ...line, cost: Math.max(0, line.cost), price: Math.max(0, line.cost) / line.scu }))
    .sort((a, b) => a.since - b.since || a.terminalId - b.terminalId || a.commodityId - b.commodityId);
}

/** The one line of a terminal and a commodity, `undefined` when nothing of it lies there. */
export function storageLine(lines: readonly StorageLine[], terminalId: number, commodityId: number): StorageLine | undefined {
  return lines.find((line) => line.terminalId === terminalId && line.commodityId === commodityId);
}

/**
 * The place a terminal stands at, as the storage of the game is kept: the station, the outpost or the city of its star system (the
 * author: «остаток остается на этой станции или аванпосте на складе»). Two terminals of one station share it; a terminal that names
 * no place is a place of its own.
 */
export function placeKey(t: Pick<Terminal, 'id' | 'starSystemId' | 'spaceStationName' | 'outpostName' | 'cityName'>): string {
  const place = t.spaceStationName || t.outpostName || t.cityName;
  return place ? `${t.starSystemId}:${place}` : `terminal:${t.id}`;
}

/** The lines that lie at the place of `terminalId` (its own and those of the other terminals of the same station). */
export function linesAt(lines: readonly StorageLine[], terminals: ReadonlyMap<number, Terminal>, terminalId: number): StorageLine[] {
  const here = terminals.get(terminalId);
  if (here === undefined) return lines.filter((line) => line.terminalId === terminalId);
  const key = placeKey(here);
  return lines.filter((line) => {
    const there = terminals.get(line.terminalId);
    return line.terminalId === terminalId || (there !== undefined && placeKey(there) === key);
  });
}

/** What was written off, as losses of the sessions: the moment and the money (a positive number). */
export function storageLosses(entries: readonly StorageEntry[]): Array<{ ts: number; cost: number }> {
  return entries.filter((e) => e.kind === 'lost').map((e) => ({ ts: e.ts, cost: -e.cost }));
}

/** The money that lies in the storage, at the purchase prices. */
export const storageValue = (lines: readonly StorageLine[]): number => lines.reduce((sum, line) => sum + line.cost, 0);
