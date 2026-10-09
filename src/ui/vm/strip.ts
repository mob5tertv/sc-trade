import { formatCompact, formatDuration, formatUec } from '../../core/format';
import type { RouteCtx } from '../../core/routes';
import { cargoOf } from '../../core/run';
import type { Settings } from '../../core/settings';
import type { CargoLine, Market, Reference, RunWithEvents } from '../../core/types';
import { expectedProfitText } from './run-outlook';
import { nextMarkOf, phaseCaps, runPhases, type RunPhase } from './run-phase';
import { expectedRun, priceAtTarget, type PricedLine } from './run-rate';
import type { SessionFigure } from './stats-view';
import { terminalName } from './terminal-name';

export type StripModel =
  | {
    kind: 'idle'; location: string;
    /** The target that is set before anything is bought: the line reads 'HUR-L1 → ARC-L1'. */
    target: string | null;
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
    target: string | null;
    /**
     * The profit the whole run is expected to bring at the target, the number of the card of the run (`expectedRun`), with the sign of a gain: '≈ +66 720'.
     * `null` without a target, or without a price at it for everything aboard (a sum over part of the hold is not the result of the run).
     */
    profit: string | null;
    /** The expected profit is a loss: the profit and the rate are in the colour of one. */
    profitLoss: boolean;
    /** The expected UEC per hour of the whole run, '337k/ч' (the card of the run says '≈ 337k'): `null` while the time of the run is not known. */
    rate: string | null;
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

/**
 * What the small strip shows: the current location (and the target, when one is set) and what the session that is going
 * has earned (`session`) without a run; during a run the phase with its own timer, the cargo with what it was bought for (and,
 * for one commodity, what it is expected to sell for), the target terminal, then the profit the run is expected to bring and the
 * expected UEC per hour (that line is full: no session in it). The tooltip of the cargo has every commodity with its own
 * expectation (`cargoTitle`).
 * The profit and the rate are the numbers of the card of the run, over the whole run (`expectedRun`): the profit is none while the
 * target pays for only a part of the hold, the rate is none besides while the time of the run is not known. A target that is unset
 * or missing from the reference leaves the last three out.
 */
export function stripModel(
  active: RunWithEvents | null, m: Market, ref: Reference, s: Settings, ctx: RouteCtx, session: SessionFigure | null = null,
): StripModel {
  const target = s.targetTerminalId === null ? undefined : ref.terminals.get(s.targetTerminalId);
  if (active === null) {
    return { kind: 'idle', location: locationOf(ref, s.currentTerminalId), target: target ? terminalName(target) : null, session };
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
    return { ...head, cargoLine: head.cargo, cargoTitle: cargoTitle(ref, unpriced), target: null, profit: null, profitLoss: false, rate: null };
  }

  const priced = priceAtTarget(cargo, m, target.id, ctx);
  const expected = expectedRun(active, m, target.id, ctx);
  return {
    ...head,
    cargoLine: cargoText(ref, cargo, priced.map(({ sell }) => sell?.price ?? null)),
    cargoTitle: cargoTitle(ref, priced),
    target: terminalName(target),
    profit: expected === null ? null : expectedProfitText(expected.profit, true),
    profitLoss: expected !== null && expected.profit < 0,
    rate: expected?.rate == null ? null : `${formatCompact(expected.rate)}/ч`,
  };
}

/** The profit and the rate of a run as one text, '≈ +66 720 · 337k/ч' (the profit alone while the time of the run is not known); `null` when there is no profit. */
export function outlookText(model: StripModel): string | null {
  if (model.kind !== 'run' || model.profit === null) return null;
  return [model.profit, model.rate].filter((part) => part !== null).join(' · ');
}

/**
 * Everything the strip knows, for the tooltip of the line (the line itself cuts a long cargo): the location with the target and the session
 * without a run; the phase with its timer, the whole time of the run, the cargo, the target and the outlook of the run.
 */
export function stripTitle(model: StripModel): string {
  const parts = model.kind === 'idle'
    ? [model.target === null ? model.location : `${model.location} → ${model.target}`, model.session?.line]
    : [
      `${model.phaseLabel} ${model.phaseTimer}`, `всего ${model.timer}`, model.cargoLine,
      model.target === null ? 'цель не выбрана' : `→ ${model.target}`, outlookText(model),
    ];
  return parts.filter(Boolean).join(' · ');
}
