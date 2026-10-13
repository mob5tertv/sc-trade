import { describe, expect, it } from 'vitest';
import { sellOrContinue } from '../../src/core/sell';
import { distKey } from '../../src/core/types';
import { worsePrice, worsePriceText } from '../../src/ui/vm/worse-price';
import { ref } from '../helpers/factories';
import { withSell } from '../helpers/route-fixtures';
import { line, sellCtx as ctx, sellMarket as market } from '../helpers/run-fixtures';

// Spec 14.19, item 8. Cargo: Gold 340 SCU. The player stands at C (3) and types in what it really pays. B (2) pays UEX 6900,
// 10 Gm away (770 s by the distance).
const nb = (text: string): string => text.replace(/ /g, String.fromCharCode(0xa0));
const alternativesAt = (actual: number, m = market, c = ctx) => sellOrContinue(m, line, 3, actual, 1200, c).alternatives;

describe('worsePrice', () => {
  it('speaks when the price typed in is below the expected one by the threshold, and names the best other place', () => {
    const w = worsePrice(7000, 5900, 15, alternativesAt(5900))!;            // 15.7 % below
    expect(w.pct).toBe(16);
    expect(w.best).toMatchObject({ destId: 2, extraProfit: 340 * (6900 - 5900) });
  });

  it('is silent below the threshold: the player often sells cheaper and never minds', () => {
    expect(worsePrice(7000, 6000, 15, alternativesAt(6000))).toBeNull();    // 14.3 %
    expect(worsePrice(7000, 5950, 15, alternativesAt(5950))).not.toBeNull(); // exactly 15 %
    expect(worsePrice(7000, 7200, 15, alternativesAt(7200))).toBeNull();    // it pays MORE than expected
  });

  it('is silent when no other place would pay more for this cargo, however bad the price is', () => {
    const none = withSell(market, 2, 5000);                                 // the only other buyer pays less than here
    expect(worsePrice(7000, 5500, 15, alternativesAt(5500, none))).toBeNull();
    expect(worsePrice(7000, 5500, 15, [])).toBeNull();
  });

  it('is silent when nothing was expected, and when the notice is switched off', () => {
    expect(worsePrice(null, 5900, 15, alternativesAt(5900))).toBeNull();
    expect(worsePrice(0, 5900, 15, alternativesAt(5900))).toBeNull();
    expect(worsePrice(7000, 5900, 0, alternativesAt(5900))).toBeNull();
  });

  it('takes the place that is worth the flight most, not one that pays less than here', () => {
    // A (1) pays 5000, less than the 5900 typed in; it is no better place, whatever its distance
    const two = withSell(market, 1, 5000);
    const far = { ...ctx, distances: new Map([...ctx.distances, [distKey(3, 1), 1]]) };
    expect(worsePrice(7000, 5900, 15, alternativesAt(5900, two, far))!.best.destId).toBe(2);
  });
});

describe('worsePriceText', () => {
  it('says by how much the price is worse, the better place, what it adds and how long the way is', () => {
    const w = worsePrice(7000, 5900, 15, alternativesAt(5900))!;
    expect(worsePriceText(w, ref)).toBe(`Цена ниже ожидаемой на 16 % · лучше: TDD Area 18, +${nb('340 000')}, ≈ 12:50`);
  });

  it('leaves the time out when it is not known, and writes my own time without the mark of an estimate', () => {
    const noTime = worsePrice(7000, 5900, 15, alternativesAt(5900, market, { ...ctx, distances: new Map() }))!;
    expect(worsePriceText(noTime, ref)).toBe(`Цена ниже ожидаемой на 16 % · лучше: TDD Area 18, +${nb('340 000')}`);
    const own = worsePrice(7000, 5900, 15, alternativesAt(5900, market, { ...ctx, ownLeg: new Map([['3>2', 400]]) }))!;
    expect(worsePriceText(own, ref)).toContain(', 6:40');
    expect(worsePriceText(own, ref)).not.toContain('≈');
  });
});
