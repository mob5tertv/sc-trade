import { beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../../src/data/db';
import { LADDER_ROI, NO_DATA_TERMINAL, VIEWED_TERMINAL, type GalleryData } from '../../src/preview/gallery/data';
import { routeOptionRow } from '../../src/ui/vm/route-rows';
import { DEFAULT_ROUTE_SORT, FIRST_DIR, ROUTE_SORT_KEYS, sortRoutes, type RouteSort } from '../../src/ui/vm/route-sort';
import { roiTier } from '../../src/ui/vm/roi-tier';
import { sideCounts } from '../../src/ui/vm/terminal-rows';
import { galleryWithDiary, priceMoves } from '../helpers/price-trend-fixtures';
import type { PriceMove } from '../helpers/price-trend-fixtures';

/** A price is written with a non-breaking space as the thousands separator: '1 234' here is '1 234' there (the other spaces stay). */
const nbsp = (text: string): string => text.replace(/(\d) (?=\d{3}\b)/g, `$1${String.fromCharCode(0xa0)}`);

let data: GalleryData;
let diary: Db;
/** The prices of mine that have an earlier reading in the diary the gallery data was read from. */
let moves: PriceMove[];
beforeAll(async () => {
  const loaded = await galleryWithDiary();
  data = loaded.data;
  diary = loaded.db;
  moves = await priceMoves(loaded.db);
});

describe('the gallery table of the viewed terminal', () => {
  it('is the table of HUR-L1, named the way the header names it', () => {
    expect(data.viewedId).toBe(VIEWED_TERMINAL);
    expect(data.viewedName).toBe('HUR-L1');
    expect(data.rows.length).toBeGreaterThanOrEqual(8);
  });

  it('shows a price of every freshness: hot, warm, cooling, cold and UEX', () => {
    const kinds = new Set(data.rows.flatMap((r) => [r.buy, r.sell]).map((c) => c?.badge?.kind));
    for (const kind of ['hot', 'warm', 'cooling', 'cold', 'uex'] as const) expect(kinds.has(kind), kind).toBe(true);
  });

  it('has a different number of rows on the two sides, each with enough rows to read', () => {
    const counts = sideCounts(data.rows);
    expect(counts.buy).toBeGreaterThanOrEqual(5);
    expect(counts.sell).toBeGreaterThanOrEqual(3);
    expect(counts.buy).not.toBe(counts.sell);
  });

  it('has a row that is traded on both sides', () => {
    expect(data.rows.some((r) => r.buy !== null && r.sell !== null)).toBe(true);
  });

  it('has ranges where UEX knows one and none where it does not', () => {
    const cells = data.rows.flatMap((r) => [r.buy, r.sell]).filter((c) => c !== null);
    expect(cells.some((c) => c.range.kind === 'spread')).toBe(true);
    expect(cells.some((c) => c.range.kind === 'none')).toBe(true);
  });

  it('has a price that looks like a typo, a stock moved by the refill timer and a quantity of the buyer', () => {
    const cells = data.rows.flatMap((r) => [r.buy, r.sell]).filter((c) => c !== null);
    expect(cells.some((c) => c.warn)).toBe(true);
    expect(cells.some((c) => c.ownScuBase !== null)).toBe(true);
    expect(data.rows.some((r) => r.sell?.ownScu !== null && r.sell?.ownScu !== undefined)).toBe(true);
  });

  describe('the triangles of prices of mine that moved', () => {
    const cellOf = (code: string, side: 'buy' | 'sell') => data.rows.find((r) => r.code === code)?.[side] ?? null;

    it('has a rise and a fall on each side, coloured by what is good for the player there', () => {
      expect(cellOf('MEDS', 'buy')?.trend).toMatchObject({ dir: 'up', good: false }); // bought dearer
      expect(cellOf('PFOO', 'buy')?.trend).toMatchObject({ dir: 'down', good: true }); // bought cheaper
      expect(cellOf('TUNG', 'sell')?.trend).toMatchObject({ dir: 'up', good: true }); // sold dearer
      expect(cellOf('DIAM', 'sell')?.trend).toMatchObject({ dir: 'down', good: false }); // sold cheaper
    });

    const moveOf = (code: string, side: 'buy' | 'sell') => moves.find((m) => m.terminal === VIEWED_TERMINAL && m.code === code && m.side === side);

    it('has prices of mine that are the same as in the reading before: the previous reading exists and says the same', () => {
      for (const [code, side] of [['HYDR', 'buy'], ['LARA', 'sell']] as const) {
        const cell = cellOf(code, side);
        expect(cell?.own, `${code} ${side} is mine`).not.toBeNull();
        expect(moveOf(code, side), `${code} ${side} has an earlier reading`).toMatchObject({ was: cell?.own, now: cell?.own });
        expect(cell?.trend, `${code} ${side}`).toBeNull();
      }
    });

    it('has a price of mine seen only once, so that there is nothing to compare with', () => {
      expect(cellOf('GOLD', 'buy')?.own).not.toBeNull();
      expect(moveOf('GOLD', 'buy')).toBeUndefined();
      expect(cellOf('GOLD', 'buy')?.trend).toBeNull();
    });

    it('has the longest line of an expanded row: a five-digit price that moved, a stock estimate with its base, a learned rate and a typo', () => {
      const cell = cellOf('SCRA', 'buy');
      expect(cell?.own).toBeGreaterThanOrEqual(10_000);
      expect(cell?.trend).toMatchObject({ dir: 'up', good: false });
      expect(cell?.warn).toBe(true);
      expect(cell?.ownScuBase).not.toBeNull(); // 'было 150 · 5 ч'
      expect(cell?.ownScuRate).toBe('learned');
      expect(cell?.badge?.kind).toBe('hot');
    });

    it('has UEX prices and a cold price of mine without a triangle', () => {
      expect(cellOf('GOLD', 'sell')).toMatchObject({ own: null, trend: null });
      expect(cellOf('ALUM', 'buy')).toMatchObject({ own: null, trend: null });
    });
  });

  it('has a table that is empty for a terminal nothing is known about', () => {
    expect(NO_DATA_TERMINAL).not.toBe(VIEWED_TERMINAL);
    expect(data.noRows).toEqual([]);
  });

  it('feeds the quick entry: every commodity, the ones the terminal trades first, and the side the terminal trades on', () => {
    expect(data.commodityItems.length).toBeGreaterThanOrEqual(15);
    expect(data.boostIds.size).toBe(data.rows.length);
    const sellOnly = data.rows.find((r) => r.sell !== null && r.buy === null);
    expect(sellOnly).toBeDefined();
    expect(data.sideFor(sellOnly!.commodityId)).toBe('sell');
  });
});

describe('the gallery «Мин–макс» states: a spread, one price, nothing', () => {
  const tableRows = () => data.ranges.rows;
  const buyOf = (code: string) => tableRows().find((r) => r.code === code)?.buy ?? null;
  const tripsAt = (mode: 'from' | 'to') => data.ranges.trips.map((o) => routeOptionRow(o, data.reference, mode, data.runCounts, { uexRange: data.ranges.uexRange }));
  const nb = (s: string) => s.replace(/ /g, String.fromCharCode(0xa0));

  it('has a table with a row of each kind, from a terminal that is none of the other states', () => {
    expect(data.ranges.terminalId).not.toBe(VIEWED_TERMINAL);
    const kinds = new Set(tableRows().map((r) => r.buy?.range.kind));
    expect([...kinds].sort()).toEqual(['flat', 'no-bounds', 'none', 'spread']);
  });

  it('has a UEX price without bounds: a price in the «Цена» column and a dash that does not say UEX knows no price', () => {
    expect(buyOf('QUAR')).toMatchObject({ own: null, hint: 1450, badge: { kind: 'uex' }, range: { kind: 'no-bounds' } });
  });

  it('has the one price UEX gives as the same minimum and maximum, the week deciding over the month', () => {
    expect(buyOf('MEDS')?.range).toEqual({ kind: 'flat', price: 5500 });
    expect(buyOf('GOLD')?.range).toEqual({ kind: 'flat', price: 31_000 }); // the month moved 30 000-31 000; the estimate takes the week
    expect(buyOf('TUNG')?.range).toEqual({ kind: 'spread', low: 3480, high: 3820 });
  });

  it('has a seven-digit price that is one price', () => {
    expect(buyOf('TITA')?.range).toEqual({ kind: 'flat', price: 1_300_000 });
    expect(buyOf('TITA')?.hint).toBe(1_300_000);
  });

  it('has prices of mine with what UEX knows beside them: one price, a spread and nothing', () => {
    expect(buyOf('AGRI')).toMatchObject({ own: 2700, range: { kind: 'flat', price: 2650 } });
    expect(buyOf('DIAM')).toMatchObject({ own: 7100, range: { kind: 'spread', low: 6800, high: 7300 } });
    expect(buyOf('STIM')).toMatchObject({ own: 3100, range: { kind: 'none' } });
  });

  it('has a cold price of mine that UEX knows nothing about: a hint and a dash', () => {
    expect(buyOf('BERY')).toMatchObject({ own: null, hint: 4200, range: { kind: 'none' }, badge: { kind: 'cold' } });
  });

  it('has trips for the list that show the three kinds in the «Мин–макс» column, one of them seven digits', () => {
    const rows = tripsAt('from');
    expect(new Set(rows.map((r) => r.price.range.kind))).toEqual(new Set(['spread', 'flat', 'no-bounds', 'none']));
    expect(rows.map((r) => r.price.range.text)).toContain(`= ${nb('1 300 000')}`);
    expect(rows.map((r) => r.price.range.text)).toContain(`= ${nb('5 500')}`);
  });

  it('has trips whose price is mine, with the one price or the spread UEX knows beside it', () => {
    const own = tripsAt('from').filter((r) => r.price.badge.kind !== 'uex');
    expect(own.map((r) => r.price.range.kind).sort()).toEqual(['flat', 'none', 'spread']);
  });
});

describe('the gallery route lists', () => {
  const rowsOf = (options: GalleryData['routes']['from'], mode: 'from' | 'to') =>
    options.map((o) => routeOptionRow(o, data.reference, mode, data.runCounts, {
      anchorTerminalId: VIEWED_TERMINAL, targetTerminalId: data.settings.targetTerminalId, uexRange: data.uexRange,
    }));

  it('has trips whose far price is mine, with the range UEX knows beside it', () => {
    const own = rowsOf(data.routes.to, 'to').filter((r) => r.price.badge.kind !== 'uex');
    expect(own.length).toBeGreaterThan(0);
    expect(own.every((r) => r.price.range.kind !== 'none')).toBe(true); // UEX knows a price at every place of the dataset
  });

  /** The trips whose price in the «Цена» column is mine and has an earlier reading that says exactly the same. */
  const unchanged = (options: GalleryData['routes']['from'], mode: 'from' | 'to') => options.filter((o) => {
    const [estimate, terminalId, side] = mode === 'from' ? [o.sell, o.destId, 'sell' as const] : [o.buy, o.originId, 'buy' as const];
    const code = data.reference.commodities.get(o.commodityId)?.code;
    const move = moves.find((m) => m.terminal === terminalId && m.code === code && m.side === side);
    return estimate.source === 'own' && move !== undefined && move.was === estimate.price && move.now === estimate.price;
  });

  it('has trips whose price in the «Цена» column moved, is unchanged, or is UEX: the triangles of both modes', () => {
    const from = rowsOf(data.routes.from, 'from');
    // trips from here show the sale price at the far end: a rise is good, a fall is bad
    expect(from.some((r) => r.trend?.dir === 'up' && r.trend.good)).toBe(true);
    expect(from.some((r) => r.trend?.dir === 'down' && !r.trend.good)).toBe(true);
    expect(from.some((r) => r.trend === null && r.price.badge.kind === 'uex')).toBe(true);
    // trips to here show the purchase price at the far end: a fall is good, a rise is bad
    const to = rowsOf(data.routes.to, 'to');
    expect(to.some((r) => r.trend?.dir === 'down' && r.trend.good)).toBe(true);
    expect(to.some((r) => r.trend?.dir === 'up' && !r.trend.good)).toBe(true);
    expect(to.some((r) => r.trend === null && r.price.badge.kind === 'uex')).toBe(true);
  });

  it('has trips whose own price is the same as in the reading before, in both modes: no triangle', () => {
    for (const [options, mode] of [[data.routes.from, 'from'], [data.routes.to, 'to']] as const) {
      const same = unchanged(options, mode);
      expect(same.length, mode).toBeGreaterThan(0);
      for (const row of rowsOf(same, mode)) expect(row.trend, mode).toBeNull();
    }
  });

  it('has trips from and to the viewed terminal', () => {
    expect(data.routes.from.length).toBeGreaterThan(0);
    expect(data.routes.to.length).toBeGreaterThan(0);
    expect(data.routes.from.every((o) => o.originId === VIEWED_TERMINAL)).toBe(true);
    expect(data.routes.to.every((o) => o.destId === VIEWED_TERMINAL)).toBe(true);
  });

  it('has "и рядом" trips that start at another terminal of the planet, so that both ends show', () => {
    const rows = rowsOf(data.routes.nearby, 'from');
    expect(rows.some((r) => r.bothEnds)).toBe(true);
    expect(rowsOf(data.routes.from, 'from').every((r) => !r.bothEnds)).toBe(true);
  });

  it('has a ladder of five options, one in each ROI tier', () => {
    expect(data.routes.ladder).toHaveLength(5);
    expect(data.routes.ladder.map((o) => o.roi)).toEqual([...LADDER_ROI]);
    expect(data.routes.ladder.map((o) => roiTier(o.roi))).toEqual(['great', 'good', 'ok', 'poor', 'loss']);
    expect(rowsOf(data.routes.ladder, 'from').map((r) => r.tier)).toEqual(['great', 'good', 'ok', 'poor', 'loss']);
    // a loss loses money, whatever the search would say: the numbers of the row agree with its ROI
    expect(data.routes.ladder[4].profit).toBeLessThan(0);
  });

  it('has ROI that the search itself made: the natural lists are not all in one tier', () => {
    const tiers = new Set([...data.routes.from, ...data.routes.nearby, ...data.routes.to].map((o) => roiTier(o.roi)));
    expect(tiers.size).toBeGreaterThanOrEqual(2);
  });

  it('has titles for the section header, one of them long', () => {
    expect(data.titles.from).toBe('Куда везти с HUR-L1');
    expect(data.titles.nearby).toBe('Куда везти с HUR-L1 и рядом');
    expect(data.titles.to).toBe('Где купить для HUR-L1');
    expect(data.titles.long.length).toBeGreaterThan(50);
  });
});

describe('the gallery run, mini line and history', () => {
  it('has the idle line, the line of a run and the line of a run with a cargo that cannot fit', () => {
    expect(data.strip.idle).toEqual({ kind: 'idle', location: 'HUR-L1', target: 'ARC-L1', session: null });
    expect(data.strip.run).toMatchObject({ kind: 'run', target: 'ARC-L1', cargo: nbsp('MEDS 120 по 2 115, STIM 80 по 2 810') });
    if (data.strip.run.kind !== 'run' || data.strip.long.kind !== 'run') throw new Error('expected runs');
    expect(data.strip.run.profit).not.toBeNull();
    expect(data.strip.run.rate).not.toBeNull();
    expect(data.strip.long.cargo.length).toBeGreaterThan(60);
  });

  it('has the line of one commodity at an ordinary price: what it cost, what it is expected to bring, the profit and the rate', () => {
    const { single } = data.strip.cargo;
    if (single.kind !== 'run') throw new Error('expected a run');
    expect(single.cargo).toBe(nbsp('MEDS 120 SCU по 2 115'));
    expect(single.cargoLine).toMatch(/^MEDS 120 SCU по 2.115, ждём \d/);
    expect(single.profit).toMatch(/^≈ [+-]\d/);
    expect(single.rate).toMatch(/\/ч$/);
  });

  it('has the lines of one, two and three commodities bought for seven-digit prices, and the run without a target', () => {
    const { one, two, three } = data.strip.cargo;
    expect(one).toMatchObject({ kind: 'run', cargo: nbsp('MEDS 600 SCU по 1 234 567') });
    expect(two).toMatchObject({ kind: 'run', cargo: nbsp('MEDS 120 по 1 234 567, STIM 80 по 2 345 678') });
    expect(three).toMatchObject({ kind: 'run', cargo: nbsp('MEDS 120 по 1 234 567, STIM 80 по 2 345 678, PFOO 50 по 1 456 789') });
    // the target of the dataset pays for all three: the profit and the rate are there, and every one is expected in the tooltip (not in the line)
    if (three.kind !== 'run') throw new Error('expected a run');
    expect(three.profit).not.toBeNull();
    expect(three.rate).not.toBeNull();
    expect(three.cargoTitle.split('\n')).toHaveLength(3);
    if (data.strip.noTarget.kind !== 'run') throw new Error('expected a run');
    expect(data.strip.noTarget).toMatchObject({ target: null, profit: null, rate: null });
    expect(data.strip.noTarget.cargoTitle).not.toContain('ждём');
  });

  it('has routes that a sort puts in a different order by every column, one of them at a loss', () => {
    expect(data.routeStats.length).toBeGreaterThanOrEqual(5);
    const first = (sort: RouteSort): string => sortRoutes(data.routeStats, sort)[0].key;
    const firsts = new Set(ROUTE_SORT_KEYS.map((key) => first({ key, dir: FIRST_DIR[key] })));
    expect(firsts.size).toBeGreaterThanOrEqual(3);
    // the time puts another route on top than the ROI does, and the rate another than the time
    expect(first({ key: 'time', dir: 'asc' })).not.toBe(first({ key: 'roi', dir: 'desc' }));
    expect(first({ key: 'time', dir: 'asc' })).not.toBe(first(DEFAULT_ROUTE_SORT));
    // the order of the core is the order of the rate, best first
    expect(sortRoutes(data.routeStats, DEFAULT_ROUTE_SORT).map((row) => row.key)).toEqual(data.routeStats.map((row) => row.key));
    expect(data.routeStats.some((row) => row.stat.totalProfit < 0)).toBe(true);
  });

  it('has the card of the run, the sale decision and the three lists of the player', () => {
    expect(data.runCard.cargo.map((l) => l.code)).toEqual(['MEDS', 'STIM']);
    expect(data.runCard.timer).toBe('25:05');
    // a run that goes on shows its expected result (the target of the dataset has prices for both commodities), not a loss
    expect(data.runCard.outlook.expected).toMatchObject({ profitLoss: false });
    expect(data.runCard.outlook.revenue).toBe('0');
    expect(data.sell.commodityCode).toBe('MEDS');
    expect(data.sell.alternatives.length).toBeGreaterThan(0);
    expect(data.history.length).toBeGreaterThanOrEqual(2);
    expect(data.sessions.length).toBeGreaterThanOrEqual(1);
    expect(data.routeStats.length).toBeGreaterThanOrEqual(1);
  });
});

describe('the gallery tables with the best ROI of their rows', () => {
  const idOf = (code: string): number => {
    const found = [...data.reference.commodities.values()].find((c) => c.code === code);
    if (found === undefined) throw new Error(`no commodity ${code}`);
    return found.id;
  };
  const threshold = (): number => data.settings.roiHighlightPct;

  it('has the ROI of the rows of the viewed terminal on both sides, from the search over the market of the dataset', () => {
    expect(data.roi.here.buy.size).toBeGreaterThanOrEqual(3);
    expect(data.roi.here.sell.size).toBeGreaterThanOrEqual(3);
    for (const best of [...data.roi.here.buy.values(), ...data.roi.here.sell.values()]) expect(best.roi).toBeGreaterThan(0);
    // every value belongs to a row of the table of its side
    for (const id of data.roi.here.buy.keys()) expect(data.rows.find((r) => r.commodityId === id)?.buy, `${id} buy`).not.toBeNull();
    for (const id of data.roi.here.sell.keys()) expect(data.rows.find((r) => r.commodityId === id)?.sell, `${id} sell`).not.toBeNull();
  });

  it('has the table of Lorville with a row of every tier on the sell side, four rows at or above the threshold and two without a trip', () => {
    const { rows, sell } = data.roi.lorville;
    const values = rows.filter((r) => r.sell !== null).map((r) => sell.get(r.commodityId)?.roi);
    expect(new Set(values.filter((v) => v !== undefined).map((v) => roiTier(v ?? 0)))).toEqual(new Set(['great', 'good', 'ok', 'poor']));
    expect(values.filter((v) => v !== undefined && v >= threshold() / 100 - 0.005)).toHaveLength(4);
    expect(values.filter((v) => v === undefined)).toHaveLength(2);
    expect(sell.has(idOf('QUAR'))).toBe(false);
    expect(sell.has(idOf('BERY'))).toBe(false);
  });

  it('has the table of Lorville on the buy side: Gold above the threshold, a lower tier each, Scrap without a trip', () => {
    const { buy } = data.roi.lorville;
    expect(buy.get(idOf('GOLD'))?.roi).toBeGreaterThanOrEqual(threshold() / 100);
    expect(buy.get(idOf('TUNG'))?.roi).toBeLessThan(threshold() / 100);
    expect(buy.has(idOf('SCRA'))).toBe(false);
    expect(new Set([...buy.values()].map((b) => roiTier(b.roi)))).toEqual(new Set(['great', 'good', 'ok', 'poor']));
  });

  it('writes the prices of Lorville at `now`, so that the diary the other states are tested against does not have them', async () => {
    const found = await diary.select<{ n: number }>('SELECT COUNT(*) AS n FROM observation WHERE terminal_id = ? AND ts >= ?', [data.roi.lorville.terminalId, data.now]);
    expect(found[0].n).toBe(0);
  });
});
