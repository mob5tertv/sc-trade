import { beforeAll, describe, expect, it } from 'vitest';
import { LADDER_ROI, NO_DATA_TERMINAL, VIEWED_TERMINAL, type GalleryData } from '../../src/preview/gallery/data';
import { routeOptionRow } from '../../src/ui/vm/route-rows';
import { roiTier } from '../../src/ui/vm/roi-tier';
import { sideCounts } from '../../src/ui/vm/terminal-rows';
import { galleryWithDiary, priceMoves } from '../helpers/price-trend-fixtures';
import type { PriceMove } from '../helpers/price-trend-fixtures';

let data: GalleryData;
/** The prices of mine that have an earlier reading in the diary the gallery data was read from. */
let moves: PriceMove[];
beforeAll(async () => {
  const loaded = await galleryWithDiary();
  data = loaded.data;
  moves = await priceMoves(loaded.db);
});

describe('the gallery table of the viewed terminal', () => {
  it('is the table of HUR-L1, named the way the header names it', () => {
    expect(data.viewedId).toBe(VIEWED_TERMINAL);
    expect(data.viewedName).toBe('HUR-L1 Green Glade Station');
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
    expect(cells.some((c) => c.range !== null)).toBe(true);
    expect(cells.some((c) => c.range === null)).toBe(true);
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

describe('the gallery route lists', () => {
  const rowsOf = (options: GalleryData['routes']['from'], mode: 'from' | 'to') =>
    options.map((o) => routeOptionRow(o, data.reference, mode, data.runCounts, {
      anchorTerminalId: VIEWED_TERMINAL, targetTerminalId: data.settings.targetTerminalId, uexRange: data.uexRange,
    }));

  it('has trips whose far price is mine, with the range UEX knows beside it', () => {
    const own = rowsOf(data.routes.to, 'to').filter((r) => r.price.badge.kind !== 'uex');
    expect(own.length).toBeGreaterThan(0);
    expect(own.every((r) => r.price.range !== null)).toBe(true); // UEX knows a range at every place of the dataset
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
    expect(data.strip.idle).toEqual({ kind: 'idle', location: 'HUR-L1', target: 'ARC-L1' });
    expect(data.strip.run).toMatchObject({ kind: 'run', target: 'ARC-L1', cargo: 'MEDS 120 SCU, STIM 80 SCU' });
    if (data.strip.run.kind !== 'run' || data.strip.long.kind !== 'run') throw new Error('expected runs');
    expect(data.strip.run.expect).not.toBeNull();
    expect(data.strip.run.rate).not.toBeNull();
    expect(data.strip.long.cargo.length).toBeGreaterThan(60);
  });

  it('has the card of the run, the sale decision and the three lists of the player', () => {
    expect(data.runCard.cargo.map((l) => l.code)).toEqual(['MEDS', 'STIM']);
    expect(data.runCard.timer).toBe('25:05');
    expect(data.sell.commodityCode).toBe('MEDS');
    expect(data.sell.alternatives.length).toBeGreaterThan(0);
    expect(data.history.length).toBeGreaterThanOrEqual(2);
    expect(data.sessions.length).toBeGreaterThanOrEqual(1);
    expect(data.routeStats.length).toBeGreaterThanOrEqual(1);
  });
});
