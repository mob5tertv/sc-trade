import { formatUec } from '../../core/format';
import type { RouteOption } from '../../core/routes';
import type { Reference, Side } from '../../core/types';

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

/** 'Где купить Medical Supplies для HUR-L1 · продажа 5 088', 'Куда везти Gold с ARC-L1'. */
export function lookupTitle(request: LookupRequest, ref: Reference): string {
  const terminal = terminalLabel(ref, request.terminalId);
  const commodity = request.commodityId === null ? null : commodityLabel(ref, request.commodityId);
  const what = request.kind === 'to'
    ? `Где купить${commodity === null ? '' : ` ${commodity}`} для ${terminal}`
    : `Куда везти${commodity === null ? '' : ` ${commodity}`} с ${terminal}`;
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
