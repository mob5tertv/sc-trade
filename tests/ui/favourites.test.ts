import { describe, expect, it } from 'vitest';
import { buildMarket } from '../../src/core/market';
import { FAVOURITES_FULL, FAVOURITES_MAX, favouriteAlerts, favouriteKey, isFavourite, toggledFavourites } from '../../src/ui/vm/favourites';
import { favouriteOf } from '../../src/ui/vm/stats-rows';
import { obs, ref } from '../helpers/factories';
import { ctx, GOLD, market, NOW, withBuy } from '../helpers/route-fixtures';
import { stat } from '../helpers/stats-rows-fixtures';

// Spec 14.19, item 11. A (1) sells Gold: my own reading of 340 SCU, ten minutes old; B (2) buys it at UEX 6900.
const route = { originId: 1, destId: 2, commodityId: GOLD };
const none = new Set<string>();

describe('toggledFavourites', () => {
  it('adds a route that is not a favourite and takes away one that is', () => {
    const added = toggledFavourites([], route);
    expect(added).toEqual({ list: [route], full: false });
    expect(isFavourite(added.list, route)).toBe(true);
    expect(toggledFavourites(added.list, { ...route })).toEqual({ list: [], full: false });
  });

  it('tells the same pair with another commodity, and the other direction, apart', () => {
    const list = [route];
    expect(isFavourite(list, { ...route, commodityId: 20 })).toBe(false);
    expect(isFavourite(list, { originId: 2, destId: 1, commodityId: GOLD })).toBe(false);
    expect(favouriteKey(route)).toBe('1>2:10');
  });

  it('adds nothing beyond the cap, and says the list is full', () => {
    const many = Array.from({ length: FAVOURITES_MAX }, (_, i) => ({ originId: 100 + i, destId: 2, commodityId: GOLD }));
    const refused = toggledFavourites(many, route);
    expect(refused.full).toBe(true);
    expect(refused.list).toEqual(many);
    expect(toggledFavourites(many, many[0])).toMatchObject({ full: false });      // taking one away always works
    expect(FAVOURITES_FULL).toContain(String(FAVOURITES_MAX));
  });

  it('is offered for a route of one commodity only', () => {
    expect(favouriteOf({ stat })).toEqual({ originId: 1, destId: 2, commodityId: 10 });
    expect(favouriteOf({ stat: { ...stat, commodityIds: [10, 20] } })).toBeNull();
  });
});

describe('favouriteAlerts', () => {
  it('speaks when the stock counted from my own reading is a full hold, and says what it rests on', () => {
    const { alerts, alerted } = favouriteAlerts([route], market, ref, ctx, 300, none);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].text).toMatch(/^★ ARC-L1 → TDD Area 18: GOLD ≈ \d+ SCU, на полный трюм · ROI 13%$/);
    expect(alerted.has('1>2:10')).toBe(true);
  });

  it('is silent while the stock is below the hold', () => {
    expect(favouriteAlerts([route], market, ref, ctx, 5000, none)).toEqual({ alerts: [], alerted: new Set() });
  });

  it('speaks once per filling: silent while it stays full, and again after it was seen below the hold', () => {
    const first = favouriteAlerts([route], market, ref, ctx, 300, none);
    const second = favouriteAlerts([route], market, ref, ctx, 300, first.alerted);
    expect(second.alerts).toEqual([]);
    expect(second.alerted.has('1>2:10')).toBe(true);
    // the player bought: a new reading of 20 SCU, the stock is below the hold, the route may speak again when it refills
    const bought = buildMarket([...market.uex.values()], [...market.own.values(), obs({ id: 50, ts: NOW - 30, terminalId: 1, commodityId: GOLD, side: 'buy', price: 6120, scu: 20 })]);
    const emptied = favouriteAlerts([route], bought, ref, ctx, 300, second.alerted);
    expect(emptied).toEqual({ alerts: [], alerted: new Set() });
    expect(favouriteAlerts([route], market, ref, ctx, 300, emptied.alerted).alerts).toHaveLength(1);
  });

  it('does not count a quantity of UEX: it does not grow, and it is not this server\'s', () => {
    const uexOnly = withBuy(buildMarket([...market.uex.values()], []), 1, { avgWeek: 6120, minWeek: 6120, maxWeek: 6120 });
    const row = uexOnly.uex.get('1:10')!;
    const withStock = buildMarket([...uexOnly.uex.values()].map((r) => (r === row ? { ...r, scuBuy: 5000 } : r)), []);
    expect(favouriteAlerts([route], withStock, ref, ctx, 300, none).alerts).toEqual([]);
  });

  it('is silent after «Сменил сервер» until a new reading: the old one is cold', () => {
    const changed = { ...ctx, serverChangedAt: NOW - 60 };          // my reading is ten minutes old, the change one minute
    expect(favouriteAlerts([route], market, ref, changed, 300, none).alerts).toEqual([]);
  });

  it('is silent without a capacity, and for a route nobody has a reading of', () => {
    expect(favouriteAlerts([route], market, ref, ctx, 0, none).alerts).toEqual([]);
    expect(favouriteAlerts([{ originId: 6, destId: 2, commodityId: GOLD }], market, ref, ctx, 300, none).alerts).toEqual([]);
  });
});
