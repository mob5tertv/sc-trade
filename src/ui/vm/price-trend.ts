import { formatAge, formatUec } from '../../core/format';
import type { Estimate, Side } from '../../core/types';
import { tr } from '../../i18n';

/** How my own price moved since my previous reading of it at the same place: the triangle next to the price. */
export interface PriceTrend {
  /** Where the price went. */
  dir: 'up' | 'down';
  /** Whether that is good for the player: a rise where he sells, a fall where he buys. */
  good: boolean;
  /** The hint: 'было 2 300 · 2 ч назад (+50)'. */
  title: string;
}

/** 'было 2 300 · 2 ч назад (+50)': the previous price, how long ago it was seen and the signed difference. */
function trendTitle(price: number, prev: { price: number; ageSec: number }): string {
  const diff = price - prev.price;
  // a reading younger than a minute has no age to count (it cannot happen with the real gap rule, 120 s)
  const ago = prev.ageSec < 60 ? tr('только что') : tr('{v1} назад', { v1: formatAge(prev.ageSec) });
  return tr('было {v1} · {ago} ({v2}{v3})', { v1: formatUec(prev.price), ago, v2: diff > 0 ? '+' : '', v3: formatUec(diff) });
}

/**
 * The trend of a price of mine; `side` is the side of the price: `buy` where the player buys, `sell` where he sells.
 * Only my own price has one, and only when the reading before it was a different price: a UEX price, a first
 * reading and a price that stayed have none (the estimate already leaves out the readings that are not a move).
 */
export function priceTrend(e: Estimate, side: Side): PriceTrend | null {
  if (e.source !== 'own' || e.prev === null || e.prev.price === e.price) return null;
  const up = e.price > e.prev.price;
  return { dir: up ? 'up' : 'down', good: up === (side === 'sell'), title: trendTitle(e.price, e.prev) };
}
