import { describe, expect, it } from 'vitest';
import { DATASET_NAMES, isDatasetName } from '../../src/preview/datasets';
import { suggestFromDetailed, suggestToDetailed } from '../../src/data/suggest';
import { prepareAnyDataset } from '../../src/preview/prepare';
import { roiTier } from '../../src/ui/vm/roi-tier';
import { sideCounts } from '../../src/ui/vm/terminal-rows';
import { testDb } from '../helpers/test-db';
import { rowsOf, windowData } from '../helpers/window-layout-fixtures';

const HUR_L1 = 3;
const AREA_18 = 5;
const SERAPHIM = 12;
const GOLD = 2;

describe('the window dataset', () => {
  it('is a dataset of its own', () => {
    expect(DATASET_NAMES).toContain('window');
    expect(isDatasetName('window')).toBe(true);
  });

  it('is the default dataset with more in it: the settings and the history of the player are the same', async () => {
    const data = await windowData();
    expect(data.settings.scuCapacity).toBe(696);
    expect(data.settings.currentTerminalId).toBe(HUR_L1);
    expect(data.reference.terminals.size).toBe(19); // the 17 of the default dataset and the two gateways below
    expect(data.reference.commodities.size).toBeGreaterThan(15);
  });

  it('has two terminals of one name in different star systems, so that the location search has to tell them apart', async () => {
    const data = await windowData();
    const gateways = [...data.reference.terminals.values()].filter((t) => t.displayname === 'Stanton Gateway');
    expect(gateways).toHaveLength(2);
    expect(new Set(gateways.map((t) => t.starSystemId)).size).toBe(2);
    expect(gateways.every((t) => t.starSystemName !== null && data.reference.starSystems.some((s) => s.id === t.starSystemId))).toBe(true);
    // nothing is known about their prices, and neither the player's system nor the trips are touched
    for (const gateway of gateways) expect(await rowsOf(data, gateway.id)).toEqual([]);
  });

  it('is prepared by the same call as the others, and an unknown name is not its business', async () => {
    const db = testDb();
    await prepareAnyDataset(db, 'empty', 1_800_000_000);
    expect(await db.select('SELECT name FROM sqlite_master')).toEqual([]);
  });
});

describe('the window dataset: the options from HUR-L1', () => {
  it('has five trips on the ladder of ROI, answered from the cache alone', async () => {
    const { deps } = await windowData();
    const answer = await suggestFromDetailed(deps, HUR_L1, 696, undefined, { distances: 'cached' });
    expect(answer.missing).toBe(0);
    expect(answer.options).toHaveLength(5);
    const tiers = answer.options.map((o) => roiTier(o.roi));
    // the colour of the bar tells the trips apart: every tier but "loss" (a losing trip is never offered) is there
    expect(new Set(tiers)).toEqual(new Set(['great', 'good', 'ok', 'poor']));
  });

  it('has trips of the five commodities at five different places', async () => {
    const { deps } = await windowData();
    const { options } = await suggestFromDetailed(deps, HUR_L1, 696, undefined, { distances: 'cached' });
    expect(new Set(options.map((o) => o.destId)).size).toBe(5);
    expect(new Set(options.map((o) => o.commodityId)).size).toBe(5);
  });

  it('has a "where to buy" for Gold at Area 18 with more than one seller', async () => {
    const { deps } = await windowData();
    const { options } = await suggestToDetailed(deps, AREA_18, 696, GOLD, { distances: 'cached' });
    expect(options.length).toBeGreaterThanOrEqual(3);
    expect(options.every((o) => o.destId === AREA_18 && o.commodityId === GOLD)).toBe(true);
  });
});

describe('the window dataset: the tables', () => {
  it('has a terminal with two dozen rows on one side, so that a table has to scroll', async () => {
    const rows = await rowsOf(await windowData(), AREA_18);
    const counts = sideCounts(rows);
    expect(counts.sell).toBeGreaterThanOrEqual(24);
    expect(counts.buy).toBeGreaterThanOrEqual(1);
  });

  it('has the busy terminal drawn in full on both sides: every row has the numbers of a row', async () => {
    const rows = await rowsOf(await windowData(), AREA_18);
    for (const row of rows) expect(row.buy !== null || row.sell !== null, row.code).toBe(true);
    expect(new Set(rows.map((r) => r.code)).size).toBe(rows.length);
  });

  it('has a terminal nothing is known about, in the system of the player', async () => {
    const data = await windowData();
    expect(data.reference.terminals.get(SERAPHIM)?.starSystemId).toBe(data.settings.starSystemId);
    expect(await rowsOf(data, SERAPHIM)).toEqual([]);
  });

  it('keeps the rest of the terminals as the default dataset has them', async () => {
    const rows = await rowsOf(await windowData(), HUR_L1);
    expect(sideCounts(rows)).toEqual({ buy: 6, sell: 4 });
  });
});
