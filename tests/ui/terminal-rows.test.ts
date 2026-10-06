import { describe, expect, it } from 'vitest';
import { badgeText, terminalRows } from '../../src/ui/vm/terminal-rows';
import { buildMarket } from '../../src/core/market';
import { obs, px, ref } from '../helpers/factories';
import { NOW, ctx, est, market, withOwnBuy, withUexRange } from '../helpers/terminal-fixtures';

describe('terminalRows', () => {
  it('shows own values with a temperature badge and UEX values as hints', () => {
    const rows = terminalRows(market, ref, 1, ctx);       // terminal 1: Gold — own buy 6120/340 two minutes ago; Tungsten — UEX only 3980/410, an hour old
    expect(rows.map(r => r.code)).toEqual(['GOLD', 'TUNG']);
    expect(rows[0].buy).toEqual({
      own: 6120, ownScu: 340, hint: null, hintScu: null, badge: { text: 'моя · 2 мин', kind: 'hot' },
      uexRange: null, ownLast: null, warn: false,
    });
    expect(rows[0].sell).toBeNull();
    expect(rows[1].buy).toEqual({
      own: null, ownScu: null, hint: 3980, hintScu: 410, badge: { text: 'UEX · 1 ч', kind: 'uex' },
      uexRange: null, ownLast: null, warn: false,
    });
  });

  it('demotes a cold own value to a hint', () => {
    const rows = terminalRows(withOwnBuy(market, 1, 10, 6120, NOW - 5 * 3600), ref, 1, ctx);
    expect(rows[0].buy).toMatchObject({ own: null, hint: 6000, badge: { text: 'UEX · 1 ч', kind: 'uex' } });
  });

  it('keeps a cold own value as a reference next to the UEX hint', () => {
    const rows = terminalRows(withOwnBuy(market, 1, 10, 6120, NOW - 5 * 3600), ref, 1, ctx);
    expect(rows[0].buy).toMatchObject({ own: null, hint: 6000, ownLast: { price: 6120, age: '5 ч' }, uexRange: null });
  });

  it('shows the UEX range next to a cooling own value', () => {
    const rows = terminalRows(withOwnBuy(market, 1, 10, 6120, NOW - 200 * 60), ref, 1, ctx);
    expect(rows[0].buy).toMatchObject({ own: 6120, hint: null, badge: { text: 'моя · 3 ч', kind: 'cooling' }, uexRange: { low: 5900, high: 6200 }, ownLast: null });
  });

  it('flags a likely typo', () => {
    const rows = terminalRows(withOwnBuy(withUexRange(market, 1, 10, 5000, 7000), 1, 10, 61200, NOW - 60), ref, 1, ctx);
    expect(rows[0].buy!.warn).toBe(true);
  });

  it('lists a commodity known only from my diary', () => {
    expect(terminalRows(withOwnBuy(market, 1, 20, 300, NOW - 60), ref, 1, ctx).map(r => r.commodityId)).toContain(20);
  });

  it('skips commodities missing from the reference', () => {
    expect(terminalRows(withOwnBuy(market, 1, 999, 300, NOW - 60), ref, 1, ctx).some(r => r.commodityId === 999)).toBe(false);
  });

  it('skips a commodity with nothing to show on either side', () => {
    const m = buildMarket([px(1, 10), px(1, 30, { buy: { avgWeek: 100 } })], []);
    expect(terminalRows(m, ref, 1, ctx).map(r => r.commodityId)).toEqual([30]);
    expect(terminalRows(buildMarket([px(1, 10)], []), ref, 1, ctx)).toEqual([]);
  });

  it('badgeText', () => {
    expect(badgeText({ ...est, source: 'own', temp: 'cooling', ageSec: 12600 })).toEqual({ text: 'моя · 3,5 ч', kind: 'cooling' });
    expect(badgeText({ ...est, source: 'own', temp: 'cold', ageSec: 18000 })).toEqual({ text: 'моя · 5 ч', kind: 'cold' });
  });

  it('badgeText for a UEX estimate carries its age, unless the age is unknown', () => {
    expect(badgeText({ ...est, source: 'uex', temp: null, ageSec: 7200 })).toEqual({ text: 'UEX · 2 ч', kind: 'uex' });
    expect(badgeText({ ...est, source: 'uex', temp: null, ageSec: 7200 }, false)).toEqual({ text: 'UEX', kind: 'uex' });
  });

  it('labels a UEX row of unknown age (dateModified 0) with a plain UEX badge', () => {
    const m = buildMarket([px(1, 10, { buy: { avgWeek: 6000 } })], []);
    expect(terminalRows(m, ref, 1, ctx)[0].buy!.badge).toEqual({ text: 'UEX', kind: 'uex' });
  });

  it('is empty for a terminal nothing is known about', () => {
    expect(terminalRows(market, ref, 2, ctx)).toEqual([]);
  });

  it('sorts rows by commodity name', () => {
    const m = buildMarket(
      [px(1, 30, { buy: { avgWeek: 100 } }), px(1, 10, { buy: { avgWeek: 100 } })],
      [obs({ ts: NOW - 60, terminalId: 1, commodityId: 20, side: 'buy', price: 300 })],
    );
    expect(terminalRows(m, ref, 1, ctx).map(r => r.name)).toEqual(['Gold', 'Titanium', 'Tungsten']);
  });

  it('puts both sides of a commodity on one row', () => {
    const m = buildMarket(
      [px(1, 10, { buy: { avgWeek: 6000 }, sell: { avgWeek: 6500 }, scuSell: 90, dateModified: NOW - 7200 })],
      [obs({ ts: NOW - 60, terminalId: 1, commodityId: 10, side: 'buy', price: 6100, scu: 200 })],
    );
    const [row] = terminalRows(m, ref, 1, ctx);
    expect(row.buy).toMatchObject({ own: 6100, ownScu: 200 });
    expect(row.sell).toEqual({
      own: null, ownScu: null, hint: 6500, hintScu: 90, badge: { text: 'UEX · 2 ч', kind: 'uex' },
      uexRange: null, ownLast: null, warn: false,
    });
  });

  it('keeps a cold own value as a grey hint when UEX has nothing for it', () => {
    const m = buildMarket([], [obs({ ts: NOW - 5 * 3600, terminalId: 1, commodityId: 10, side: 'buy', price: 6120, scu: 340 })]);
    expect(terminalRows(m, ref, 1, ctx)[0].buy).toEqual({
      own: null, ownScu: null, hint: 6120, hintScu: null, badge: { text: 'моя · 5 ч', kind: 'cold' },
      uexRange: null, ownLast: null, warn: false,
    });
  });

  it('never presents the UEX quantity as my own', () => {
    const uex = [px(1, 10, { buy: { avgWeek: 6000 }, scuBuy: 410 })];
    const ownScuOf = (scu: number | null) => terminalRows(
      buildMarket(uex, [obs({ ts: NOW - 60, terminalId: 1, commodityId: 10, side: 'buy', price: 6100, scu })]), ref, 1, ctx,
    )[0].buy;
    expect(ownScuOf(null)).toMatchObject({ own: 6100, ownScu: null, hint: null, hintScu: 410 });
    expect(ownScuOf(0)).toMatchObject({ own: 6100, ownScu: null, hint: null, hintScu: 410 });
    expect(ownScuOf(340)).toMatchObject({ own: 6100, ownScu: 340, hint: null, hintScu: null });
  });

  it('warns on the bounds of the cell\'s own side and never on a hint', () => {
    const base = buildMarket(
      [px(1, 10, { buy: { avgWeek: 6000, min: 5000, max: 7000 }, sell: { avgWeek: 6500, min: 6000, max: 7000 } })],
      [obs({ ts: NOW - 60, terminalId: 1, commodityId: 10, side: 'sell', price: 6800 })],
    );
    expect(terminalRows(base, ref, 1, ctx)[0].sell!.warn).toBe(false);
    expect(terminalRows(withUexRange(base, 1, 10, 6000, 7000, 'buy'), ref, 1, ctx)[0].sell!.warn).toBe(false);
    expect(terminalRows(withUexRange(base, 1, 10, 100, 300, 'sell'), ref, 1, ctx)[0].sell!.warn).toBe(true);
    // a wild UEX-derived hint is only a hint: nothing to warn about
    expect(terminalRows(withUexRange(market, 1, 30, 10, 20), ref, 1, ctx)[1].buy).toMatchObject({ own: null, warn: false });
  });
});
