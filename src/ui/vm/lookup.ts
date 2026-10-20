import { formatUec } from '../../core/format';
import type { RouteOption } from '../../core/routes';
import type { Settings } from '../../core/settings';
import type { Reference, Side } from '../../core/types';
import { terminalLabel } from './terminal-name';
import type { TerminalRow } from './terminal-rows';
import { tr } from '../../i18n';

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
  /**
   * A line of the storage of the terminal to carry on (version 1.4): the trips are counted from what lies there and what it cost
   * (`routesForLot`), not from the market of the terminal. Only with `kind: 'from'` and a commodity.
   */
  lot?: { scu: number; price: number; from?: 'storage' | 'hold' };
}

/** Whether two requests ask the same thing (the one on screen asked again keeps its answer until the new one comes). */
export function sameRequest(a: LookupRequest | null, b: LookupRequest): boolean {
  return a !== null && a.kind === b.kind && a.terminalId === b.terminalId && a.commodityId === b.commodityId && a.price === b.price
    && a.lot?.scu === b.lot?.scu && a.lot?.price === b.lot?.price && a.lot?.from === b.lot?.from;
}

/** A buy price asks where to sell it on (trips from the terminal); a sell price asks where to buy (trips to the terminal). */
export function kindForSide(side: Side): LookupKind {
  return side === 'buy' ? 'from' : 'to';
}

const commodityLabel = (ref: Reference, id: number): string => ref.commodities.get(id)?.name || `#${id}`;
const commodityCode = (ref: Reference, id: number | null): string => (id === null ? '' : ref.commodities.get(id)?.code || `#${id}`);

/**
 * 'Где купить Medical Supplies для HUR-L1 · продажа 5 088', 'Куда везти Gold с ARC-L1'. The title names the terminal that was
 * asked about and nothing else. With «выгоднее» on, some trips are bought at another terminal nearby; the title used to end with
 * 'и рядом' for that, and the author took it out (14.10.2026): the list itself sets those trips apart, under its line
 * «Выгоднее: слетать пустым и купить там» (until 1.4 «Выгоднее: закупка рядом», which the author could not read), and each of them names both of its ends.
 */
export function lookupTitle(request: LookupRequest, ref: Reference): string {
  const terminal = terminalLabel(ref, request.terminalId);
  const commodity = request.commodityId === null ? null : commodityLabel(ref, request.commodityId);
  if (request.lot?.from === 'hold') {
    // version 1.4.1: the cargo of the run, from where the ship is (the author: «Куда везти» in the section «Рейс»)
    return tr('Из трюма: {code} {scu} SCU по {price} · от {terminal}', { code: commodityCode(ref, request.commodityId), scu: request.lot.scu, price: formatUec(Math.round(request.lot.price)), terminal });
  }
  if (request.lot !== undefined) return tr('Со склада {terminal}: {commodity} {scu} SCU', { commodity: commodity ?? '', terminal, scu: request.lot.scu });
  const what = request.kind === 'to'
    ? tr('Где купить{v1} для {terminal}', { v1: commodity === null ? '' : ` ${commodity}`, terminal })
    : tr('Куда везти{v1} с {terminal}', { v1: commodity === null ? '' : ` ${commodity}`, terminal });
  if (request.price === null) return what;
  return `${what} · ${request.kind === 'to' ? tr('продажа') : tr('покупка')} ${formatUec(request.price)}`;
}

/** What the list says when the lookup found nothing. */
export function lookupEmptyText(request: LookupRequest, ref: Reference): string {
  return request.commodityId === null
    ? tr('Выгодных маршрутов не нашлось.')
    : tr('Выгодных вариантов для {v1} не нашлось.', { v1: commodityLabel(ref, request.commodityId) });
}

/** The terminal a "Цель" button picks: the other end of the trip (the destination from here, the origin to here). */
export function lookupTarget(option: Pick<RouteOption, 'originId' | 'destId'>, kind: LookupKind): number {
  return kind === 'from' ? option.destId : option.originId;
}

/** A target as the "Цель" button of an option sets it: the terminal to fly to now, and the one after a purchase there (`null`: none). */
export interface TargetSteps { targetId: number; thenId: number | null }

/**
 * What "Цель" of an option makes the target (spec 14.19, item 7). A trip from `homeId` that is bought at ANOTHER terminal is a
 * route of two steps: first that terminal, to buy, and after the purchase the terminal of the sale. Any other trip is one step
 * (`lookupTarget`).
 */
export function lookupSteps(option: Pick<RouteOption, 'originId' | 'destId'>, kind: LookupKind, homeId: number | null): TargetSteps {
  if (kind === 'from' && homeId !== null && option.originId !== homeId) return { targetId: option.originId, thenId: option.destId };
  return { targetId: lookupTarget(option, kind), thenId: null };
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
  nearby: 'from', nearbyMaxMin: 'from', worsePricePct: 'never', detailedCalc: 'never', optionsToTarget: 'never', favouriteRoutes: 'never', favouriteSound: 'never', favouriteVolume: 'never', guideMySystem: 'never', guideOnlyStock: 'never', routesSince: 'always',
  language: 'never', tutorialShown: 'never', hotkeyPanel: 'never', hotkeyDepart: 'never', hotkeyArrive: 'never', hotkeyGuide: 'never',
  panelWidth: 'never', stripCorner: 'never', opacity: 'never', showStrip: 'never', stripRangeTurns: 'never', logLevel: 'never',
  idleCollapseSec: 'never', openSections: 'never', windowDx: 'never', windowDy: 'never', windowLocked: 'never',
  uiScale: 'never',
  roiHighlightPct: 'never',
  currentTerminalId: 'never', targetTerminalId: 'never', targetThenId: 'never', keysHintShown: 'never', scaleNoticeShown: 'never',
};

export function affectsLookup(key: keyof Settings, kind: LookupKind): boolean {
  const affects = AFFECTS_LOOKUP[key];
  return affects === 'always' || (affects === 'from' && kind === 'from');
}
