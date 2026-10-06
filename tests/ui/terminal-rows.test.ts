import { describe, expect, it } from 'vitest';
import { badgeText, terminalRows } from '../../src/ui/vm/terminal-rows';
import { buildMarket } from '../../src/core/market';
import { obs, px, ref } from '../helpers/factories';
import { NOW, ctx, est, market, withOwnBuy, withUexRange } from '../helpers/terminal-fixtures';

describe('terminalRows', () => {
  it('shows own values with a temperature badge and UEX values as hints', () => {
    const rows = terminalRows(market, ref, 1, ctx);       // terminal 1: Gold — own buy 6120/340 two minutes ago; Tungsten — UEX only 3980/410
    expect(rows.map(r => r.code)).toEqual(['GOLD', 'TUNG']);
    expect(rows[0].buy).toEqual({ own: 6120, ownScu: 340, hint: null, hintScu: null, badge: { text: 'моя · 2 мин', kind: 'hot' }, warn: false });
    expect(rows[0].sell).toBeNull();
    expect(rows[1].buy).toEqual({ own: null, ownScu: null, hint: 3980, hintScu: 410, badge: { text: 'UEX', kind: 'uex' }, warn: false });
  });

  it('demotes a cold own value to a hint', () => {
    const rows = terminalRows(withOwnBuy(market, 1, 10, 6120, NOW - 5 * 3600), ref, 1, ctx);
    expect(rows[0].buy).toMatchObject({ own: null, hint: 6000, badge: { kind: 'uex' } });
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

  it('badgeText', () => {
    expect(badgeText({ ...est, source: 'own', temp: 'cooling', ageSec: 12600 })).toEqual({ text: 'моя · 3,5 ч', kind: 'cooling' });
    expect(badgeText({ ...est, source: 'own', temp: 'cold', ageSec: 18000 })).toEqual({ text: 'моя · 5 ч', kind: 'cold' });
  });

  it('badgeText for a UEX estimate', () => {
    expect(badgeText({ ...est, source: 'uex', temp: null, ageSec: 7200 })).toEqual({ text: 'UEX', kind: 'uex' });
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
      [px(1, 10, { buy: { avgWeek: 6000 }, sell: { avgWeek: 6500 }, scuSell: 90 })],
      [obs({ ts: NOW - 60, terminalId: 1, commodityId: 10, side: 'buy', price: 6100, scu: 200 })],
    );
    const [row] = terminalRows(m, ref, 1, ctx);
    expect(row.buy).toMatchObject({ own: 6100, ownScu: 200 });
    expect(row.sell).toEqual({ own: null, ownScu: null, hint: 6500, hintScu: 90, badge: { text: 'UEX', kind: 'uex' }, warn: false });
  });

  it('keeps a cold own value as a grey hint when UEX has nothing for it', () => {
    const m = buildMarket([], [obs({ ts: NOW - 5 * 3600, terminalId: 1, commodityId: 10, side: 'buy', price: 6120, scu: 340 })]);
    expect(terminalRows(m, ref, 1, ctx)[0].buy)
      .toEqual({ own: null, ownScu: null, hint: 6120, hintScu: null, badge: { text: 'моя · 5 ч', kind: 'cold' }, warn: false });
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
