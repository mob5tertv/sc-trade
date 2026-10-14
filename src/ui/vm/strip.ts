import { formatAge, formatDuration, formatUec } from '../../core/format';
import type { RouteCtx } from '../../core/routes';
import { cargoOf } from '../../core/run';
import type { Settings } from '../../core/settings';
import type { CargoLine, Market, Reference, RunWithEvents } from '../../core/types';
import { expectedProfitText } from './run-outlook';
import { nextMarkOf, phaseCaps, runPhases, type RunPhase } from './run-phase';
import { expectedRun, priceAtTarget, type PricedLine } from './run-rate';
import type { SessionFigure } from './stats-view';
import { terminalName } from './terminal-name';
import { isOwnPrice, uexRangeOf } from './terminal-rows';

/**
 * The one commodity of the hold as the line of the strip draws it (spec 14.19, the run line): what it is, how much, what it was bought
 * for, and after an arrow the SALE side at the target. The sale side is told by who says it: a price a person typed in stands still in
 * a frame with his name and its age; the low and the high end of the range of the target take turns in one place; a price that is one
 * number stands alone.
 */
export interface StripLot {
  /** 'MEDS', '120 SCU', '2 115'. */
  code: string; qty: string; buy: string;
  /** A price a person typed in at the target (mine: «моя»; later the nick of a member of the fleet), and how old it is. */
  person: { who: string; price: string; age: string } | null;
  /** The two ends of the range of the target, the very numbers of the column «Мин–макс» of its table; `null` when the price has no range. */
  range: { low: string; high: string } | null;
  /** The expected price when neither a person nor a range says it; `null` when one of them does, or nothing is known at the target. */
  single: string | null;
}

export type StripModel =
  | {
    kind: 'idle'; location: string;
    /** The target that is set before anything is bought: the line reads 'HUR-L1 → ARC-L1'. */
    target: string | null;
    /** The second step of a target in two steps: `target` is where the cargo is bought, this is where it is sold ('… → закупка: X · потом Y'). */
    then?: string | null;
    /** What the play session that is going has earned ('+1,24M'); `null` when there is no such session or nothing ended in it. */
    session: SessionFigure | null;
  }
  | {
    kind: 'run';
    /** The whole run, 'm:ss': it is in the tooltip of the phase. */
    timer: string;
    /** What the run is doing, and for how long (the first segment of the line): 'ПОГРУЗКА' '3:12'. */
    phase: RunPhase; phaseLabel: string; phaseTimer: string;
    /** The mark the one button of the line gives; `null` when none (unloading). */
    next: 'depart' | 'arrive' | null;
    /** What is in the hold and what it was bought for: 'MEDS 120 SCU по 2 115'; with several commodities 'MEDS 120 по 2 115, STIM 80 по 2 810'. */
    cargo: string;
    /**
     * The same as the line of the strip says it: for ONE commodity, when the target pays a known price for it, what it is expected to sell for stands
     * right after the price it was bought for, 'MEDS 120 SCU по 2 115, ждём 2 351'. With several commodities it is `cargo` (which commodity would a
     * "ждём" be for?): the expectation of each one is in `cargoTitle`.
     */
    cargoLine: string;
    /** The cargo for a tooltip, a line for every commodity: 'MEDS 120 SCU · куплено по 2 115 · ждём 2 351'; empty for an empty hold. */
    cargoTitle: string;
    /** The one commodity of the hold in parts, for the line to draw (`StripLot`); absent or `null` with several commodities or an empty hold: the line then writes `cargoLine`. */
    lot?: StripLot | null;
    target: string | null;
    /**
     * The profit the whole run is expected to bring at the target, the number of the card of the run (`expectedRun`), with the sign of a gain: '≈ +66 720'.
     * `null` without a target, or without a price at it for everything aboard (a sum over part of the hold is not the result of the run).
     */
    profit: string | null;
    /** The expected profit is a loss: it is in the colour of one. */
    profitLoss: boolean;
  };

const NO_LOCATION = 'Локация не выбрана';

function locationOf(ref: Reference, terminalId: number | null): string {
  const terminal = terminalId === null ? undefined : ref.terminals.get(terminalId);
  return terminal ? terminalName(terminal) : NO_LOCATION;
}

const commodityCode = (ref: Reference, commodityId: number): string => {
  const commodity = ref.commodities.get(commodityId);
  return commodity ? commodity.code || commodity.name : `#${commodityId}`;
};

/**
 * What is in the hold and what each commodity was bought for (the average over its purchases, a whole number):
 * 'MEDS 120 SCU по 2 115'. With several commodities the word SCU is left out, so that the line does not grow:
 * 'MEDS 120 по 2 115, STIM 80 по 2 810'. `expected[i]` is the price the target is expected to pay for `cargo[i]` (`null`: none known);
 * for the ONE commodity of the hold it follows the price it was bought for, 'MEDS 120 SCU по 2 115, ждём 2 351'. With several it is not said
 * here: a "ждём" in a line of several commodities would not tell which of them it is for (the tooltip, `cargoTitle`, has one for each).
 */
export function cargoText(ref: Reference, cargo: CargoLine[], expected: ReadonlyArray<number | null> = []): string {
  const unit = cargo.length === 1 ? ' SCU' : '';
  const text = cargo.map(({ commodityId, scu, avgBuyPrice }) => `${commodityCode(ref, commodityId)} ${scu}${unit} по ${formatUec(avgBuyPrice)}`).join(', ');
  const price = cargo.length === 1 ? expected[0] ?? null : null;
  return price === null ? text : `${text}, ждём ${formatUec(price)}`;
}

/**
 * The whole cargo for a tooltip, a line for every commodity: the quantity, what it was bought for and, where the target
 * pays a known price for it, what it is expected to sell for there: 'MEDS 120 SCU · куплено по 2 115 · ждём 2 351'.
 */
export function cargoTitle(ref: Reference, priced: PricedLine[]): string {
  return priced.map(({ line, sell }) => [
    `${commodityCode(ref, line.commodityId)} ${line.scu} SCU`, `куплено по ${formatUec(line.avgBuyPrice)}`, sell && `ждём ${formatUec(sell.price)}`,
  ].filter(Boolean).join(' · ')).join('\n');
}

/** The word that stands for the player in the frame of a price he typed in himself. */
export const OWN_PRICE_NAME = 'моя';

/**
 * The one commodity of the hold in parts (`StripLot`); `null` for an empty hold and for several commodities (the line then
 * writes them as before, and the sale side of each is in the tooltip). `sale` is where the cargo is going: the target and what is
 * known there, or `null` without a target. The sale side:
 *  - a price of my own at the target that is not cold stands in the frame, with its age;
 *  - the range is the one UEX knows for the target, whatever my diary says there: the very numbers of «Мин–макс» in its table
 *    (`uexRangeOf`), so the strip and the table cannot disagree; a range of one price is no range;
 *  - with neither, the expected price stands alone (a single report of UEX, a range of one price, a cold price of mine that
 *    UEX has nothing for).
 */
export function stripLot(
  ref: Reference, cargo: CargoLine[], sale: { priced: PricedLine[]; m: Market; targetId: number; ctx: RouteCtx } | null,
): StripLot | null {
  if (cargo.length !== 1) return null;
  const [{ commodityId, scu, avgBuyPrice }] = cargo;
  const base = { code: commodityCode(ref, commodityId), qty: `${scu} SCU`, buy: formatUec(avgBuyPrice) };
  const sell = sale?.priced[0]?.sell ?? null;
  if (sale === null || sell === null) return { ...base, person: null, range: null, single: null };

  const person = isOwnPrice(sell) ? { who: OWN_PRICE_NAME, price: formatUec(sell.price), age: formatAge(sell.ageSec) } : null;
  const uex = uexRangeOf(sale.m, sale.targetId, commodityId, 'sell', sale.ctx);
  const range = uex.kind === 'spread' ? { low: formatUec(uex.low), high: formatUec(uex.high) } : null;
  return { ...base, person, range, single: person === null && range === null ? formatUec(sell.price) : null };
}

/**
 * What the small strip shows: the current location (and the target, when one is set) and what the session that is going
 * has earned (`session`) without a run; during a run the phase with its own timer, the cargo with what it was bought for (and,
 * for one commodity, what it is expected to sell for), the target terminal, then the profit the run is expected to bring and the
 * expected UEC per hour (that line is full: no session in it). The tooltip of the cargo has every commodity with its own
 * expectation (`cargoTitle`).
 * The profit is the number of the card of the run, over the whole run (`expectedRun`): it is none while the target pays for only
 * a part of the hold. A target that is unset
 * or missing from the reference leaves the last three out.
 */
export function stripModel(
  active: RunWithEvents | null, m: Market, ref: Reference, s: Settings, ctx: RouteCtx, session: SessionFigure | null = null,
): StripModel {
  const target = s.targetTerminalId === null ? undefined : ref.terminals.get(s.targetTerminalId);
  if (active === null) {
    const then = target && s.targetThenId !== null ? ref.terminals.get(s.targetThenId) : undefined;
    return {
      kind: 'idle', location: locationOf(ref, s.currentTerminalId), target: target ? terminalName(target) : null, session,
      ...(then ? { then: terminalName(then) } : {}),
    };
  }

  const { run, events } = active;
  const elapsedSec = Math.max(0, ctx.now - run.startedAt);
  const cargo = cargoOf(events);
  const phases = runPhases(run, events, ctx.now);
  const head = {
    kind: 'run' as const,
    timer: formatDuration(elapsedSec),
    phase: phases.phase, phaseLabel: phaseCaps(phases.phase), phaseTimer: formatDuration(phases.sinceSec),
    next: nextMarkOf(active, ctx.now),
    cargo: cargoText(ref, cargo),
  };

  if (!target) {
    const unpriced = cargo.map((line): PricedLine => ({ line, sell: null }));
    return {
      ...head, cargoLine: head.cargo, cargoTitle: cargoTitle(ref, unpriced), lot: stripLot(ref, cargo, null),
      target: null, profit: null, profitLoss: false,
    };
  }

  const priced = priceAtTarget(cargo, m, target.id, ctx);
  const expected = expectedRun(active, m, target.id, ctx);
  return {
    ...head,
    cargoLine: cargoText(ref, cargo, priced.map(({ sell }) => sell?.price ?? null)),
    cargoTitle: cargoTitle(ref, priced),
    lot: stripLot(ref, cargo, { priced, m, targetId: target.id, ctx }),
    target: terminalName(target),
    profit: expected === null ? null : expectedProfitText(expected.profit, true),
    profitLoss: expected !== null && expected.profit < 0,
  };
}

/** What a run is expected to bring, as the mini line writes it after the target: '≈ +66 720'; `null` when there is no profit to say. */
export function outlookText(model: StripModel): string | null {
  return model.kind === 'run' ? model.profit : null;
}

/**
 * Everything the strip knows, for the tooltip of the line (the line itself cuts a long cargo): the location with the target and the session
 * without a run; with a run the phase with its timer, the whole time of the run, the target and the outlook of the run on the first line, and then a
 * line for every commodity of the hold (`cargoTitle`: the quantity, what it was bought for and what it is expected to sell for), so that the expected
 * price of each is under the cursor anywhere on the line, also with several commodities, where the line itself names none.
 */
export function stripTitle(model: StripModel): string {
  if (model.kind === 'idle') {
    const target = model.target === null ? null : model.then ? `закупка: ${model.target} · потом ${model.then}` : model.target;
    return [target === null ? model.location : `${model.location} → ${target}`, model.session?.line].filter(Boolean).join(' · ');
  }
  const head = [
    `${model.phaseLabel} ${model.phaseTimer}`, `всего ${model.timer}`,
    model.target === null ? 'цель не выбрана' : `→ ${model.target}`, outlookText(model),
  ].filter(Boolean).join(' · ');
  return model.cargoTitle === '' ? head : `${head}\n${model.cargoTitle}`;
}
