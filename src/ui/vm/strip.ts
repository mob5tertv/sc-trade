import { formatCompact, formatDuration, formatUec } from '../../core/format';
import type { RouteCtx } from '../../core/routes';
import { cargoOf } from '../../core/run';
import type { Settings } from '../../core/settings';
import type { CargoLine, Estimate, Market, Reference, RunWithEvents, Terminal } from '../../core/types';
import { nextMarkOf, phaseCaps, runPhases, type RunPhase } from './run-phase';
import { expectedRun, priceAtTarget, type PricedLine } from './run-rate';
import type { SessionFigure } from './stats-view';

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
    /** The cargo for a tooltip, a line for every commodity: 'MEDS 120 SCU · куплено по 2 115 · ждём 2 351'; empty for an empty hold. */
    cargoTitle: string;
    target: string | null;
    /** 'ждём 6 900 (6 400–7 100)': with the range, for a tooltip. */
    expect: string | null;
    /** 'ждём 6 900': the same without the range, for the one-line strip. */
    expectShort: string | null;
    rate: string | null;
  };

const NO_LOCATION = 'Локация не выбрана';

// the nickname is what players know a terminal by; UEX leaves it empty on rare rows
const terminalLabel = (t: Terminal): string => t.nickname || t.displayname || t.name;

function locationOf(ref: Reference, terminalId: number | null): string {
  const terminal = terminalId === null ? undefined : ref.terminals.get(terminalId);
  return terminal ? terminalLabel(terminal) : NO_LOCATION;
}

const commodityCode = (ref: Reference, commodityId: number): string => {
  const commodity = ref.commodities.get(commodityId);
  return commodity ? commodity.code || commodity.name : `#${commodityId}`;
};

/**
 * What is in the hold and what each commodity was bought for (the average over its purchases, a whole number):
 * 'MEDS 120 SCU по 2 115'. With several commodities the word SCU is left out, so that the line does not grow:
 * 'MEDS 120 по 2 115, STIM 80 по 2 810'.
 */
export function cargoText(ref: Reference, cargo: CargoLine[]): string {
  const unit = cargo.length === 1 ? ' SCU' : '';
  return cargo.map(({ commodityId, scu, avgBuyPrice }) => `${commodityCode(ref, commodityId)} ${scu}${unit} по ${formatUec(avgBuyPrice)}`).join(', ');
}

/** 'ждём 6 900 (6 400–7 100)', and its short form 'ждём 6 900'; no brackets when both bounds are the price. */
function expectTexts(sell: Estimate): { full: string; short: string } {
  const [price, low, high] = [sell.price, sell.low, sell.high].map(formatUec);
  const short = `ждём ${price}`;
  return { full: low === price && high === price ? short : `${short} (${low}–${high})`, short };
}

/**
 * The whole cargo for a tooltip, a line for every commodity: the quantity, what it was bought for and, where the target
 * pays a known price for it, what it is expected to sell for there: 'MEDS 120 SCU · куплено по 2 115 · ждём 2 351'.
 */
export function cargoTitle(ref: Reference, priced: PricedLine[]): string {
  return priced.map(({ line, sell }) => [
    `${commodityCode(ref, line.commodityId)} ${line.scu} SCU`, `куплено по ${formatUec(line.avgBuyPrice)}`, sell && expectTexts(sell).short,
  ].filter(Boolean).join(' · ')).join('\n');
}

/**
 * What the small strip shows: the current location (and the target, when one is set) and what the session that is going
 * has earned (`session`) without a run; during a run the phase with its own timer, the cargo with what it was bought for, the
 * target terminal, what the first commodity is expected to sell for there and the expected UEC per hour (that line is full:
 * no session in it). The tooltip of the cargo has every commodity with its own expectation (`cargoTitle`).
 * The rate is the number of the card of the run, over the whole run (`expectedRun`): none while the time of the run is not
 * known, or while the target pays for only a part of the hold. A target that is unset or missing from the reference leaves
 * the last three out.
 */
export function stripModel(
  active: RunWithEvents | null, m: Market, ref: Reference, s: Settings, ctx: RouteCtx, session: SessionFigure | null = null,
): StripModel {
  const target = s.targetTerminalId === null ? undefined : ref.terminals.get(s.targetTerminalId);
  if (active === null) {
    return { kind: 'idle', location: locationOf(ref, s.currentTerminalId), target: target ? terminalLabel(target) : null, session };
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
    return { ...head, cargoTitle: cargoTitle(ref, unpriced), target: null, expect: null, expectShort: null, rate: null };
  }

  const priced = priceAtTarget(cargo, m, target.id, ctx);
  const firstSell = priced[0]?.sell ?? null;
  const expect = firstSell ? expectTexts(firstSell) : null;
  const rate = expectedRun(active, m, target.id, ctx)?.rate ?? null;
  return {
    ...head,
    cargoTitle: cargoTitle(ref, priced),
    target: terminalLabel(target),
    expect: expect?.full ?? null, expectShort: expect?.short ?? null,
    rate: rate === null ? null : `≈ ${formatCompact(rate)}/ч`,
  };
}
