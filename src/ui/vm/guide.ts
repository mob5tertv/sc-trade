import { loadingBar } from '../../core/cargo-fit';
import { formatUec } from '../../core/format';
import type { Place } from '../../core/places';
import type { Reference, Side, Temp, Vehicle } from '../../core/types';
import { terminalLabel } from './terminal-name';
import { terminalFullPlace } from './terminal-place';
import { badgeText } from './terminal-rows';

// Display rows of the commodity reference (spec 14.19, item 9): the best places to buy or to sell one commodity. Every
// number is already formatted; the places themselves are chosen in core/places.ts.

/** What the reference is opened on: the commodity (none yet: the player picks one) and the side. */
export interface GuideState { commodityId: number | null; side: Side }

/** The cargo the reference is asked for (spec 14.19, item 8): how much of the commodity is aboard and what this place pays for it. */
export interface GuideCargo { scu: number; herePrice: number }

export interface GuideRow {
  terminalId: number;
  /** The name of the terminal, and where it is ('Stanton · Hurston'); the place is empty when the reference does not say. */
  terminal: string; place: string;
  price: string;
  /** Whose price it is and how old: 'моя · 4 мин', 'UEX · 2 ч'. The source of the price and its freshness in one mark. */
  badge: { text: string; kind: Temp | 'uex' };
  /** To buy: the stock there ('≈385' when it is an estimate by the refill timer); to sell: what the buyer already holds. The dash when unknown. */
  scu: string;
  /** What flying there would add to selling the cargo here ('+12 400'), when the reference is asked for a cargo; `null` otherwise. */
  extra: string | null;
  extraLoss: boolean;
  /** The terminal is the target of the run, or the place the player stands at. */
  isTarget: boolean; isHere: boolean;
  /** Why the ship of the settings cannot be loaded there ('нет грузового дока'); `null` when nothing says so. Said of places to BUY at only. */
  loadBar: string | null;
}

const NONE = '—';
const signed = (n: number): string => (Math.round(n) > 0 ? `+${formatUec(n)}` : formatUec(n));

export function guideRows(
  places: Place[], ref: Reference,
  marks: { targetId: number | null; hereId: number | null; cargo?: GuideCargo | null; side?: Side; vehicle?: Vehicle },
): GuideRow[] {
  const cargo = marks.cargo ?? null;
  return places.map(({ terminalId, estimate: e }): GuideRow => {
    const terminal = ref.terminals.get(terminalId);
    const extra = cargo === null ? null : cargo.scu * (e.price - cargo.herePrice);
    return {
      terminalId,
      terminal: terminalLabel(ref, terminalId),
      place: terminal === undefined ? '' : terminalFullPlace(terminal, ref.starSystems),
      price: formatUec(e.price),
      badge: badgeText(e),
      scu: e.scu === null ? NONE : `${e.stock === null ? '' : '≈'}${Math.round(e.scu)}`,
      extra: extra === null ? null : signed(extra),
      extraLoss: extra !== null && Math.round(extra) <= 0,
      isTarget: terminalId === marks.targetId,
      isHere: terminalId === marks.hereId,
      loadBar: marks.side === 'buy' ? loadingBar(terminal, marks.vehicle) : null,
    };
  });
}

/** The heads of the quantity column: a stock when buying, the buyer's own inventory when selling. */
export const GUIDE_SCU_HEAD: Record<Side, { label: string; title: string }> = {
  buy: { label: 'Запас', title: 'Сколько товара на станции, SCU. «≈» — оценка по таймеру пополнения от твоего замера' },
  sell: { label: 'Склад', title: 'Столько уже лежит на складе у покупателя, а не сколько он готов купить' },
};

/** What the list says when it is empty. */
export function guideEmptyText(side: Side, filtered: boolean): string {
  const where = side === 'buy' ? 'Купить этот товар негде' : 'Продать этот товар некуда';
  return filtered ? `${where}: сними фильтры — возможно, место есть в другой системе или без запаса` : `${where}: цен на него нет ни у тебя, ни в UEX`;
}
