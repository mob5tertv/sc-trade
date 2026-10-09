import { describe, expect, it } from 'vitest';
import { REJECTIONS, defaultSide, rejectionText, resolveQuickEntry } from '../../src/ui/vm/quick-entry';
import { terminalRows } from '../../src/ui/vm/terminal-rows';
import { buildMarket } from '../../src/core/market';
import { obs, px, ref } from '../helpers/factories';
import { NOW, ctx } from '../helpers/terminal-fixtures';

const BUY_ONLY = { buy: { avgWeek: 6000, minWeek: 5900, maxWeek: 6200 } };
const SELL_ONLY = { sell: { avgWeek: 7000, minWeek: 6800, maxWeek: 7200 } };

/** The rows of terminal 1 for one market, as the Terminal tab builds them. */
const rowsOf = (uex: ReturnType<typeof px>[], own: ReturnType<typeof obs>[] = []) => terminalRows(buildMarket(uex, own), ref, 1, ctx);

// The side the switch «Куп.» / «Прод.» of the quick entry shows while the player has not picked one by hand, and the side the
// price is written to. The second argument is the side of the table of the terminal the player is looking at (the tab).
describe('defaultSide', () => {
  it('is the side the terminal trades the commodity on, whatever tab is shown: it only sells it, so the player buys', () => {
    const [gold] = rowsOf([px(1, 10, { ...BUY_ONLY, dateModified: NOW - 60 })]);
    expect(defaultSide(gold, 'buy')).toBe('buy');
    expect(defaultSide(gold, 'sell')).toBe('buy');
  });

  it('is sell when the terminal only buys the commodity, whatever tab is shown', () => {
    const [gold] = rowsOf([px(1, 10, { ...SELL_ONLY, dateModified: NOW - 60 })]);
    expect(gold.buy).toBeNull();
    expect(defaultSide(gold, 'buy')).toBe('sell');
    expect(defaultSide(gold, 'sell')).toBe('sell');
  });

  it('is the side of the tab when the terminal trades it both ways: the player enters what he is looking at', () => {
    const [gold] = rowsOf([px(1, 10, { ...BUY_ONLY, ...SELL_ONLY, dateModified: NOW - 60 })]);
    expect(gold.buy).not.toBeNull();
    expect(gold.sell).not.toBeNull();
    expect(defaultSide(gold, 'buy')).toBe('buy');
    expect(defaultSide(gold, 'sell')).toBe('sell');
  });

  it('follows my own diary as well as UEX', () => {
    const [gold] = rowsOf([], [obs({ id: 1, ts: NOW - 60, terminalId: 1, commodityId: 10, side: 'sell', price: 7000 })]);
    expect(defaultSide(gold, 'buy')).toBe('sell');
  });

  it('is the side of the tab for a commodity the terminal does not trade at all: on «Продать» a new price is a price of a sale', () => {
    expect(defaultSide(undefined, 'sell')).toBe('sell');
    expect(defaultSide({ buy: null, sell: null }, 'sell')).toBe('sell');
    expect(defaultSide(undefined, 'buy')).toBe('buy');
    expect(defaultSide({ buy: null, sell: null }, 'buy')).toBe('buy');
  });

  it('is the side of the tab while no commodity is chosen (no row): the empty line of the quick entry shows the tab it was opened on', () => {
    expect(defaultSide(undefined, 'sell')).toBe('sell');
    expect(defaultSide(undefined, 'buy')).toBe('buy');
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

describe('rejectionText: the reason a quick entry says when it refuses', () => {
  it('says what to do in a few words, for each of the four reasons', () => {
    expect(rejectionText('no-commodity')).toBe('Выбери товар');
    expect(rejectionText('bad-price')).toBe('Цена — целое число больше нуля');
    expect(rejectionText('bad-scu')).toBe('Количество — целое число от нуля');
    expect(rejectionText('no-terminal')).toBe('Сначала выбери локацию в шапке окна');
  });

  it('has a sentence for every reason there is, and speaks to the player as «ты»', () => {
    for (const reason of REJECTIONS) {
      expect(rejectionText(reason), reason).not.toBe('');
      expect(rejectionText(reason), reason).not.toMatch(/(ите|йте|ьте)(?![а-яё])/);
    }
  });

  it('is what the quantity check allows: a quantity from zero is no refusal, a negative one is', () => {
    expect(resolveQuickEntry('6120', '0').ok).toBe(true);
    expect(resolveQuickEntry('6120', '-1')).toEqual({ ok: false, price: false, scu: true });
  });
});
