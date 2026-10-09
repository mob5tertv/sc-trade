import { describe, expect, it } from 'vitest';
import { formatUec } from '../../src/core/format';
import { DEFAULT_SETTINGS } from '../../src/core/settings';
import type { Reference } from '../../src/core/types';
import { affectsLookup, kindForSide, lookupEmptyText, lookupPrice, lookupTarget, lookupTitle, sameRequest } from '../../src/ui/vm/lookup';
import type { LookupRequest } from '../../src/ui/vm/lookup';
import { terminalRows } from '../../src/ui/vm/terminal-rows';
import { buildMarket } from '../../src/core/market';
import { obs, px, ref, term } from '../helpers/factories';
import { NOW, ctx } from '../helpers/terminal-fixtures';

const request = (partial: Partial<LookupRequest> = {}): LookupRequest => (
  { kind: 'from', terminalId: 1, commodityId: null, price: null, ...partial }
);

describe('kindForSide', () => {
  it('looks for a buyer of what I buy and for a seller of what I sell', () => {
    expect(kindForSide('buy')).toBe('from');   // a buy price → "Где продать" → trips from this terminal
    expect(kindForSide('sell')).toBe('to');    // a sell price → "Где купить" → trips to this terminal
  });
});

describe('sameRequest', () => {
  it('is true for a request that asks the same thing', () => {
    expect(sameRequest(request({ commodityId: 10, price: 5088 }), request({ commodityId: 10, price: 5088 }))).toBe(true);
  });

  it('is false when the kind, the terminal, the commodity or the price differ, and when nothing was asked before', () => {
    expect(sameRequest(request(), request({ kind: 'to' }))).toBe(false);
    expect(sameRequest(request(), request({ terminalId: 2 }))).toBe(false);
    expect(sameRequest(request(), request({ commodityId: 10 }))).toBe(false);
    expect(sameRequest(request({ price: 1 }), request({ price: 2 }))).toBe(false);
    expect(sameRequest(null, request())).toBe(false);
  });
});

describe('lookupTitle', () => {
  it('names the commodity, the terminal and the sell price that started a "where to buy"', () => {
    const title = lookupTitle(request({ kind: 'to', terminalId: 2, commodityId: 10, price: 5088 }), ref, false);
    expect(title).toBe(`Где купить Gold для TDD Area 18 · продажа ${formatUec(5088)}`);
    expect(title).toBe('Где купить Gold для TDD Area 18 · продажа 5 088');
  });

  it('names the commodity and the terminal of a "where to sell", with the buy price when there is one', () => {
    expect(lookupTitle(request({ kind: 'from', terminalId: 1, commodityId: 10 }), ref, false)).toBe('Куда везти Gold с ARC-L1');
    expect(lookupTitle(request({ kind: 'from', terminalId: 1, commodityId: 10, price: 6120 }), ref, false))
      .toBe('Куда везти Gold с ARC-L1 · покупка 6 120');
  });

  it('is about the whole terminal when no commodity is chosen', () => {
    expect(lookupTitle(request({ kind: 'from', terminalId: 1 }), ref, false)).toBe('Куда везти с ARC-L1');
    expect(lookupTitle(request({ kind: 'to', terminalId: 3 }), ref, false)).toBe('Где купить для CRU-L1');
  });

  it('survives a terminal and a commodity that left the reference', () => {
    expect(lookupTitle(request({ kind: 'to', terminalId: 777, commodityId: 999, price: 10 }), ref, false))
      .toBe('Где купить #999 для #777 · продажа 10');
  });

  describe('with "искать и рядом"', () => {
    const noPlanet: Reference = { ...ref, terminals: new Map([...ref.terminals, [7, term(7, { nickname: 'Deep Space', planetId: 0 })]]) };

    it('says the trips may also start at the other terminals of the planet, so the player is not told to load at the wrong place', () => {
      expect(lookupTitle(request({ kind: 'from', terminalId: 1, commodityId: 10 }), ref, true)).toBe('Куда везти Gold с ARC-L1 и рядом');
      expect(lookupTitle(request({ kind: 'from', terminalId: 1 }), ref, true)).toBe('Куда везти с ARC-L1 и рядом');
      expect(lookupTitle(request({ kind: 'from', terminalId: 1, commodityId: 10, price: 6120 }), ref, true))
        .toBe('Куда везти Gold с ARC-L1 и рядом · покупка 6 120');
    });

    it('says nothing for "where to buy": every terminal is searched there anyway', () => {
      expect(lookupTitle(request({ kind: 'to', terminalId: 2, commodityId: 10, price: 5088 }), ref, true))
        .toBe('Где купить Gold для TDD Area 18 · продажа 5 088');
    });

    it('says nothing where the setting does nothing: a terminal with no planet, or one that left the reference', () => {
      expect(lookupTitle(request({ kind: 'from', terminalId: 7 }), noPlanet, true)).toBe('Куда везти с Deep Space');
      expect(lookupTitle(request({ kind: 'from', terminalId: 777 }), ref, true)).toBe('Куда везти с #777');
    });
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

describe('lookupPrice', () => {
  // terminal 1: Gold has my buy 6120 from two minutes ago and a UEX buy row; Tungsten only a UEX buy row (3980); Titanium my sell only
  const market = buildMarket(
    [
      px(1, 10, { buy: { avgWeek: 6000, minWeek: 5900, maxWeek: 6200 }, dateModified: NOW - 3600 }),
      px(1, 30, { buy: { avgWeek: 3980, minWeek: 3980, maxWeek: 3980 }, dateModified: NOW - 3600 }),
    ],
    [
      obs({ id: 1, ts: NOW - 120, terminalId: 1, commodityId: 10, side: 'buy', price: 6120 }),
      obs({ id: 2, ts: NOW - 120, terminalId: 1, commodityId: 20, side: 'sell', price: 1500 }),
    ],
  );
  const rows = terminalRows(market, ref, 1, ctx);
  const rowOf = (commodityId: number) => rows.find((row) => row.commodityId === commodityId);

  it('is my own price when I have one', () => {
    expect(lookupPrice(rowOf(10), 'buy')).toBe(6120);
    expect(lookupPrice(rowOf(20), 'sell')).toBe(1500);
  });

  it('is the UEX hint when the cell holds only that', () => {
    expect(lookupPrice(rowOf(30), 'buy')).toBe(3980);
  });

  it('is nothing for a side the terminal has no price on, and for a row that is not there', () => {
    expect(lookupPrice(rowOf(10), 'sell')).toBeNull();
    expect(lookupPrice(undefined, 'buy')).toBeNull();
  });
});

describe('affectsLookup', () => {
  it('is true for every setting the suggestions read', () => {
    const read = [
      'scuCapacity', 'budget', 'starSystemId', 'topN', 'sort',
      'quantumSpeedKkms', 'overheadMin', 'overheadEmptyMin',
      'hotMin', 'warmMin', 'coolingMin', 'refillFullMin', 'serverChangedAt',
    ] as const;
    for (const key of read) {
      expect(affectsLookup(key, 'from'), `${key} / from`).toBe(true);
      expect(affectsLookup(key, 'to'), `${key} / to`).toBe(true);
    }
  });

  it('is false for the settings that only look or bind keys', () => {
    const unrelated = [
      'vehicleId', 'hotkeyPanel', 'hotkeyDepart', 'hotkeyArrive', 'panelWidth', 'stripCorner',
      'opacity', 'showStrip', 'logLevel', 'currentTerminalId', 'targetTerminalId',
      'idleCollapseSec', 'openSections', 'windowDx', 'windowDy', 'windowLocked', 'roiHighlightPct',
    ] as const;
    for (const key of unrelated) expect(affectsLookup(key, 'from'), key).toBe(false);
  });

  it('follows "искать и рядом" only where it is used: trips from a terminal, not trips to it', () => {
    expect(affectsLookup('nearby', 'from')).toBe(true);
    expect(affectsLookup('nearby', 'to')).toBe(false);
  });

  it('has an answer for every setting there is', () => {
    for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof typeof DEFAULT_SETTINGS>) {
      expect(typeof affectsLookup(key, 'from'), key).toBe('boolean');
    }
  });
});
