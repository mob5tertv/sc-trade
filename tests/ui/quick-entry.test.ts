import { describe, expect, it } from 'vitest';
import { defaultSide, resolveQuickEntry } from '../../src/ui/vm/quick-entry';
import { terminalRows } from '../../src/ui/vm/terminal-rows';
import { buildMarket } from '../../src/core/market';
import { obs, px, ref } from '../helpers/factories';
import { NOW, ctx } from '../helpers/terminal-fixtures';

const BUY_ONLY = { buy: { avgWeek: 6000, minWeek: 5900, maxWeek: 6200 } };
const SELL_ONLY = { sell: { avgWeek: 7000, minWeek: 6800, maxWeek: 7200 } };

/** The rows of terminal 1 for one market, as the Terminal tab builds them. */
const rowsOf = (uex: ReturnType<typeof px>[], own: ReturnType<typeof obs>[] = []) => terminalRows(buildMarket(uex, own), ref, 1, ctx);

describe('defaultSide', () => {
  it('is the side the terminal trades the commodity on: it sells it, so the player buys', () => {
    const [gold] = rowsOf([px(1, 10, { ...BUY_ONLY, dateModified: NOW - 60 })]);
    expect(defaultSide(gold)).toBe('buy');
  });

  it('is sell when the terminal only buys the commodity', () => {
    const [gold] = rowsOf([px(1, 10, { ...SELL_ONLY, dateModified: NOW - 60 })]);
    expect(gold.buy).toBeNull();
    expect(defaultSide(gold)).toBe('sell');
  });

  it('is buy when the terminal trades it both ways', () => {
    const [gold] = rowsOf([px(1, 10, { ...BUY_ONLY, ...SELL_ONLY, dateModified: NOW - 60 })]);
    expect(gold.buy).not.toBeNull();
    expect(gold.sell).not.toBeNull();
    expect(defaultSide(gold)).toBe('buy');
  });

  it('follows my own diary as well as UEX', () => {
    const [gold] = rowsOf([], [obs({ id: 1, ts: NOW - 60, terminalId: 1, commodityId: 10, side: 'sell', price: 7000 })]);
    expect(defaultSide(gold)).toBe('sell');
  });

  it('is buy for a commodity the terminal does not trade at all', () => {
    expect(defaultSide(undefined)).toBe('buy');
    expect(defaultSide({ buy: null, sell: null })).toBe('buy');
  });
});

describe('resolveQuickEntry', () => {
  it('reads the price and an optional quantity', () => {
    expect(resolveQuickEntry('6120', '340')).toEqual({ ok: true, price: 6120, scu: 340 });
    expect(resolveQuickEntry('6 120', '')).toEqual({ ok: true, price: 6120, scu: null });
    expect(resolveQuickEntry(' 6120 ', '   ')).toEqual({ ok: true, price: 6120, scu: null });
  });

  it('keeps a typed zero quantity: that is a known empty stock', () => {
    expect(resolveQuickEntry('6120', '0')).toEqual({ ok: true, price: 6120, scu: 0 });
  });

  it('marks the price when it is empty, zero or not a number, and saves nothing', () => {
    expect(resolveQuickEntry('', '340')).toEqual({ ok: false, price: true, scu: false });
    expect(resolveQuickEntry('0', '')).toEqual({ ok: false, price: true, scu: false });
    expect(resolveQuickEntry('6k', '')).toEqual({ ok: false, price: true, scu: false });
  });

  it('marks a quantity that is typed but not a number, and saves nothing', () => {
    expect(resolveQuickEntry('6120', 'много')).toEqual({ ok: false, price: false, scu: true });
  });

  it('marks both when both are wrong', () => {
    expect(resolveQuickEntry('abc', '-5')).toEqual({ ok: false, price: true, scu: true });
  });
});
