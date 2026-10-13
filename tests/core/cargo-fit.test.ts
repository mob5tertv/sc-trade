import { describe, expect, it } from 'vitest';
import { boxAdvice, boxLine, loadingBar } from '../../src/core/cargo-fit';

// Spec 14.19, item 10. One short line before a purchase: «Ящики: любые» when every box the terminal sells fits the ship,
// «Ящики: до N SCU» when the ship takes smaller ones only (N is what the player sets at the kiosk), nothing when either is
// unknown. And a ship that is loaded at an external loading dock needs a terminal that has one.
describe('boxAdvice', () => {
  const ship = (containerScu?: number[]) => ({ containerScu });
  const terminal = (maxContainerScu?: number | null) => ({ maxContainerScu });

  it('says any box when the largest one the terminal sells is not larger than the largest the ship takes', () => {
    expect(boxAdvice(terminal(32), ship([1, 2, 4, 8, 16, 24, 32]))).toEqual({ kind: 'any' });
    expect(boxAdvice(terminal(8), ship([1, 2, 4, 8, 16]))).toEqual({ kind: 'any' });
  });

  it('says the largest box the ship takes when the terminal sells larger ones', () => {
    expect(boxAdvice(terminal(32), ship([1, 2, 4, 8]))).toEqual({ kind: 'upTo', scu: 8 });
    expect(boxAdvice(terminal(32), ship([2, 1]))).toEqual({ kind: 'upTo', scu: 2 });      // the order of the sizes does not matter
  });

  it('says nothing when the sizes of the ship or of the terminal are not known', () => {
    expect(boxAdvice(terminal(32), ship([]))).toBeNull();
    expect(boxAdvice(terminal(32), ship())).toBeNull();
    expect(boxAdvice(terminal(null), ship([1, 2]))).toBeNull();
    expect(boxAdvice(terminal(), ship([1, 2]))).toBeNull();
    expect(boxAdvice(terminal(0), ship([1, 2]))).toBeNull();
    expect(boxAdvice(undefined, ship([1, 2]))).toBeNull();
    expect(boxAdvice(terminal(32), undefined)).toBeNull();
  });

  it('is written as one short line', () => {
    expect(boxLine({ kind: 'any' })).toBe('Ящики: любые');
    expect(boxLine({ kind: 'upTo', scu: 8 })).toBe('Ящики: до 8 SCU');
    expect(boxLine(null)).toBeNull();
  });
});

describe('loadingBar', () => {
  const hull = { isLoadingDock: true };
  it('refuses a ship that is loaded at a loading dock where there is none', () => {
    expect(loadingBar({ hasLoadingDock: false }, hull)).toBe('нет грузового дока');
    expect(loadingBar({ hasLoadingDock: true }, hull)).toBeNull();
  });

  it('never refuses a ship that needs no dock, a ship UEX does not describe, or a terminal that is not there', () => {
    expect(loadingBar({ hasLoadingDock: false }, { isLoadingDock: false })).toBeNull();
    expect(loadingBar({ hasLoadingDock: false }, {})).toBeNull();
    expect(loadingBar({ hasLoadingDock: false }, undefined)).toBeNull();
    expect(loadingBar(undefined, hull)).toBeNull();
  });
});
