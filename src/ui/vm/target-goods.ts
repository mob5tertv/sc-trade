import { formatUec } from '../../core/format';
import type { HoldFill, HoldPick, PairGood, PickLimit } from '../../core/pair';
import type { Reference, Temp } from '../../core/types';
import type { RoiTier } from './roi-tier';
import { formatRoi, shownTier } from './route-rows';
import { badgeText } from './terminal-rows';

// Display rows of «К цели» (spec 14.19, item 16): the goods the viewed terminal sells and the target buys, and the set
// that fills the hold. Every number is already formatted; the numbers themselves are counted in core/pair.ts.

/** Shown instead of a value that does not exist. */
const NONE = '—';

/** A price with the mark that says whose it is and how old (the same mark as in the list of options). */
export interface GoodsPrice { price: string; badge: { text: string; kind: Temp | 'uex' } }

export interface TargetGoodsRow {
  key: string;
  /** 'MEDS' and 'Medical Supplies'. */
  code: string; name: string;
  buy: GoodsPrice; sell: GoodsPrice;
  roi: string; tier: RoiTier;
  /** How much of it the set takes ('288'); the dash for a commodity that did not get into the set. */
  take: string;
  /** Why this much: 'весь запас', 'остаток трюма', 'на остаток бюджета', or why none. */
  takeTitle: string;
  /** The stock at the purchase terminal is not known: the amount was counted without it (the mark «?»). */
  unsure: boolean;
  /** What this part of the set is expected to bring; the dash outside the set. */
  profit: string;
}

/** The set that fills the hold, as one line says it. */
export interface HoldSet {
  /** 'Набор на 696 SCU', or 'Набор на свободные 408 SCU' when something is aboard. */
  caption: string;
  /** How much of the room the set takes: '696 из 696 SCU'. */
  filled: string;
  invested: string; profit: string; roi: string;
  /** What keeps the set from being full, said plainly ('Запаса на станции хватает на 408 из 696 SCU'); `null` when it is full. */
  note: string | null;
}

export interface TargetGoods { rows: TargetGoodsRow[]; set: HoldSet | null }

const LIMIT_TITLE: Record<PickLimit, (scu: number) => string> = {
  space: (scu) => `Столько помещается в трюм: ${scu} SCU`,
  stock: (scu) => `Весь запас станции: ${scu} SCU`,
  budget: (scu) => `На столько хватает бюджета: ${scu} SCU`,
};

const UNKNOWN_STOCK = 'Запас станции неизвестен: количество принято по трюму и бюджету';

const priceOf = (e: PairGood['buy']): GoodsPrice => ({ price: formatUec(e.price), badge: badgeText(e) });

function takeTitle(pick: HoldPick | undefined, good: PairGood, fill: HoldFill): string {
  if (pick !== undefined) return pick.stockKnown ? LIMIT_TITLE[pick.limit](pick.scu) : `${LIMIT_TITLE[pick.limit](pick.scu)}. ${UNKNOWN_STOCK}`;
  if (good.buy.scu === 0) return 'В набор не вошёл: на станции его сейчас нет';
  return fill.short === 'budget' ? 'В набор не вошёл: не хватило бюджета' : 'В набор не вошёл: трюм заполнен товарами выгоднее';
}

/**
 * The rows and the line of the set. `goods` and `fill` come from `pairGoods` / `fillHold` of the core; `freeScu` is the room the
 * set was made for and `aboard` whether something is in the hold already (the caption then says the room is what is left).
 * The goods of the set stand first, in the order they were taken; the others after them, the best per SCU first.
 */
export function targetGoods(goods: PairGood[], fill: HoldFill, ref: Reference, room: { freeScu: number; aboard: boolean }): TargetGoods {
  const picked = new Map(fill.picks.map((p) => [p.commodityId, p]));
  const byId = new Map(goods.map((g) => [g.commodityId, g]));
  const ordered = [
    ...fill.picks.flatMap((p) => byId.get(p.commodityId) ?? []),
    ...goods.filter((g) => !picked.has(g.commodityId)),
  ];
  const rows = ordered.map((g): TargetGoodsRow => {
    const pick = picked.get(g.commodityId);
    const commodity = ref.commodities.get(g.commodityId);
    return {
      key: String(g.commodityId),
      code: commodity?.code || `#${g.commodityId}`, name: commodity?.name ?? '',
      buy: priceOf(g.buy), sell: priceOf(g.sell),
      roi: formatRoi(g.roi), tier: shownTier(g.roi),
      take: pick === undefined ? NONE : String(pick.scu),
      takeTitle: takeTitle(pick, g, fill),
      unsure: pick !== undefined && !pick.stockKnown,
      profit: pick === undefined ? NONE : formatUec(pick.profit),
    };
  });

  const free = Math.max(0, Math.floor(room.freeScu));
  if (fill.picks.length === 0) return { rows, set: null };
  const set: HoldSet = {
    caption: room.aboard ? `Набор на свободные ${free} SCU` : `Набор на ${free} SCU`,
    filled: `${fill.scu} из ${free} SCU`,
    invested: formatUec(fill.invested),
    profit: `≈ ${formatUec(fill.profit)}`,
    roi: fill.roi === null ? NONE : formatRoi(fill.roi),
    note: fill.short === null ? null
      : fill.short === 'budget' ? `Бюджета хватает на ${fill.scu} из ${free} SCU` : `Запаса на станции хватает на ${fill.scu} из ${free} SCU`,
  };
  return { rows, set };
}

/** What the list says when the pair has no goods: 'HUR-L1 не продаёт ничего, что ARC-L1 купил бы дороже'. */
export const noGoodsText = (origin: string, dest: string): string => `${origin} не продаёт ничего, что ${dest} купил бы дороже`;
