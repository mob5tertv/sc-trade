import { describe, expect, it } from 'vitest';
import { fillHold, pairGoods } from '../../src/core/pair';
import { noGoodsText, targetGoods } from '../../src/ui/vm/target-goods';
import { ref } from '../helpers/factories';
import { ctx, market, withBuy, withSell } from '../helpers/route-fixtures';

// prices are formatted with a non-breaking space as the thousands separator
const nb = (text: string): string => text.replace(/ /g, String.fromCharCode(0xa0));

// A (1) sells Gold at my hot price 6120 (stock 340) and Titanium at UEX 2500 (stock unknown); B (2) buys them at 6900 and 3000.
const TITA = 20;
const two = withSell(withBuy(market, 1, { last: 2500, avgWeek: 2500, minWeek: 2500, maxWeek: 2500 }, TITA), 2, 3000, TITA);
const view = (m: typeof market, freeScu: number, budget: number | null = null, aboard = false) => {
  const goods = pairGoods(m, 1, 2, ctx);
  return targetGoods(goods, fillHold(goods, freeScu, budget), ref, { freeScu, aboard });
};

describe('targetGoods', () => {
  it('lists the goods of the set with how much to take of each, why that much, and what it brings', () => {
    const { rows } = view(two, 696);
    expect(rows.map((r) => [r.code, r.take, r.unsure, r.profit])).toEqual([
      ['GOLD', '340', false, nb('265 200')],
      ['TITA', '356', true, nb('178 000')],
    ]);
    expect(rows[0]).toMatchObject({ buy: { price: nb('6 120') }, sell: { price: nb('6 900') }, roi: '13%', takeTitle: 'Весь запас станции: 340 SCU' });
    expect(rows[0].buy.badge.kind).toBe('hot');
    expect(rows[1].takeTitle).toBe('Столько помещается в трюм: 356 SCU. Запас станции неизвестен: количество принято по трюму и бюджету');
  });

  it('says the set in one line: the room, the money, the profit and the ROI', () => {
    expect(view(two, 696).set).toEqual({
      caption: 'Набор на 696 SCU', filled: '696 из 696 SCU',
      invested: nb('2 970 800'), profit: `≈ ${nb('443 200')}`, roi: '15%', note: null,
    });
  });

  it('says the room is what is left when something is aboard', () => {
    expect(view(two, 400, null, true).set).toMatchObject({ caption: 'Набор на свободные 400 SCU', filled: '400 из 400 SCU' });
  });

  it('says what keeps the set from being full: the stock of the station, or the money', () => {
    expect(view(market, 696).set).toMatchObject({ filled: '340 из 696 SCU', note: 'Запаса на станции хватает на 340 из 696 SCU' });
    expect(view(market, 696, 1_000_000).set).toMatchObject({ filled: '163 из 696 SCU', note: 'Бюджета хватает на 163 из 696 SCU' });
  });

  it('keeps a commodity that did not get into the set in the list, after the set, and says why', () => {
    const { rows } = view(two, 300);
    expect(rows.map((r) => [r.code, r.take, r.profit])).toEqual([['GOLD', '300', nb('234 000')], ['TITA', '—', '—']]);
    expect(rows[1].takeTitle).toBe('В набор не вошёл: трюм заполнен товарами выгоднее');
    expect(view(two, 696, 1_000_000).rows[1].takeTitle).toBe('В набор не вошёл: не хватило бюджета');
  });

  it('has no set when nothing can be taken, and no rows when the pair has no goods', () => {
    expect(view(two, 0)).toMatchObject({ set: null });
    expect(view(two, 0).rows).toHaveLength(2);
    const none = pairGoods(market, 2, 1, ctx);
    expect(targetGoods(none, fillHold(none, 696, null), ref, { freeScu: 696, aboard: false })).toEqual({ rows: [], set: null });
    expect(noGoodsText('TDD Area 18', 'ARC-L1')).toBe('TDD Area 18 не продаёт ничего, что ARC-L1 купил бы дороже');
  });
});
