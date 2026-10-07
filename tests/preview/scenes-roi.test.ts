import { describe, expect, it } from 'vitest';
import type { RouteCtx } from '../../src/core/routes';
import type { Side } from '../../src/core/types';
import type { Db } from '../../src/data/db';
import { createLogger, memorySink } from '../../src/data/logger';
import { addObservation } from '../../src/data/repo/diary';
import { loadSettings } from '../../src/data/repo/settings';
import { loadDistances, loadReference } from '../../src/data/repo/uex-cache';
import { loadMarket } from '../../src/data/suggest';
import { prepareAnyDataset } from '../../src/preview/prepare';
import { BUY_PRICES, COMMODITY, EARLY_SELL_PRICES, LORVILLE, ROI_SCENES, SELL_PRICES } from '../../src/preview/scenes-roi';
import type { PricedCommodity } from '../../src/preview/scenes-roi';
import { SCENES } from '../../src/preview/scenes';
import { roiTier } from '../../src/ui/vm/roi-tier';
import { crossedRows, isHot, rowRoiMap } from '../../src/ui/vm/row-roi';
import type { RoiSnapshot } from '../../src/ui/vm/row-roi';
import { testDb } from '../helpers/test-db';

const NOW = 1_800_000_000;
const RUIN_STATION = 14;
const log = createLogger(memorySink());

/** The default dataset, then the prices of a scene entered the way `recordPrice` writes them (one observation each, a second apart). */
async function datasetWith(...entries: Array<[Side, readonly PricedCommodity[]]>): Promise<Db> {
  const db = testDb();
  await prepareAnyDataset(db, 'default', NOW);
  let ts = NOW - 60;
  for (const [side, prices] of entries) {
    for (const { code, price } of prices) {
      await addObservation(db, log, { ts: ts++, terminalId: LORVILLE, commodityId: COMMODITY[code], side, price, scu: null });
    }
  }
  return db;
}

async function roiOf(db: Db, terminalId: number, side: Side) {
  const settings = await loadSettings(db, log);
  const reference = await loadReference(db);
  const ctx: RouteCtx = {
    now: NOW,
    thresholds: { hotMin: settings.hotMin, warmMin: settings.warmMin, coolingMin: settings.coolingMin },
    serverChangedAt: settings.serverChangedAt,
    refillFullMin: settings.refillFullMin,
    settings: {
      starSystemId: settings.starSystemId, budget: settings.budget, quantumSpeedKkms: settings.quantumSpeedKkms,
      overheadMin: settings.overheadMin, overheadEmptyMin: settings.overheadEmptyMin, topN: settings.topN, sort: settings.sort,
    },
    freeScu: settings.scuCapacity,
    terminals: reference.terminals,
    distances: await loadDistances(db),
    ownMedian: new Map(),
  };
  return { map: rowRoiMap(await loadMarket(db), terminalId, side, ctx), threshold: settings.roiHighlightPct };
}

describe('the ROI scenes: the prices the player types give the ROI that each row is made for', () => {
  it('Lorville buys at a price for every tier on the sell side', async () => {
    const { map } = await roiOf(await datasetWith(['sell', SELL_PRICES]), LORVILLE, 'sell');
    for (const { code, roi } of SELL_PRICES) {
      const best = map.get(COMMODITY[code]);
      if (roi === null) {
        expect(best, `${code} has no trip`).toBeUndefined();
      } else {
        expect(best?.roi, code).toBeCloseTo(roi, 2);
      }
    }
  });

  it('the sell side has the tiers great, good, ok and poor, and the first four rows are at or above the threshold of 50 %', async () => {
    const { map, threshold } = await roiOf(await datasetWith(['sell', SELL_PRICES]), LORVILLE, 'sell');
    expect(threshold).toBe(50);
    const values = SELL_PRICES.map(({ code }) => map.get(COMMODITY[code])?.roi);
    expect(new Set(values.filter((v) => v !== undefined).map((v) => roiTier(v ?? 0)))).toEqual(new Set(['great', 'good', 'ok', 'poor']));
    expect(values.slice(0, 4).every((v) => v !== undefined && isHot(v, threshold))).toBe(true);
    expect(values.slice(4).some((v) => v !== undefined && isHot(v, threshold))).toBe(false);
    // two great rows stay below the bar: the number is coloured, the row is not marked
    expect(values.filter((v) => v !== undefined && roiTier(v) === 'great' && !isHot(v, threshold))).toHaveLength(2);
    expect(values.filter((v) => v === undefined)).toHaveLength(2);
  });

  it('the buy side has a trip of every tier but one row that pays nothing', async () => {
    const { map, threshold } = await roiOf(await datasetWith(['buy', BUY_PRICES]), LORVILLE, 'buy');
    for (const { code, roi } of BUY_PRICES) {
      const best = map.get(COMMODITY[code]);
      if (roi === null) expect(best, `${code} has no trip`).toBeUndefined();
      else expect(best?.roi, code).toBeCloseTo(roi, 2);
    }
    const tiers = BUY_PRICES.flatMap(({ code }) => { const best = map.get(COMMODITY[code]); return best ? [roiTier(best.roi)] : []; });
    expect(new Set(tiers)).toEqual(new Set(['great', 'good', 'ok', 'poor']));
    const hot = BUY_PRICES.filter(({ code }) => { const best = map.get(COMMODITY[code]); return best !== undefined && isHot(best.roi, threshold); });
    expect(hot.map(({ code }) => code)).toEqual(['GOLD']);
  });

  it('a terminal of another star system than the search has rows and no trip on either side', async () => {
    const db = await datasetWith();
    expect((await roiOf(db, RUIN_STATION, 'sell')).map.size).toBe(0);
    expect((await roiOf(db, RUIN_STATION, 'buy')).map.size).toBe(0);
  });

  it('the flash scene: the price of Stims is the one that takes a row over the threshold, and only that row', async () => {
    const before = await roiOf(await datasetWith(['sell', EARLY_SELL_PRICES]), LORVILLE, 'sell');
    const stims = SELL_PRICES.find(({ code }) => code === 'STIM');
    if (stims === undefined) throw new Error('no Stims among the prices');
    const after = await roiOf(await datasetWith(['sell', EARLY_SELL_PRICES], ['sell', [stims]]), LORVILLE, 'sell');
    const snap = (map: typeof before.map): RoiSnapshot => ({ terminalId: LORVILLE, side: 'sell', roi: map });
    expect(crossedRows(snap(before.map), snap(after.map), before.threshold)).toEqual([COMMODITY.STIM]);
  });

  it('the scenes are registered, each with its own name', () => {
    const names = ROI_SCENES.map((scene) => scene.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(SCENES.some((scene) => scene.name === name)).toBe(true);
  });
});
