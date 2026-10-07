import { describe, expect, it } from 'vitest';
import { defaultTerminalSide, resolveTerminalSide, selectedCommodity } from '../../src/ui/vm/terminal-side';
import { sideRow } from '../helpers/window-layout-fixtures';

describe('resolveTerminalSide', () => {
  it('keeps the side the player asked for while it has rows', () => {
    expect(resolveTerminalSide('buy', { buy: 7, sell: 23 })).toBe('buy');
    expect(resolveTerminalSide('sell', { buy: 7, sell: 23 })).toBe('sell');
    expect(resolveTerminalSide('sell', { buy: 0, sell: 1 })).toBe('sell');
  });

  it('moves to the other side when the asked one is empty and the other is not', () => {
    expect(resolveTerminalSide('buy', { buy: 0, sell: 4 })).toBe('sell');
    expect(resolveTerminalSide('sell', { buy: 9, sell: 0 })).toBe('buy');
  });

  it('stays where it was when neither side has rows (the table says so itself)', () => {
    expect(resolveTerminalSide('buy', { buy: 0, sell: 0 })).toBe('buy');
    expect(resolveTerminalSide('sell', { buy: 0, sell: 0 })).toBe('sell');
  });
});

describe('defaultTerminalSide', () => {
  it('is "buy" when the terminal has both sides', () => {
    expect(defaultTerminalSide([sideRow(1, { buy: true }), sideRow(2, { sell: true })])).toBe('buy');
    expect(defaultTerminalSide([sideRow(1, { buy: true, sell: true })])).toBe('buy');
  });

  it('is the side that has rows when only one has', () => {
    expect(defaultTerminalSide([sideRow(1, { sell: true }), sideRow(2, { sell: true })])).toBe('sell');
    expect(defaultTerminalSide([sideRow(1, { buy: true })])).toBe('buy');
  });

  it('is "buy" for a terminal nothing is known about', () => {
    expect(defaultTerminalSide([])).toBe('buy');
  });
});

describe('selectedCommodity', () => {
  const rows = [sideRow(1, { buy: true }), sideRow(2, { buy: true, sell: true }), sideRow(3, { sell: true })];
  const picked = { terminalId: 5, side: 'buy' as const, commodityId: 2 };

  it('is the picked commodity while terminal, side and row are the ones it was picked on', () => {
    expect(selectedCommodity(picked, 5, 'buy', rows)).toBe(2);
    expect(selectedCommodity({ ...picked, side: 'sell' }, 5, 'sell', rows)).toBe(2);
  });

  it('is nothing before anything was picked', () => {
    expect(selectedCommodity(null, 5, 'buy', rows)).toBeNull();
  });

  it('goes away with a change of the side: the row of the other side is not the same row', () => {
    expect(selectedCommodity(picked, 5, 'sell', rows)).toBeNull();
  });

  it('goes away with a change of the terminal, and comes back with no terminal at all', () => {
    expect(selectedCommodity(picked, 6, 'buy', rows)).toBeNull();
    expect(selectedCommodity(picked, null, 'buy', rows)).toBeNull();
  });

  it('is nothing when the shown side has no cell for the commodity, or the row is gone', () => {
    expect(selectedCommodity({ ...picked, commodityId: 3 }, 5, 'buy', rows)).toBeNull();
    expect(selectedCommodity({ ...picked, side: 'sell', commodityId: 1 }, 5, 'sell', rows)).toBeNull();
    expect(selectedCommodity({ ...picked, commodityId: 99 }, 5, 'buy', rows)).toBeNull();
  });
});
