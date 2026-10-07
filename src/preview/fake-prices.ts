import type { UexPrice, UexSideStats } from '../core/types';
import { installHttpFake, type FakeAnswer } from './http-fake';

// The price requests of UEX for the scenes that show a price refresh: every request is answered with the rows the
// application already has for its terminals (so the table does not change under the picture), but the scene decides how
// far the refresh gets: a gate holds the request after the first few, and chosen terminals fail the way a stalled network does.
// Anything that is not a price request fails at once, as it does in the preview without a network.

const PRICES_PATH = '/commodities_prices?id_terminal=';

export interface PriceFakeOptions {
  /** The prices UEX "has": a request is answered with the rows of its terminals. */
  rows: () => Iterable<UexPrice>;
  /** How many price requests go through at once; the next one waits at the gate until `release`. No gate when absent. */
  passes?: number;
  /** A price request that includes one of these terminals fails. */
  failTerminals?: ReadonlySet<number>;
}

export interface PriceFake {
  /** Price requests that have come in so far: answered, failed or waiting at the gate. */
  asked(): number;
  /** Lets `count` more requests through the gate. */
  release(count: number): void;
  /** Takes the gate away: from now on every price request is answered at once. */
  openAll(): void;
}

/** The fields of one side of a price the way the API names them (the reverse of `mapSide` of the client). */
function sideRow(side: 'buy' | 'sell', s: UexSideStats): Record<string, number> {
  const p = `price_${side}`;
  return {
    [p]: s.last,
    [`${p}_min_week`]: s.minWeek, [`${p}_max_week`]: s.maxWeek, [`${p}_avg_week`]: s.avgWeek,
    [`${p}_min_month`]: s.minMonth, [`${p}_max_month`]: s.maxMonth, [`${p}_avg_month`]: s.avgMonth,
    [`${p}_min`]: s.min, [`${p}_max`]: s.max, [`${p}_avg`]: s.avg,
  };
}

/** A price as a row of `commodities_prices` (the reverse of `mapPrice` of the client). */
export function priceRow(p: UexPrice): Record<string, number> {
  return {
    id_terminal: p.terminalId,
    id_commodity: p.commodityId,
    ...sideRow('buy', p.buy),
    ...sideRow('sell', p.sell),
    scu_buy: p.scuBuy,
    scu_sell: p.scuSell,
    scu_buy_max_week: p.scuBuyMax,
    scu_sell_max_week: p.scuSellMax,
    date_modified: p.dateModified,
  };
}

/** The ids of the terminals a price request asks about, or `null` when the URL is not a price request. */
export function terminalsOfPriceRequest(url: string): number[] | null {
  const at = url.indexOf(PRICES_PATH);
  if (at < 0) return null;
  const ids = url.slice(at + PRICES_PATH.length).split(',').map(Number);
  return ids.every(Number.isInteger) ? ids : null;
}

/** Puts the price fake in place as the network of the preview and returns what the scene steers it with. */
export function installPriceFake({ rows, passes = Infinity, failTerminals = new Set<number>() }: PriceFakeOptions): PriceFake {
  let asked = 0;
  let allowed = passes;
  const waiting: Array<() => void> = [];

  const release = (count: number): void => {
    allowed += count;
    while (waiting.length > 0 && asked - waiting.length < allowed) waiting.shift()?.();
  };

  installHttpFake(async (url): Promise<FakeAnswer> => {
    const ids = terminalsOfPriceRequest(url);
    if (ids === null) throw new Error(`preview: no network for ${url}`);
    asked++;
    if (asked > allowed) await new Promise<void>((resolve) => waiting.push(resolve));
    if (ids.some((id) => failTerminals.has(id))) throw new Error('preview: the request stalled');
    return { status: 200, body: { status: 'ok', data: [...rows()].filter((p) => ids.includes(p.terminalId)).map(priceRow) } };
  });

  return {
    asked: () => asked,
    release,
    openAll: () => release(Infinity),
  };
}
