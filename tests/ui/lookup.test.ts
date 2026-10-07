import { describe, expect, it } from 'vitest';
import { formatUec } from '../../src/core/format';
import { kindForSide, lookupEmptyText, lookupTarget, lookupTitle, terminalLabel } from '../../src/ui/vm/lookup';
import type { LookupRequest } from '../../src/ui/vm/lookup';
import { ref } from '../helpers/factories';

const request = (partial: Partial<LookupRequest> = {}): LookupRequest => (
  { kind: 'from', terminalId: 1, commodityId: null, price: null, ...partial }
);

describe('kindForSide', () => {
  it('looks for a buyer of what I buy and for a seller of what I sell', () => {
    expect(kindForSide('buy')).toBe('from');   // a buy price → "Где продать" → trips from this terminal
    expect(kindForSide('sell')).toBe('to');    // a sell price → "Где купить" → trips to this terminal
  });
});

describe('terminalLabel', () => {
  it('is the nickname players know a terminal by', () => {
    expect(terminalLabel(ref, 1)).toBe('ARC-L1');
    expect(terminalLabel(ref, 2)).toBe('TDD Area 18');
  });

  it('shows the id of a terminal that left the reference', () => {
    expect(terminalLabel(ref, 777)).toBe('#777');
  });
});

describe('lookupTitle', () => {
  it('names the commodity, the terminal and the sell price that started a "where to buy"', () => {
    const title = lookupTitle(request({ kind: 'to', terminalId: 2, commodityId: 10, price: 5088 }), ref);
    expect(title).toBe(`Где купить Gold для TDD Area 18 · продажа ${formatUec(5088)}`);
    expect(title).toBe('Где купить Gold для TDD Area 18 · продажа 5 088');
  });

  it('names the commodity and the terminal of a "where to sell", with the buy price when there is one', () => {
    expect(lookupTitle(request({ kind: 'from', terminalId: 1, commodityId: 10 }), ref)).toBe('Куда везти Gold с ARC-L1');
    expect(lookupTitle(request({ kind: 'from', terminalId: 1, commodityId: 10, price: 6120 }), ref))
      .toBe('Куда везти Gold с ARC-L1 · покупка 6 120');
  });

  it('is about the whole terminal when no commodity is chosen', () => {
    expect(lookupTitle(request({ kind: 'from', terminalId: 1 }), ref)).toBe('Куда везти с ARC-L1');
    expect(lookupTitle(request({ kind: 'to', terminalId: 3 }), ref)).toBe('Где купить для CRU-L1');
  });

  it('survives a terminal and a commodity that left the reference', () => {
    expect(lookupTitle(request({ kind: 'to', terminalId: 777, commodityId: 999, price: 10 }), ref))
      .toBe('Где купить #999 для #777 · продажа 10');
  });
});

describe('lookupEmptyText', () => {
  it('says what was not found, with the commodity when one was asked for', () => {
    expect(lookupEmptyText(request({ commodityId: 10 }), ref)).toBe('Выгодных вариантов для Gold не нашлось.');
    expect(lookupEmptyText(request(), ref)).toBe('Выгодных маршрутов не нашлось.');
  });

  it('survives a commodity that left the reference', () => {
    expect(lookupEmptyText(request({ commodityId: 999 }), ref)).toBe('Выгодных вариантов для #999 не нашлось.');
  });
});

describe('lookupTarget', () => {
  it('is the other end of the trip: the destination for trips from here, the origin for trips to here', () => {
    expect(lookupTarget({ originId: 1, destId: 2 }, 'from')).toBe(2);
    expect(lookupTarget({ originId: 1, destId: 2 }, 'to')).toBe(1);
  });
});
