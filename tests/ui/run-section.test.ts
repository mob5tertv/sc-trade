import { describe, expect, it } from 'vitest';
import { distKey } from '../../src/core/types';
import {
  cargoRows, decisionAtClock, planSummary, runHeader, runSectionKind, sellDecisionKey, sellDecisions, sellLogContext, targetOffer,
} from '../../src/ui/vm/run-section';
import { sameRun } from '../../src/ui/vm/same-run';
import { stripModel } from '../../src/ui/vm/strip';
import { buildMarket } from '../../src/core/market';
import { ev, obs, ref } from '../helpers/factories';
import { active, ctx, GOLD, market, mixedRun, NOW, s, TITA, withOwnSell } from '../helpers/strip-fixtures';

// prices are formatted with a non-breaking space as the thousands separator
const NBSP = String.fromCharCode(0xa0);

const model = (a: typeof active | null, settings = s, c = ctx) => stripModel(a, market, ref, settings, c);

describe('runSectionKind', () => {
  it('is the run while one goes on, whatever the target is', () => {
    expect(runSectionKind(model(active))).toBe('run');
    expect(runSectionKind(model(active, { ...s, targetTerminalId: 2 }))).toBe('run');
  });
  it('is the plan with a target and no run', () => {
    expect(runSectionKind(model(null, { ...s, targetTerminalId: 2 }))).toBe('plan');
  });
  it('is not there without a run and a target, or with a target the reference does not know', () => {
    expect(runSectionKind(model(null))).toBeNull();
    expect(runSectionKind(model(null, { ...s, targetTerminalId: 777 }))).toBeNull();
  });
});

describe('runHeader', () => {
  const header = (a: typeof active, settings = s) => {
    const m = model(a, settings);
    if (m.kind !== 'run') throw new Error('a run was expected');
    return runHeader(m);
  };

  it('starts with the phase and its own timer, then the cargo; the target stands apart, and is always there', () => {
    expect(header(active, { ...s, targetTerminalId: 2 })).toMatchObject({
      summary: `Погрузка 14:32 · GOLD 96 SCU по 6${NBSP}120`, target: '→ TDD Area 18',
    });
    expect(header(active)).toMatchObject({ summary: `Погрузка 14:32 · GOLD 96 SCU по 6${NBSP}120`, target: 'цель не выбрана' });
  });
  it('says the cargo in the words of the mini line, with what it was bought for', () => {
    const mixed = model(mixedRun);
    if (mixed.kind !== 'run') throw new Error('a run was expected');
    expect(runHeader(mixed).summary).toBe(`Погрузка 14:32 · ${mixed.cargo}`);
    expect(mixed.cargo).toBe(`GOLD 96 по 6${NBSP}120, TITA 40 по 2${NBSP}500`);
  });
  it('names the phase that is running, with the whole run in the tooltip', () => {
    // the first purchase was 872 s ago, the take-off 300 s ago
    const inFlight = { run: active.run, events: [...active.events, ev({ id: 9, runId: 1, ts: NOW - 300, type: 'depart' })] };
    expect(header(inFlight)).toMatchObject({ summary: `Полёт 5:00 · GOLD 96 SCU по 6${NBSP}120` });
    expect(header(inFlight).title).toBe(`Полёт 5:00 · GOLD 96 SCU по 6${NBSP}120 · цель не выбрана · всего 14:32`);
  });
  it('words the plan: the target and nothing else', () => {
    expect(planSummary('ARC-L1')).toBe('цель: ARC-L1');
  });
});

describe('targetOffer (task 44)', () => {
  // the run of `strip-fixtures` bought at terminal 1 (ARC-L1); terminal 2 is TDD Area 18, 3 is CRU-L1
  it('offers the viewed terminal as the target while a run goes on without one and the terminal is not where it was loaded', () => {
    expect(targetOffer(active, null, 2, ref)).toEqual({
      terminalId: 2, label: 'Цель: TDD Area 18', title: 'Сделать целью рейса: TDD Area 18',
    });
    expect(targetOffer(mixedRun, null, 3, ref)).toMatchObject({ terminalId: 3, label: 'Цель: CRU-L1' });
  });

  it('offers nothing at the terminal of the first purchase: the run does not fly there', () => {
    expect(targetOffer(active, null, 1, ref)).toBeNull();
  });

  it('offers nothing when a target is set: the section shows it, with its cross', () => {
    expect(targetOffer(active, 3, 2, ref)).toBeNull();
    expect(targetOffer(active, 2, 2, ref)).toBeNull();
  });

  it('offers nothing without a run (the plan with a target, or no run at all)', () => {
    expect(targetOffer(null, null, 2, ref)).toBeNull();
  });

  it('offers nothing when no terminal is viewed, or the reference does not know the one that is', () => {
    expect(targetOffer(active, null, null, ref)).toBeNull();
    expect(targetOffer(active, null, 777, ref)).toBeNull();
  });

  it('judges "where it was loaded" by the first purchase in time, whatever order the events come in', () => {
    const late = ev({ id: 2, runId: 1, ts: NOW - 100, type: 'buy', terminalId: 2, commodityId: GOLD, scu: 10, price: 6000 });
    const first = ev({ id: 1, runId: 1, ts: NOW - 872, type: 'buy', terminalId: 1, commodityId: GOLD, scu: 10, price: 6000 });
    const run = { run: active.run, events: [late, first] };
    expect(targetOffer(run, null, 1, ref)).toBeNull();
    expect(targetOffer(run, null, 2, ref)).toMatchObject({ terminalId: 2 });
  });

  it('names the terminal as the line of the strip does: the nickname, else the display name, else the name', () => {
    const named = (nickname: string, displayname: string, name: string) => {
      const terminal = { ...ref.terminals.get(2)!, nickname, displayname, name };
      return targetOffer(active, null, 2, { ...ref, terminals: new Map([...ref.terminals, [2, terminal]]) })?.label;
    };
    expect(named('TDD', 'TDD Area 18', 'Trade and Development Division')).toBe('Цель: TDD');
    expect(named('', 'TDD Area 18', 'Trade and Development Division')).toBe('Цель: TDD Area 18');
    expect(named('', '', 'Trade and Development Division')).toBe('Цель: Trade and Development Division');
  });

  it('offers a terminal when the first purchase has no terminal of its own (nothing says the run is already there)', () => {
    const nowhere = { run: active.run, events: active.events.map((e) => ({ ...e, terminalId: null })) };
    expect(targetOffer(nowhere, null, 2, ref)).toMatchObject({ terminalId: 2 });
  });
});

describe('cargoRows', () => {
  it('lists the hold by code with what is left and the average price', () => {
    expect(cargoRows(mixedRun.events, ref)).toEqual([
      { commodityId: 10, code: 'GOLD', scu: 96, avgBuyPrice: 6120 }, { commodityId: TITA, code: 'TITA', scu: 40, avgBuyPrice: 2500 },
    ]);
  });
  it('is empty for an empty hold, and names a commodity that left the reference by its number', () => {
    expect(cargoRows([], ref)).toEqual([]);
    const odd = [ev({ id: 3, runId: 1, ts: NOW - 800, type: 'buy', terminalId: 1, commodityId: 99, scu: 5, price: 100 })];
    expect(cargoRows(odd, ref)).toEqual([{ commodityId: 99, code: '#99', scu: 5, avgBuyPrice: 100 }]);
  });
});

describe('sellDecisions', () => {
  /** Distances: 1–2 as in the fixtures, and 3–2 so that the flight from terminal 3 is known. */
  const here = { ...ctx, distances: new Map<string, number | null>([[distKey(1, 2), 59], [distKey(3, 2), 10]]) };
  const atThree = withOwnSell(market, 3, GOLD, 6840, NOW - 60);

  it('offers the choice where I have a fresh sale price of my own for a commodity of the hold', () => {
    const [d] = sellDecisions(active, atThree, ref, 3, here);
    expect(d).toMatchObject({ commodityId: GOLD, code: 'GOLD', terminalId: 3, actualPrice: 6840 });
    expect(d.here).toMatchObject({ qty: 96, profit: 96 * (6840 - 6120) });
    expect(d.alternatives.map((a) => a.destId)).toEqual([2]);
    expect(d.alternatives[0].extraSec).toBe(12 * 60 + 50);
  });
  it('counts the rate of "here" over the time since the run began', () => {
    const [d] = sellDecisions(active, atThree, ref, 3, here);
    expect(d.here.uecPerHour).toBeCloseTo((96 * 720 * 3600) / 872, 5);
  });
  it('has nothing where the price is only UEX', () => {
    expect(sellDecisions(active, market, ref, 2, here)).toEqual([]);
  });
  it('has nothing where my price is cold', () => {
    expect(sellDecisions(active, withOwnSell(market, 3, GOLD, 6840, NOW - 5 * 3600), ref, 3, here)).toEqual([]);
  });
  it('has nothing for a commodity that is not on board, and only the sale side counts', () => {
    expect(sellDecisions(active, withOwnSell(market, 3, TITA, 3000, NOW - 60), ref, 3, here)).toEqual([]);
    const ownBuy = buildMarket([], [obs({ id: 1, ts: NOW - 60, terminalId: 3, commodityId: GOLD, side: 'buy', price: 6840 })]);
    expect(sellDecisions(active, ownBuy, ref, 3, here)).toEqual([]);
  });
  it('has nothing without a run or a viewed terminal', () => {
    expect(sellDecisions(null, atThree, ref, 3, here)).toEqual([]);
    expect(sellDecisions(active, atThree, ref, null, here)).toEqual([]);
  });
  it('gives one decision per commodity of the hold, in the order of the hold', () => {
    const both = withOwnSell(atThree, 3, TITA, 3000, NOW - 60);
    expect(sellDecisions(mixedRun, both, ref, 3, here).map((d) => d.code)).toEqual(['GOLD', 'TITA']);
  });
  it('does not let the inventory recorded at the place limit the sale', () => {
    const [empty] = sellDecisions(active, withOwnSell(market, 3, GOLD, 6840, NOW - 60, 0), ref, 3, here);
    expect(empty.here.qty).toBe(96);
  });
});

describe('decisionAtClock', () => {
  const here = { ...ctx, distances: new Map<string, number | null>([[distKey(1, 2), 59], [distKey(3, 2), 10]]) };
  const [d] = sellDecisions(active, withOwnSell(market, 3, GOLD, 6840, NOW - 60), ref, 3, here);

  it('is what the core said at the moment it was counted', () => {
    const same = decisionAtClock(d, d.elapsedSec);
    expect(same.here).toEqual(d.here);
    expect(same.alternatives).toEqual(d.alternatives);
  });
  it('moves the rate of selling here with the time since the run began and nothing else', () => {
    const later = decisionAtClock(d, d.elapsedSec + 600);
    expect(later.elapsedSec).toBe(d.elapsedSec + 600);
    expect(later.here.uecPerHour).toBeCloseTo((d.here.profit * 3600) / (d.elapsedSec + 600), 6);
    expect(later.here.profit).toBe(d.here.profit);
    // what flying on adds, and over what time, does not depend on the time already spent (spec 14.19)
    expect(later.alternatives).toBe(d.alternatives);
  });
  it('agrees with a calculation made at that moment (the same numbers the core gives)', () => {
    const [recounted] = sellDecisions(active, withOwnSell(market, 3, GOLD, 6840, NOW - 60), ref, 3, { ...here, now: ctx.now + 600 });
    const moved = decisionAtClock(d, recounted.elapsedSec);
    expect(moved.here.uecPerHour).toBeCloseTo(recounted.here.uecPerHour ?? NaN, 6);
    expect(moved.alternatives[0].extraUecPerHour).toBeCloseTo(recounted.alternatives[0].extraUecPerHour ?? NaN, 6);
  });
  it('keeps an unknown flight time unknown and a moment without time without a rate', () => {
    const lonely = sellDecisions(active, withOwnSell(market, 3, GOLD, 6840, NOW - 60), ref, 3, { ...here, distances: new Map() })[0];
    expect(lonely.alternatives[0]).toMatchObject({ extraSec: null, extraSource: null, extraUecPerHour: null });
    expect(decisionAtClock(d, 0).here.uecPerHour).toBeNull();
  });
});

describe('sameRun', () => {
  const copy = <T,>(x: T): T => structuredClone(x);

  it('is the same for a run read again that did not change, and for two nothings', () => {
    expect(sameRun(copy(active), active)).toBe(true);
    expect(sameRun(null, null)).toBe(true);
  });
  it('differs for a run and nothing', () => {
    expect(sameRun(active, null)).toBe(false);
    expect(sameRun(null, active)).toBe(false);
  });
  it('differs when an event was added, or the run was closed', () => {
    const more = { run: active.run, events: [...active.events, ev({ id: 9, runId: 1, ts: NOW, type: 'depart' })] };
    expect(sameRun(more, active)).toBe(false);
    expect(sameRun({ run: { ...active.run, status: 'lost', endedAt: NOW }, events: active.events }, active)).toBe(false);
  });
  it('differs for another run', () => {
    expect(sameRun({ run: { ...active.run, id: 2 }, events: active.events }, active)).toBe(false);
  });
  it('differs when a trade was corrected: the same events by their ids, another quantity or price', () => {
    const trade = active.events.findIndex(e => e.type === 'buy');
    const corrected = (change: { scu?: number; price?: number }) => ({
      run: active.run, events: active.events.map((e, i) => (i === trade ? { ...e, ...change } : e)),
    });
    expect(sameRun(corrected({ price: active.events[trade].price! + 1 }), active)).toBe(false);
    expect(sameRun(corrected({ scu: active.events[trade].scu! - 1 }), active)).toBe(false);
    expect(sameRun(corrected({}), active)).toBe(true);
  });
});

describe('sellLogContext and sellDecisionKey', () => {
  const here = { ...ctx, distances: new Map<string, number | null>([[distKey(3, 2), 10]]) };
  const [d] = sellDecisions(active, withOwnSell(market, 3, GOLD, 6840, NOW - 60), ref, 3, here);

  it('lists every compared option with its price, source, time and rate', () => {
    const log = sellLogContext(d);
    expect(log).toMatchObject({ terminalId: 3, commodityId: GOLD, scu: 96, avgBuyPrice: 6120, price: 6840, elapsedSec: 872 });
    expect(log.here).toMatchObject({ profit: 69_120, roi: 720 / 6120 });
    expect(log.alternatives).toEqual([{
      terminalId: 2, price: 6900, low: 6400, high: 7100, source: 'uex', extraSec: 770, extraSource: 'estimate',
      profit: 74_880, extraProfit: 5760, extraProfitLow: -42_240, extraUecPerHour: (5760 * 3600) / 770,
    }]);
  });
  it('is the same key while the same thing is decided, and another one when the price or the cargo changes', () => {
    const again = sellDecisions(active, withOwnSell(market, 3, GOLD, 6840, NOW - 60), ref, 3, { ...here, now: NOW + 5 });
    expect(sellDecisionKey(again)).toBe(sellDecisionKey([d]));
    const cheaper = sellDecisions(active, withOwnSell(market, 3, GOLD, 6800, NOW - 60), ref, 3, here);
    expect(sellDecisionKey(cheaper)).not.toBe(sellDecisionKey([d]));
    expect(sellDecisionKey([])).toBe('');
  });
});
