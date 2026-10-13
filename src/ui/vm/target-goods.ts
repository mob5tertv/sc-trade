import type { Temp } from '../../core/types';
import type { RoiTier } from './roi-tier';

// Display rows of «К цели» (spec 14.19, item 16): the goods the viewed terminal sells and the target buys, and the set
// that fills the hold. Every number is already formatted. The numbers themselves are counted elsewhere.

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
  /** What keeps the set from being full, said plainly ('Запаса на станции не хватает: 408 из 696 SCU'); `null` when it is full. */
  note: string | null;
}
