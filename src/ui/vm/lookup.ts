import { formatUec } from '../../core/format';
import type { RouteOption } from '../../core/routes';
import type { Settings } from '../../core/settings';
import type { Reference, Side } from '../../core/types';
import type { TerminalRow } from './terminal-rows';

// The lookup of the Terminal tab (spec 14.2): where to buy a commodity the terminal wants, or where to sell
// the one it sells. These are the pure parts: what the lookup is called and what its answers point at.

/** `from`: trips that start at the terminal ("Где продать"); `to`: trips that end there ("Где купить"). */
export type LookupKind = 'from' | 'to';

export interface LookupRequest {
  kind: LookupKind;
  /** The viewed terminal the lookup is about. */
  terminalId: number;
  /** One commodity, or `null` for everything the terminal trades. */
  commodityId: number | null;
  /** The price the player entered that started the lookup; shown in the title. `null` when none did. */
  price: number | null;
}

/** A buy price asks where to sell it on (trips from the terminal); a sell price asks where to buy (trips to the terminal). */
export function kindForSide(side: Side): LookupKind {
  return side === 'buy' ? 'from' : 'to';
}

/** A terminal is known by its nickname; the reference may lack it (a game patch), then it is shown by id. */
export function terminalLabel(ref: Reference, id: number): string {
  const t = ref.terminals.get(id);
  return (t && (t.nickname || t.displayname || t.name)) || `#${id}`;
}

const commodityLabel = (ref: Reference, id: number): string => ref.commodities.get(id)?.name || `#${id}`;

/**
 * With `settings.nearby` on, trips from a terminal may start at any other terminal of its planet (never planet 0,
 * and never for a terminal that left the reference): the list is then not about this terminal alone. `to` ignores it.
 */
function searchesNearby(request: LookupRequest, ref: Reference, nearby: boolean): boolean {
  if (!nearby || request.kind !== 'from') return false;
  return (ref.terminals.get(request.terminalId)?.planetId ?? 0) !== 0;
}

/**
 * 'Где купить Medical Supplies для HUR-L1 · продажа 5 088', 'Куда везти Gold с ARC-L1'. `nearby` is the setting:
 * when it applies, trips from a terminal read 'Куда везти Gold с ARC-L1 и рядом', so the player does not take the
 * list for trips that all start at that one terminal.
 */
export function lookupTitle(request: LookupRequest, ref: Reference, nearby: boolean): string {
  const terminal = terminalLabel(ref, request.terminalId);
  const commodity = request.commodityId === null ? null : commodityLabel(ref, request.commodityId);
  const what = request.kind === 'to'
    ? `Где купить${commodity === null ? '' : ` ${commodity}`} для ${terminal}`
    : `Куда везти${commodity === null ? '' : ` ${commodity}`} с ${terminal}${searchesNearby(request, ref, nearby) ? ' и рядом' : ''}`;
  if (request.price === null) return what;
  return `${what} · ${request.kind === 'to' ? 'продажа' : 'покупка'} ${formatUec(request.price)}`;
}

/** What the list says when the lookup found nothing. */
export function lookupEmptyText(request: LookupRequest, ref: Reference): string {
  return request.commodityId === null
    ? 'Выгодных маршрутов не нашлось.'
    : `Выгодных вариантов для ${commodityLabel(ref, request.commodityId)} не нашлось.`;
}

/** The terminal a "Цель" button picks: the other end of the trip (the destination from here, the origin to here). */
export function lookupTarget(option: Pick<RouteOption, 'originId' | 'destId'>, kind: LookupKind): number {
  return kind === 'from' ? option.destId : option.originId;
}

/**
 * The price a lookup started from a table row is about: my own price in that cell, else the UEX hint, `null`
 * when the row has no price on that side.
 */
export function lookupPrice(row: Pick<TerminalRow, 'buy' | 'sell'> | undefined, side: Side): number | null {
  const cell = row === undefined ? null : row[side];
  return cell === null ? null : cell.own ?? cell.hint;
}

/**
 * Whether a setting changes what the lookup on screen would answer. Every setting the suggestions read does: the
 * free space (`scuCapacity`), the filters, the ranking, the time and temperature numbers. `nearby` only shapes
 * trips FROM a terminal (`kind` is the kind of the lookup on screen). A new setting must be decided here: the
 * table is keyed with every setting.
 */
const AFFECTS_LOOKUP: Record<keyof Settings, 'always' | 'from' | 'never'> = {
  vehicleId: 'never', scuCapacity: 'always', starSystemId: 'always', budget: 'always',
  hotMin: 'always', warmMin: 'always', coolingMin: 'always', refillFullMin: 'always', serverChangedAt: 'always',
  quantumSpeedKkms: 'always', overheadMin: 'always', overheadEmptyMin: 'always', topN: 'always', sort: 'always',
  nearby: 'from',
  hotkeyPanel: 'never', hotkeyDepart: 'never', hotkeyArrive: 'never',
  panelWidth: 'never', stripCorner: 'never', opacity: 'never', showStrip: 'never', logLevel: 'never',
  currentTerminalId: 'never', targetTerminalId: 'never',
};

export function affectsLookup(key: keyof Settings, kind: LookupKind): boolean {
  const affects = AFFECTS_LOOKUP[key];
  return affects === 'always' || (affects === 'from' && kind === 'from');
}
