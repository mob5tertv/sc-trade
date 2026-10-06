import { estimate } from '../../core/estimate';
import { formatCompact, formatDuration, formatUec } from '../../core/format';
import { travelSec } from '../../core/routes';
import type { RouteCtx } from '../../core/routes';
import { cargoOf } from '../../core/run';
import type { Settings } from '../../core/settings';
import { distKey, pairKey } from '../../core/types';
import type { CargoLine, Estimate, Market, Reference, RunWithEvents, Terminal } from '../../core/types';

export type StripModel =
  | { kind: 'idle'; location: string }
  | { kind: 'run'; timer: string; cargo: string; target: string | null; expect: string | null; rate: string | null };

const SEC_PER_HOUR = 3600;
const NO_LOCATION = 'Локация не выбрана';

/** A cargo line with what the target terminal pays for it; the sale price is unknown when nothing is known there. */
interface PricedLine { line: CargoLine; sell: Estimate | null }

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

/** 'ждём 6 900 (6 400–7 100)'; no brackets when both bounds are the price. */
function expectText(sell: Estimate): string {
  const [price, low, high] = [sell.price, sell.low, sell.high].map(formatUec);
  return low === price && high === price ? `ждём ${price}` : `ждём ${price} (${low}–${high})`;
}

/** The flight from `fromId` to `toId`: my own median for the pair, else the estimate from the distance, else unknown. */
function flightSec(ctx: RouteCtx, fromId: number | null, toId: number): number | null {
  if (fromId === null) return null;
  const ownSec = ctx.ownMedian.get(pairKey(fromId, toId));
  if (ownSec !== undefined && ownSec > 0) return ownSec;
  const distanceGm = ctx.distances.get(distKey(fromId, toId)) ?? null;
  return distanceGm === null ? null : travelSec(distanceGm, ctx.settings.quantumSpeedKkms, ctx.settings.overheadMin);
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
  const sec = Math.max(elapsedSec, routeSec ?? 0);
  return sec > 0 ? `≈ ${formatCompact((profit * SEC_PER_HOUR) / sec)}/ч` : null;
}

/**
 * What the small strip shows: the current location without a run; during a run its timer, the cargo,
 * the target terminal, what the first commodity is expected to sell for there and the expected UEC per
 * hour. A target that is unset or missing from the reference leaves the last three out.
 */
export function stripModel(active: RunWithEvents | null, m: Market, ref: Reference, s: Settings, ctx: RouteCtx): StripModel {
  if (active === null) return { kind: 'idle', location: locationOf(ref, s.currentTerminalId) };

  const { run, events } = active;
  const elapsedSec = Math.max(0, ctx.now - run.startedAt);
  const cargo = cargoOf(events);
  const timer = formatDuration(elapsedSec);
  const cargoLine = cargoText(ref, cargo);

  const target = s.targetTerminalId === null ? undefined : ref.terminals.get(s.targetTerminalId);
  if (!target) return { kind: 'run', timer, cargo: cargoLine, target: null, expect: null, rate: null };

  const priced = cargo.map((line): PricedLine => ({ line, sell: estimate(m, target.id, line.commodityId, 'sell', ctx) }));
  const firstSell = priced[0]?.sell ?? null;
  const originId = events.find(e => e.type === 'buy')?.terminalId ?? null;
  return {
    kind: 'run', timer, cargo: cargoLine,
    target: terminalLabel(target),
    expect: firstSell ? expectText(firstSell) : null,
    rate: rateText(priced, elapsedSec, flightSec(ctx, originId, target.id)),
  };
}
