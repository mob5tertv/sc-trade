import { beforeAll, describe, expect, it } from 'vitest';
import { LADDER_ROI, NO_DATA_TERMINAL, VIEWED_TERMINAL, type GalleryData } from '../../src/preview/gallery/data';
import { routeOptionRow } from '../../src/ui/vm/route-rows';
import { roiTier } from '../../src/ui/vm/roi-tier';
import { sideCounts } from '../../src/ui/vm/terminal-rows';
import { galleryData } from '../helpers/gallery-fixtures';

let data: GalleryData;
beforeAll(async () => {
  data = await galleryData();
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
    expect(data.strip.idle).toEqual({ kind: 'idle', location: 'HUR-L1' });
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
