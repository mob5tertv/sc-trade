import { describe, expect, it } from 'vitest';
import { allowedSide, entryCommodities, entrySides } from '../../src/ui/vm/quick-entry';

// The author's decision of 13.10.2026: the quick entry must not write any commodity to a station that does not trade it. Three
// test prices typed in while another place was meant had landed at the viewed station as goods of its own.
const all = [{ id: 10, code: 'GOLD' }, { id: 20, code: 'TITA' }, { id: 51, code: 'STIM' }];
const cell = {} as never;   // a cell is only asked whether it is there

describe('entryCommodities', () => {
  it('offers only the commodities that stand in the table of the terminal', () => {
    expect(entryCommodities(all, [{ commodityId: 10 }, { commodityId: 20 }]).map((c) => c.code)).toEqual(['GOLD', 'TITA']);
    expect(entryCommodities(all, [{ commodityId: 51 }]).map((c) => c.code)).toEqual(['STIM']);
  });

  it('offers every commodity only where the table is empty: a station nobody has a price of yet', () => {
    expect(entryCommodities(all, [])).toEqual(all);
  });
});

describe('entrySides and allowedSide', () => {
  it('lets a price be written only to a side the terminal trades the commodity on', () => {
    const soldOnly = entrySides({ buy: cell, sell: null });
    expect(soldOnly).toEqual({ buy: true, sell: false });
    expect(allowedSide('sell', soldOnly)).toBe('buy');      // the side that was asked is not traded: the other one
    expect(allowedSide('buy', soldOnly)).toBe('buy');
    const boughtOnly = entrySides({ buy: null, sell: cell });
    expect(allowedSide('buy', boughtOnly)).toBe('sell');
  });

  it('limits nothing where the terminal trades it both ways, and where there is no row to ask', () => {
    const both = entrySides({ buy: cell, sell: cell });
    expect(allowedSide('buy', both)).toBe('buy');
    expect(allowedSide('sell', both)).toBe('sell');
    expect(entrySides(undefined)).toBeNull();
    expect(allowedSide('sell', null)).toBe('sell');
  });
});
