import { formatCompact, formatDuration, formatUec } from '../../core/format';
import type { RouteCtx } from '../../core/routes';
import { cargoOf } from '../../core/run';
import type { Settings } from '../../core/settings';
import type { CargoLine, Estimate, Market, Reference, RunWithEvents, Terminal } from '../../core/types';
import { nextMarkOf, phaseCaps, runPhases, type RunPhase } from './run-phase';
import { priceAtTarget, ratePerHour, routeSecOf, wholeRunSec, type PricedLine } from './run-rate';

export type StripModel =
  | {
    kind: 'idle'; location: string;
    /** The target that is set before anything is bought: the line reads 'HUR-L1 → ARC-L1'. */
    target: string | null;
  }
  | {
    kind: 'run';
    /** The whole run, 'm:ss': it is in the tooltip of the phase. */
    timer: string;
    /** What the run is doing, and for how long (the first segment of the line): 'ПОГРУЗКА' '3:12'. */
    phase: RunPhase; phaseLabel: string; phaseTimer: string;
    /** The mark the one button of the line gives; `null` when none (unloading). */
    next: 'depart' | 'arrive' | null;
    cargo: string; target: string | null;
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

function cargoText(ref: Reference, cargo: CargoLine[]): string {
  return cargo.map(({ commodityId, scu }) => {
    const commodity = ref.commodities.get(commodityId);
    return `${commodity ? commodity.code || commodity.name : `#${commodityId}`} ${scu} SCU`;
  }).join(', ');
}

/** 'ждём 6 900 (6 400–7 100)', and its short form 'ждём 6 900'; no brackets when both bounds are the price. */
function expectTexts(sell: Estimate): { full: string; short: string } {
  const [price, low, high] = [sell.price, sell.low, sell.high].map(formatUec);
  const short = `ждём ${price}`;
  return { full: low === price && high === price ? short : `${short} (${low}–${high})`, short };
}

/**
 * '≈ 310k/ч': the profit of the commodities that have a price at the target over the time of the whole
 * run, which is at least what has passed and at least the flight from the first purchase to the target.
 * `null` when no commodity has a price there or no time is known.
 */
function rateText(priced: PricedLine[], elapsedSec: number, routeSec: number | null): string | null {
  const known = priced.filter((p): p is { line: CargoLine; sell: Estimate } => p.sell !== null);
  if (known.length === 0) return null;
  const profit = known.reduce((sum, { line, sell }) => sum + line.scu * (sell.price - line.avgBuyPrice), 0);
  const rate = ratePerHour(profit, wholeRunSec(elapsedSec, routeSec));
  return rate === null ? null : `≈ ${formatCompact(rate)}/ч`;
}

/**
 * What the small strip shows: the current location (and the target, when one is set) without a run; during a run the
 * phase with its own timer, the cargo, the target terminal, what the first commodity is expected to sell for there and
 * the expected UEC per hour. A target that is unset or missing from the reference leaves the last three out.
 */
export function stripModel(active: RunWithEvents | null, m: Market, ref: Reference, s: Settings, ctx: RouteCtx): StripModel {
  const target = s.targetTerminalId === null ? undefined : ref.terminals.get(s.targetTerminalId);
  if (active === null) return { kind: 'idle', location: locationOf(ref, s.currentTerminalId), target: target ? terminalLabel(target) : null };

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

  if (!target) return { ...head, target: null, expect: null, expectShort: null, rate: null };

  const priced = priceAtTarget(cargo, m, target.id, ctx);
  const firstSell = priced[0]?.sell ?? null;
  const expect = firstSell ? expectTexts(firstSell) : null;
  return {
    ...head,
    target: terminalLabel(target),
    expect: expect?.full ?? null, expectShort: expect?.short ?? null,
    rate: rateText(priced, elapsedSec, routeSecOf(events, target.id, ctx)),
  };
}
