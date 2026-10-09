import { describe, expect, it } from 'vitest';
import { runOutlook } from '../../src/ui/vm/run-outlook';
import { cargoText, cargoTitle, outlookText, stripModel, stripTitle } from '../../src/ui/vm/strip';
import { currentSession, sessionFigure } from '../../src/ui/vm/stats-view';
import { distKey, pairKey } from '../../src/core/types';
import type { CargoLine, RunEvent, RunWithEvents } from '../../src/core/types';
import { ev, ref } from '../helpers/factories';
import { CLOCK, MINUTE, sessionEndedAgo } from '../helpers/indicator-fixtures';
import { active, ctx, GOLD, market, mixedRun, NOW, s, TITA, withOwnSell, withUexSell } from '../helpers/strip-fixtures';

// prices are formatted with a non-breaking space as the thousands separator
const NBSP = String.fromCharCode(0xa0);

const toTarget2 = { ...s, targetTerminalId: 2 };

/** The same run with `extra` events appended. */
const withEvents = (r: RunWithEvents, ...extra: RunEvent[]): RunWithEvents => ({ run: r.run, events: [...r.events, ...extra] });

describe('stripModel', () => {
  it('is idle without a run', () => {
    expect(stripModel(null, market, ref, { ...s, currentTerminalId: 1 }, ctx)).toEqual({ kind: 'idle', location: 'ARC-L1', target: null, session: null });
  });
  it('words an unset or unknown location', () => {
    expect(stripModel(null, market, ref, { ...s, currentTerminalId: null }, ctx)).toEqual({ kind: 'idle', location: 'Локация не выбрана', target: null, session: null });
    expect(stripModel(null, market, ref, { ...s, currentTerminalId: 777 }, ctx)).toEqual({ kind: 'idle', location: 'Локация не выбрана', target: null, session: null });
  });
  it('names the target next to the location before anything is bought', () => {
    expect(stripModel(null, market, ref, { ...s, currentTerminalId: 1, targetTerminalId: 2 }, ctx))
      .toEqual({ kind: 'idle', location: 'ARC-L1', target: 'TDD Area 18', session: null });
  });
  it('leaves out a target that is missing from the reference', () => {
    expect(stripModel(null, market, ref, { ...s, currentTerminalId: 1, targetTerminalId: 777 }, ctx)).toMatchObject({ target: null });
  });

  describe('the session that is going, without a run', () => {
    const idleAt1 = { ...s, currentTerminalId: 1 };
    const gain = sessionFigure(currentSession(sessionEndedAgo(10 * MINUTE, 1_240_000), CLOCK));
    const loss = sessionFigure(currentSession(sessionEndedAgo(10 * MINUTE, -174_000), CLOCK));

    it('is a segment of the line after the location', () => {
      expect(stripModel(null, market, ref, idleAt1, ctx, gain)).toEqual({
        kind: 'idle', location: 'ARC-L1', target: null,
        session: { short: '+1,24M', line: `сессия +1${NBSP}240${NBSP}000 · 413k/ч`, tone: 'gain' },
      });
    });
    it('comes with the target too, and says a loss as a loss', () => {
      expect(stripModel(null, market, ref, { ...idleAt1, targetTerminalId: 2 }, ctx, loss)).toMatchObject({
        location: 'ARC-L1', target: 'TDD Area 18', session: { short: '-174k', tone: 'loss' },
      });
    });
    it('is absent when there is no figure to show (no session, or no run ended in it)', () => {
      expect(stripModel(null, market, ref, idleAt1, ctx, null)).toMatchObject({ session: null });
      expect(stripModel(null, market, ref, idleAt1, ctx)).toMatchObject({ session: null });
    });
    it('is not in the line of a run: that line is full already', () => {
      expect(stripModel(active, market, ref, toTarget2, ctx, gain)).not.toHaveProperty('session');
      expect(stripModel(active, market, ref, toTarget2, ctx, gain)).toEqual(stripModel(active, market, ref, toTarget2, ctx));
    });
  });

  it('shows timer, cargo with what it is expected to bring, target, the profit expected and the rate', () => {
    // 96 SCU Gold bought at 6120 at terminal 1, 872 s ago; target 2: UEX 6900 (6400–7100); 1–2: 59 Gm
    expect(stripModel(active, market, ref, toTarget2, ctx)).toEqual({
      kind: 'run', timer: '14:32', phase: 'loading', phaseLabel: 'ПОГРУЗКА', phaseTimer: '14:32', next: 'depart',
      cargo: `GOLD 96 SCU по 6${NBSP}120`, cargoLine: `GOLD 96 SCU по 6${NBSP}120, ждём 6${NBSP}900`,
      cargoTitle: `GOLD 96 SCU · куплено по 6${NBSP}120 · ждём 6${NBSP}900`, target: 'TDD Area 18',
      profit: `≈ +74${NBSP}880`, profitLoss: false, rate: '266k/ч',     // 96×780 = 74 880 per max(872, 1015) s
    });
  });

  describe('what the one commodity of the hold is expected to bring: right after what it was bought for', () => {
    it('says the price of the target after the purchase price, the plain price as well as a range of it', () => {
      // an own price and a UEX price with a range are both just "ждём <price>" here (the range is not on the line)
      expect(stripModel(active, withOwnSell(market, 2, 10, 6840, NOW - 60), ref, toTarget2, ctx))
        .toMatchObject({ cargoLine: `GOLD 96 SCU по 6${NBSP}120, ждём 6${NBSP}840` });
      expect(stripModel(active, withUexSell(market, 2, GOLD, 6900, 6900, 7100), ref, toTarget2, ctx))
        .toMatchObject({ cargoLine: `GOLD 96 SCU по 6${NBSP}120, ждём 6${NBSP}900` });
    });
    it('leaves `cargo`, what the hold holds and what it was bought for, as it is: the section of the run reads it', () => {
      expect(stripModel(active, market, ref, toTarget2, ctx)).toMatchObject({ cargo: `GOLD 96 SCU по 6${NBSP}120` });
    });
    it('is not there without a target, with a target the reference does not know, or where the market has no price', () => {
      const bare = { cargo: `GOLD 96 SCU по 6${NBSP}120`, cargoLine: `GOLD 96 SCU по 6${NBSP}120`, profit: null, rate: null };
      expect(stripModel(active, market, ref, { ...s, targetTerminalId: null }, ctx)).toMatchObject({ target: null, ...bare });
      expect(stripModel(active, market, ref, { ...s, targetTerminalId: 777 }, ctx)).toMatchObject({ target: null, ...bare });
      expect(stripModel(active, withUexSell(market, 777, GOLD, 9000), ref, { ...s, targetTerminalId: 777 }, ctx)).toMatchObject({ target: null, ...bare });
      expect(stripModel(active, market, ref, { ...s, targetTerminalId: 3 }, ctx)).toMatchObject({ target: 'CRU-L1', ...bare });
    });
    it('does not let the inventory recorded at the target change the expectation, the profit or the rate', () => {
      // 96 SCU Gold; the target's own price 6840 with "0 SCU, out of stock" is the best buyer, not a reason to sell less
      const [empty, stocked, unknown] = [0, 5000, null].map(scu => stripModel(active, withOwnSell(market, 2, 10, 6840, NOW - 60, scu), ref, toTarget2, ctx));
      expect(empty).toMatchObject({ cargoLine: `GOLD 96 SCU по 6${NBSP}120, ждём 6${NBSP}840`, profit: `≈ +69${NBSP}120`, rate: '245k/ч' });      // 96×720 = 69 120 per max(872, 1015) s
      expect(stocked).toEqual(empty);
      expect(unknown).toEqual(empty);
    });
    it('is a number in the line, not a part of its own: the model has no separate expectation any more', () => {
      expect(stripModel(active, market, ref, toTarget2, ctx)).not.toHaveProperty('expect');
      expect(stripModel(active, market, ref, toTarget2, ctx)).not.toHaveProperty('expectShort');
    });
  });
  it('lists mixed cargo', () => {
    expect(stripModel(mixedRun, market, ref, s, ctx)).toMatchObject({ cargo: `GOLD 96 по 6${NBSP}120, TITA 40 по 2${NBSP}500` });
  });

  describe('the profit the run is expected to bring (the number of the card of the run), before the rate', () => {
    it('is the whole run at the prices of the target, with a plus: "≈ +74 880"', () => {
      expect(stripModel(active, market, ref, toTarget2, ctx)).toMatchObject({ profit: `≈ +74${NBSP}880`, profitLoss: false });
    });
    it('is a loss with the minus of its number, and says so', () => {
      // 96×(6000−6120) = −11 520
      expect(stripModel(active, withUexSell(market, 2, GOLD, 6000), ref, toTarget2, ctx)).toMatchObject({ profit: `≈ -11${NBSP}520`, profitLoss: true, rate: '-41k/ч' });
    });
    it('is a zero without a sign when the target pays what the cargo cost', () => {
      expect(stripModel(active, withUexSell(market, 2, GOLD, 6120), ref, toTarget2, ctx)).toMatchObject({ profit: '≈ 0', profitLoss: false });
    });
    it('is there without a rate while the time of the run is not known: the profit needs no time', () => {
      const unknown = { ...ctx, distances: new Map<string, number | null>() };
      expect(stripModel(active, market, ref, toTarget2, unknown)).toMatchObject({ profit: `≈ +74${NBSP}880`, rate: null });
    });
    it('is the number of the card of the run, whatever has been sold', () => {
      const sale = ev({ id: 5, runId: 1, ts: NOW - 300, type: 'sell', terminalId: 2, commodityId: GOLD, scu: 40, price: 6800 });
      const m = withUexSell(market, 2, TITA, 3000);
      for (const run of [active, withEvents(active, sale), mixedRun]) {
        const strip = stripModel(run, m, ref, toTarget2, ctx);
        const card = runOutlook(run, m, ref, toTarget2, ctx).expected;
        if (strip.kind !== 'run') throw new Error('a run was expected');
        // the card says "≈ 74 880", the line "≈ +74 880": the same digits, the line adds the sign of a gain
        expect(strip.profit?.replace('+', '')).toBe(card?.profit);
      }
    });
    it('is one line with the rate: "≈ +94 880 · 337k/ч"', () => {
      const both = withUexSell(market, 2, TITA, 3000);
      expect(outlookText(stripModel(mixedRun, both, ref, toTarget2, ctx))).toBe(`≈ +94${NBSP}880 · 337k/ч`);
      expect(outlookText(stripModel(active, market, ref, toTarget2, { ...ctx, distances: new Map() }))).toBe(`≈ +74${NBSP}880`);
      expect(outlookText(stripModel(active, market, ref, { ...s, targetTerminalId: null }, ctx))).toBeNull();
    });
  });

  describe('with several commodities', () => {
    const both = withUexSell(market, 2, TITA, 3000);

    it('does not say "ждём" in the line (which commodity would it be?): each one has it in the tooltip', () => {
      expect(stripModel(mixedRun, both, ref, toTarget2, ctx))
        .toMatchObject({ cargo: `GOLD 96 по 6${NBSP}120, TITA 40 по 2${NBSP}500`, cargoLine: `GOLD 96 по 6${NBSP}120, TITA 40 по 2${NBSP}500` });
    });
    it('sums the profit of every commodity with an estimate', () => {
      // 96×(6900−6120) + 40×(3000−2500) = 94 880 per 1015 s
      expect(stripModel(mixedRun, both, ref, toTarget2, ctx)).toMatchObject({ profit: `≈ +94${NBSP}880`, rate: '337k/ч' });
    });
    it('leaves the profit out when only a later commodity has an estimate, and the rate with it: a part of the hold is not the run', () => {
      const titaOnly = withUexSell(withUexSell(market, 2, GOLD, 0), 2, TITA, 3000);
      // GOLD has no usable price (zero average means "no data"): the result of the whole run is not known, as the card of the run says
      expect(stripModel(mixedRun, titaOnly, ref, toTarget2, ctx)).toMatchObject({ profit: null, rate: null });
    });
  });

  describe('the rate of the whole run, as the card of the run counts it', () => {
    const sale = (id: number, scu: number, price: number): RunEvent => ev({ id, runId: 1, ts: NOW - 300, type: 'sell', terminalId: 2, commodityId: GOLD, scu, price });

    it('counts what is already sold too, not only what is aboard', () => {
      // 40 SCU sold at 6800 (272 000), 56 SCU aboard at 6900, 587 520 put in: 70 880 over max(872, 1015) s. The hold alone is 56×780 = 43 680.
      expect(stripModel(withEvents(active, sale(5, 40, 6800)), market, ref, toTarget2, ctx)).toMatchObject({ rate: '251k/ч' });
    });
    it('is the number of the card of the run, whatever has been sold', () => {
      for (const run of [active, withEvents(active, sale(5, 40, 6800)), mixedRun]) {
        const strip = stripModel(run, withUexSell(market, 2, TITA, 3000), ref, toTarget2, ctx);
        const outlook = runOutlook(run, withUexSell(market, 2, TITA, 3000), ref, toTarget2, ctx);
        if (strip.kind !== 'run') throw new Error('a run was expected');
        // the card says '≈ 266k', the line '266k/ч' (its '≈' stands before the profit)
        expect(`${outlook.expected?.rate.replace('≈ ', '')}/ч`).toBe(strip.rate);
      }
    });
  });

  describe('time of the rate', () => {
    it('is the estimate of the whole route when it is longer than the elapsed time', () => {
      expect(stripModel(active, market, ref, toTarget2, ctx)).toMatchObject({ rate: '266k/ч' });   // 1015 s
    });
    it('is my own median for the pair rather than the distance estimate', () => {
      const own = { ...ctx, ownMedian: new Map([[pairKey(1, 2), 1200]]) };
      expect(stripModel(active, market, ref, toTarget2, own)).toMatchObject({ rate: '225k/ч' });   // 74 880 per 1200 s
    });
    it('is the elapsed time when it exceeds the route estimate', () => {
      const own = { ...ctx, ownMedian: new Map([[pairKey(1, 2), 600]]) };
      expect(stripModel(active, market, ref, toTarget2, own)).toMatchObject({ rate: '309k/ч' });   // 74 880 per 872 s
    });
    it('is not known when neither a median nor a distance is known: no number rather than one counted by the seconds so far', () => {
      // the time of the whole run is not known; the price expected and the profit are still shown
      const unknown = { ...ctx, distances: new Map<string, number | null>() };
      expect(stripModel(active, market, ref, toTarget2, unknown)).toMatchObject({ cargoLine: expect.stringContaining('ждём'), profit: expect.stringContaining('≈ +'), rate: null });
      // a distance that is stored as unknown is as good as none
      expect(stripModel(active, market, ref, toTarget2, { ...ctx, distances: new Map([[distKey(1, 2), null]]) })).toMatchObject({ rate: null });
    });
    it('is the elapsed time once the arrival is marked: the flight is over, so the time that has passed is the time of the run', () => {
      const unknown = { ...ctx, distances: new Map<string, number | null>() };
      const arrived = withEvents(active, ev({ id: 5, runId: 1, ts: NOW - 600, type: 'depart' }), ev({ id: 6, runId: 1, ts: NOW - 125, type: 'arrive' }));
      expect(stripModel(arrived, market, ref, toTarget2, unknown)).toMatchObject({ rate: '309k/ч' });   // 74 880 per 872 s
      // a flight that was shorter than the estimate does not stretch the time of the run
      expect(stripModel(arrived, market, ref, toTarget2, ctx)).toMatchObject({ rate: '309k/ч' });
    });
    it('is not known again when the ship takes off again after the arrival: that flight has no time yet', () => {
      const unknown = { ...ctx, distances: new Map<string, number | null>() };
      const again = withEvents(active,
        ev({ id: 5, runId: 1, ts: NOW - 600, type: 'depart' }), ev({ id: 6, runId: 1, ts: NOW - 400, type: 'arrive' }), ev({ id: 7, runId: 1, ts: NOW - 100, type: 'depart' }));
      expect(stripModel(again, market, ref, toTarget2, unknown)).toMatchObject({ rate: null });
    });
    it('is the result in hand over the elapsed time when nothing is left aboard to fly', () => {
      const soldAll = withEvents(mixedRun,
        ev({ id: 3, runId: 1, ts: NOW - 100, type: 'sell', terminalId: 2, commodityId: GOLD, scu: 96, price: 6900 }),
        ev({ id: 4, runId: 1, ts: NOW - 90, type: 'sell', terminalId: 2, commodityId: TITA, scu: 40, price: 3000 }));
      // 96×780 + 40×500 = 94 880 per 872 s, without the flight to the target
      expect(stripModel(soldAll, market, ref, toTarget2, ctx)).toMatchObject({ cargo: '', cargoTitle: '', rate: '392k/ч' });
    });
    it('measures the route from the first purchase', () => {
      const laterBuy = ev({ id: 3, runId: 1, ts: NOW - 300, type: 'buy', terminalId: 3, commodityId: GOLD, scu: 4, price: 6120 });
      // an own median from terminal 3 must not count: the run began at terminal 1
      const own = { ...ctx, ownMedian: new Map([[pairKey(3, 2), 5000]]) };
      expect(stripModel(withEvents(active, laterBuy), market, ref, toTarget2, own)).toMatchObject({ rate: '277k/ч' });   // 100×780 per 1015 s
    });
    it('does not guess a rate before any time has passed', () => {
      const justStarted: RunWithEvents = { run: { ...active.run, startedAt: NOW }, events: active.events };
      expect(stripModel(justStarted, market, ref, toTarget2, { ...ctx, distances: new Map() })).toMatchObject({ timer: '0:00', rate: null });
      expect(stripModel(justStarted, market, ref, toTarget2, ctx)).toMatchObject({ timer: '0:00', rate: '266k/ч' });
    });
    it('shows a loss with its sign', () => {
      expect(stripModel(active, withUexSell(market, 2, GOLD, 6000), ref, toTarget2, ctx)).toMatchObject({ rate: '-41k/ч' });   // 96×(−120) per 1015 s
    });
  });

  describe('phase of the run', () => {
    it('shows the phase with its own timer, the whole run stays in `timer`, and offers the take-off while loading', () => {
      expect(stripModel(active, market, ref, s, ctx)).toMatchObject({ timer: '14:32', phase: 'loading', phaseLabel: 'ПОГРУЗКА', phaseTimer: '14:32', next: 'depart' });
    });
    it('counts the flight from the take-off and offers the arrival', () => {
      const flying = withEvents(active, ev({ id: 5, runId: 1, ts: NOW - 300, type: 'depart' }));
      expect(stripModel(flying, market, ref, s, ctx)).toMatchObject({ timer: '14:32', phase: 'flight', phaseLabel: 'ПОЛЁТ', phaseTimer: '5:00', next: 'arrive' });
    });
    it('counts the unloading from the arrival and offers no mark: the sale ends it', () => {
      const landed = withEvents(active, ev({ id: 5, runId: 1, ts: NOW - 600, type: 'depart' }), ev({ id: 6, runId: 1, ts: NOW - 125, type: 'arrive' }));
      expect(stripModel(landed, market, ref, s, ctx)).toMatchObject({ phase: 'unloading', phaseLabel: 'ВЫГРУЗКА', phaseTimer: '2:05', next: null });
    });
  });

  describe('what the cargo was bought for', () => {
    const line = (commodityId: number, scu: number, avgBuyPrice: number): CargoLine => ({ commodityId, scu, avgBuyPrice });
    const buyOf = (id: number, commodityId: number, scu: number, price: number) => ev({ id, runId: 1, ts: NOW - 800, type: 'buy', terminalId: 1, commodityId, scu, price });

    it('says the quantity and the price after it for the one commodity of the hold', () => {
      expect(cargoText(ref, [line(GOLD, 96, 6120)])).toBe(`GOLD 96 SCU по 6${NBSP}120`);
    });
    it('leaves the word SCU out when there are several commodities: the line must not grow', () => {
      expect(cargoText(ref, [line(GOLD, 96, 6120), line(TITA, 40, 2500)])).toBe(`GOLD 96 по 6${NBSP}120, TITA 40 по 2${NBSP}500`);
      expect(cargoText(ref, [line(GOLD, 1, 7), line(TITA, 2, 8), line(99, 3, 9)])).toBe('GOLD 1 по 7, TITA 2 по 8, #99 3 по 9');
    });
    it('is empty for an empty hold', () => {
      expect(cargoText(ref, [])).toBe('');
      expect(cargoTitle(ref, [])).toBe('');
    });
    it('adds what the one commodity is expected to sell for, "ждём" after the price it was bought for', () => {
      expect(cargoText(ref, [line(GOLD, 96, 6120)], [6900])).toBe(`GOLD 96 SCU по 6${NBSP}120, ждём 6${NBSP}900`);
      expect(cargoText(ref, [line(GOLD, 96, 6120)], [1_234_567])).toBe(`GOLD 96 SCU по 6${NBSP}120, ждём 1${NBSP}234${NBSP}567`);
    });
    it('says nothing of the expectation for a commodity that has none, or when it is not given', () => {
      expect(cargoText(ref, [line(GOLD, 96, 6120)], [null])).toBe(`GOLD 96 SCU по 6${NBSP}120`);
      expect(cargoText(ref, [line(GOLD, 96, 6120)], [])).toBe(`GOLD 96 SCU по 6${NBSP}120`);
    });
    it('never adds it for several commodities: the line would not say which commodity it is for', () => {
      expect(cargoText(ref, [line(GOLD, 96, 6120), line(TITA, 40, 2500)], [6900, 3000])).toBe(`GOLD 96 по 6${NBSP}120, TITA 40 по 2${NBSP}500`);
    });
    it('writes a seven-digit price whole, in the format of every price', () => {
      expect(cargoText(ref, [line(GOLD, 600, 1_234_567)])).toBe(`GOLD 600 SCU по 1${NBSP}234${NBSP}567`);
    });

    it('is the average over all the purchases, weighted by the quantity, as a whole number', () => {
      // 60 SCU at 6000 and 40 SCU at 7000 cost 6400 on average; 3 SCU at 100 and 4 SCU at 101 cost 100,57
      const twice = withEvents(active, buyOf(3, GOLD, 4, 6120));
      expect(stripModel(withEvents({ run: active.run, events: [] }, buyOf(1, GOLD, 60, 6000), buyOf(2, GOLD, 40, 7000)), market, ref, s, ctx))
        .toMatchObject({ cargo: `GOLD 100 SCU по 6${NBSP}400` });
      expect(stripModel(withEvents({ run: active.run, events: [] }, buyOf(1, GOLD, 3, 100), buyOf(2, GOLD, 4, 101)), market, ref, s, ctx))
        .toMatchObject({ cargo: 'GOLD 7 SCU по 101' });
      expect(stripModel(twice, market, ref, s, ctx)).toMatchObject({ cargo: `GOLD 100 SCU по 6${NBSP}120` });
    });
    it('stays the price of what was bought after a part of the commodity is sold', () => {
      const soldSome = withEvents(active, ev({ id: 3, runId: 1, ts: NOW - 100, type: 'sell', terminalId: 2, commodityId: GOLD, scu: 40, price: 6900 }));
      expect(stripModel(soldSome, market, ref, s, ctx)).toMatchObject({ cargo: `GOLD 56 SCU по 6${NBSP}120` });
    });
    it('is not changed by the target: the line says what the cargo cost whatever it is expected to bring', () => {
      expect(stripModel(mixedRun, market, ref, toTarget2, ctx)).toMatchObject({ cargo: `GOLD 96 по 6${NBSP}120, TITA 40 по 2${NBSP}500` });
      expect(stripModel(mixedRun, market, ref, { ...s, targetTerminalId: 777 }, ctx)).toMatchObject({ cargo: `GOLD 96 по 6${NBSP}120, TITA 40 по 2${NBSP}500` });
    });

    describe('the tooltip of the cargo: a line for every commodity', () => {
      const both = withUexSell(market, 2, TITA, 3000, 2800, 3200);

      it('says the quantity, what it was bought for and, with a target and its price, what it is expected to sell for', () => {
        expect(stripModel(active, market, ref, toTarget2, ctx)).toMatchObject({
          cargoTitle: `GOLD 96 SCU · куплено по 6${NBSP}120 · ждём 6${NBSP}900`,
        });
      });
      it('expects every commodity: it is where "ждём" of each one stands once the line itself names none of them', () => {
        const strip = stripModel(mixedRun, both, ref, toTarget2, ctx);
        expect(strip).toMatchObject({
          cargoLine: `GOLD 96 по 6${NBSP}120, TITA 40 по 2${NBSP}500`,
          cargoTitle: `GOLD 96 SCU · куплено по 6${NBSP}120 · ждём 6${NBSP}900\nTITA 40 SCU · куплено по 2${NBSP}500 · ждём 3${NBSP}000`,
        });
      });
      it('keeps the SCU in the tooltip however many commodities there are, and leaves the range of the price out of it', () => {
        const title = stripModel(mixedRun, both, ref, toTarget2, ctx);
        if (title.kind !== 'run') throw new Error('a run was expected');
        expect(title.cargoTitle.split('\n')).toHaveLength(2);
        expect(title.cargoTitle).not.toContain('–');
      });
      it('leaves the expectation out of a commodity the target has no price for', () => {
        expect(stripModel(mixedRun, market, ref, toTarget2, ctx)).toMatchObject({
          cargoTitle: `GOLD 96 SCU · куплено по 6${NBSP}120 · ждём 6${NBSP}900\nTITA 40 SCU · куплено по 2${NBSP}500`,
        });
        // the first commodity has none, the second has one
        const titaOnly = withUexSell(withUexSell(market, 2, GOLD, 0), 2, TITA, 3000);
        expect(stripModel(mixedRun, titaOnly, ref, toTarget2, ctx)).toMatchObject({
          cargoTitle: `GOLD 96 SCU · куплено по 6${NBSP}120\nTITA 40 SCU · куплено по 2${NBSP}500 · ждём 3${NBSP}000`,
        });
      });
      it('has no expectation without a target, or with one the reference does not know, or one without any price', () => {
        const plain = `GOLD 96 SCU · куплено по 6${NBSP}120\nTITA 40 SCU · куплено по 2${NBSP}500`;
        expect(stripModel(mixedRun, both, ref, s, ctx)).toMatchObject({ cargoTitle: plain });
        expect(stripModel(mixedRun, both, ref, { ...s, targetTerminalId: 777 }, ctx)).toMatchObject({ cargoTitle: plain });
        expect(stripModel(mixedRun, both, ref, { ...s, targetTerminalId: 3 }, ctx)).toMatchObject({ cargoTitle: plain });
      });
    });
  });

  describe('timer and cargo', () => {
    it('counts hours and never goes negative', () => {
      const long: RunWithEvents = { run: { ...active.run, startedAt: NOW - 3872 }, events: active.events };
      expect(stripModel(long, market, ref, s, ctx)).toMatchObject({ timer: '1:04:32' });
      const future: RunWithEvents = { run: { ...active.run, startedAt: NOW + 30 }, events: active.events };
      expect(stripModel(future, market, ref, s, ctx)).toMatchObject({ timer: '0:00' });
    });
    it('shows only what is still in the hold', () => {
      const soldSome = withEvents(mixedRun, ev({ id: 3, runId: 1, ts: NOW - 100, type: 'sell', terminalId: 2, commodityId: GOLD, scu: 96, price: 6900 }));
      expect(stripModel(soldSome, market, ref, s, ctx)).toMatchObject({ cargo: `TITA 40 SCU по 2${NBSP}500` });
      const soldAll = withEvents(soldSome, ev({ id: 4, runId: 1, ts: NOW - 90, type: 'sell', terminalId: 2, commodityId: TITA, scu: 40, price: 3000 }));
      // nothing is left to expect a price for: the line says no "ждём", and the profit is the one in hand
      expect(stripModel(soldAll, market, ref, toTarget2, ctx)).toMatchObject({ cargo: '', cargoTitle: '', target: 'TDD Area 18', profit: `≈ +94${NBSP}880` });
    });
    it('survives a commodity that left the reference', () => {
      const odd = withEvents(active, ev({ id: 3, runId: 1, ts: NOW - 800, type: 'buy', terminalId: 1, commodityId: 99, scu: 5, price: 100 }));
      expect(stripModel(odd, market, ref, s, ctx)).toMatchObject({ cargo: `GOLD 96 по 6${NBSP}120, #99 5 по 100` });
    });
  });

  describe('the tooltip of the whole line: everything the line knows, the cargo cut or not', () => {
    it('says the phase, the whole time, the target, the profit and the rate, then a line for each commodity of the hold', () => {
      expect(stripTitle(stripModel(active, market, ref, toTarget2, ctx)))
        .toBe(`ПОГРУЗКА 14:32 · всего 14:32 · → TDD Area 18 · ≈ +74${NBSP}880 · 266k/ч\nGOLD 96 SCU · куплено по 6${NBSP}120 · ждём 6${NBSP}900`);
    });
    it('with several commodities carries the expected price of every one, so that it is under the cursor anywhere on the line, not only over the cargo', () => {
      const both = withUexSell(market, 2, TITA, 3000);
      expect(stripTitle(stripModel(mixedRun, both, ref, toTarget2, ctx))).toBe([
        `ПОГРУЗКА 14:32 · всего 14:32 · → TDD Area 18 · ≈ +94${NBSP}880 · 337k/ч`,
        `GOLD 96 SCU · куплено по 6${NBSP}120 · ждём 6${NBSP}900`,
        `TITA 40 SCU · куплено по 2${NBSP}500 · ждём 3${NBSP}000`,
      ].join('\n'));
    });
    it('leaves "ждём" out of the line of a commodity the target has no price for', () => {
      expect(stripTitle(stripModel(mixedRun, market, ref, toTarget2, ctx))).toBe([
        `ПОГРУЗКА 14:32 · всего 14:32 · → TDD Area 18`,
        `GOLD 96 SCU · куплено по 6${NBSP}120 · ждём 6${NBSP}900`,
        `TITA 40 SCU · куплено по 2${NBSP}500`,
      ].join('\n'));
    });
    it('says that the target is not chosen and has no profit to tell', () => {
      expect(stripTitle(stripModel(active, market, ref, s, ctx))).toBe(`ПОГРУЗКА 14:32 · всего 14:32 · цель не выбрана\nGOLD 96 SCU · куплено по 6${NBSP}120`);
    });
    it('has no lines of commodities when nothing is left in the hold', () => {
      const soldAll = withEvents(active, ev({ id: 3, runId: 1, ts: NOW - 100, type: 'sell', terminalId: 2, commodityId: GOLD, scu: 96, price: 6900 }));
      expect(stripTitle(stripModel(soldAll, market, ref, toTarget2, ctx))).not.toContain('\n');
    });
    it('of a line without a run is the location, the target and the session', () => {
      const gain = sessionFigure(currentSession(sessionEndedAgo(10 * MINUTE, 1_240_000), CLOCK));
      expect(stripTitle(stripModel(null, market, ref, { ...s, currentTerminalId: 1 }, ctx))).toBe('ARC-L1');
      expect(stripTitle(stripModel(null, market, ref, { ...s, currentTerminalId: 1, targetTerminalId: 2 }, ctx, gain)))
        .toBe(`ARC-L1 → TDD Area 18 · сессия +1${NBSP}240${NBSP}000 · 413k/ч`);
    });
  });
});
