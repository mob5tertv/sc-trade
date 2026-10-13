import { estimate } from '../../core/estimate';
import type { RouteCtx } from '../../core/routes';
import { cargoOf } from '../../core/run';
import { sellOrContinue, type SellAlternative, type SellHere } from '../../core/sell';
import type { CargoLine, Market, Reference, RunEvent, RunWithEvents } from '../../core/types';
import { phaseName } from './run-phase';
import { ratePerHour } from './run-rate';
import type { StripModel } from './strip';
import { terminalName } from './terminal-name';
import { isOwnPrice } from './terminal-rows';

// What the "Рейс" section says (spec 14.7, 15c): when it is there, what its header reads, and where the choice
// "sell here or fly on" is offered. Pure; the section itself is `sections/RunSection.svelte`.

export type RunStripModel = Extract<StripModel, { kind: 'run' }>;

/**
 * The section is there while a run goes on (`run`), and while a target is set before anything is bought (`plan`: it
 * shows the target and says where the timer starts). Nothing to show without either.
 */
export function runSectionKind(model: StripModel): 'run' | 'plan' | null {
  if (model.kind === 'run') return 'run';
  return model.target === null ? null : 'plan';
}

export interface RunHeader {
  /** 'Погрузка 3:12 · MEDS 120 SCU, STIM 80 SCU': the phase with its own timer, then what is in the hold. */
  summary: string;
  /** '→ ARC-L1', or 'цель не выбрана': the target is always said, so it stands apart from the summary that is cut. */
  target: string;
  /** Everything of the header, for the tooltip, and the whole time of the run. */
  title: string;
}

export function runHeader(model: RunStripModel): RunHeader {
  const summary = [`${phaseName(model.phase)} ${model.phaseTimer}`, model.cargo].filter((part) => part !== '').join(' · ');
  const target = model.target === null ? 'цель не выбрана' : `→ ${model.target}`;
  return { summary, target, title: `${summary} · ${target} · всего ${model.timer}` };
}

/** The summary of the header while only the target is set; a target in two steps says both: where to buy, then where to sell. */
export const planSummary = (target: string, then: string | null = null): string => (
  then === null ? `цель: ${target}` : `закупка: ${target} · потом ${then}`
);

/** The button of the header that makes the viewed terminal the target of the run: where it points and what it says. */
export interface TargetOffer {
  terminalId: number;
  /** 'Цель: ARC-L1': the button. */
  label: string;
  /** What a click does, in a tooltip. */
  title: string;
}

/**
 * The target from the section itself: while a run goes on WITHOUT a target, the terminal that is viewed can be made the target
 * by one click (the same `setTarget` as the "Цель" button of an option). Not offered at the terminal of the first purchase (the run
 * is not flying there), without a viewed terminal or one the reference does not know (the strip would show no target for it), and
 * not when a target is set (the header names it and has its cross). No run, no offer: the plan has its target already.
 */
export function targetOffer(active: RunWithEvents | null, targetId: number | null, viewedId: number | null, ref: Reference): TargetOffer | null {
  if (active === null || targetId !== null || viewedId === null) return null;
  const terminal = ref.terminals.get(viewedId);
  if (terminal === undefined) return null;
  const firstBuy = active.events
    .filter((e) => e.type === 'buy')
    .reduce<RunEvent | null>((first, e) => (first === null || e.ts < first.ts || (e.ts === first.ts && e.id < first.id) ? e : first), null);
  if (firstBuy?.terminalId === viewedId) return null;
  const name = terminalName(terminal);
  return { terminalId: viewedId, label: `Цель: ${name}`, title: `Сделать целью рейса: ${name}` };
}

/** The code a commodity is known by; a commodity that left the reference is told by its number. */
const codeOf = (ref: Reference, commodityId: number): string => {
  const commodity = ref.commodities.get(commodityId);
  return commodity ? commodity.code || commodity.name : `#${commodityId}`;
};

/** The hold line by line for the card of the run: what is left of each commodity and what it cost on average. */
export function cargoRows(events: RunWithEvents['events'], ref: Reference): Array<{ code: string; scu: number; avgBuyPrice: number }> {
  return cargoOf(events).map((line) => ({ code: codeOf(ref, line.commodityId), scu: line.scu, avgBuyPrice: line.avgBuyPrice }));
}

// ---- sell here or fly on ----------------------------------------------------------------------------------------

export interface SellDecision {
  commodityId: number;
  code: string;
  /** Where the player stands (the viewed terminal) and the price of his own there, the one the sale would be at. */
  terminalId: number;
  actualPrice: number;
  line: CargoLine;
  /** Seconds since the run began, the time "here" is counted over. */
  elapsedSec: number;
  here: SellHere;
  /** At most three other buyers, the one whose further leg earns the most per hour first. */
  alternatives: SellAlternative[];
}

/**
 * The choice "sell here or fly on" for every commodity of the hold that has a price of my own, not cold, on the SALE side
 * of the VIEWED terminal: that price is the real one, the alternatives are compared with it. A price of UEX or a cold one is
 * not enough: it is the player who says what he sees there. What the terminal already holds limits nothing (spec 14.5).
 */
export function sellDecisions(active: RunWithEvents | null, m: Market, ref: Reference, viewedId: number | null, ctx: RouteCtx): SellDecision[] {
  if (active === null || viewedId === null) return [];
  const elapsedSec = Math.max(0, ctx.now - active.run.startedAt);
  const decisions: SellDecision[] = [];
  for (const line of cargoOf(active.events)) {
    const price = estimate(m, viewedId, line.commodityId, 'sell', ctx);
    if (price === null || !isOwnPrice(price)) continue;
    const { here, alternatives } = sellOrContinue(m, line, viewedId, price.price, elapsedSec, ctx);
    decisions.push({
      commodityId: line.commodityId, code: codeOf(ref, line.commodityId),
      terminalId: viewedId, actualPrice: price.price, line, elapsedSec, here, alternatives,
    });
  }
  return decisions;
}

/**
 * The decision as it stands `elapsedSec` after the run began. The alternatives depend on the market, the viewed terminal, the
 * cargo and the price, and are counted when those change (`sellDecisions`): what flying on adds, and over what time, is the same
 * whatever the clock says (spec 14.19). Only the rate of selling HERE follows the clock: the profit over the time already
 * spent, with the very formula of the core (`perHour` in core/sell.ts).
 */
export function decisionAtClock(d: SellDecision, elapsedSec: number): SellDecision {
  const elapsed = Math.max(0, elapsedSec);
  return { ...d, elapsedSec: elapsed, here: { ...d.here, uecPerHour: ratePerHour(d.here.profit, elapsed) } };
}

/** What is written to the log (`sell`, debug) for one calculation: the sale on the spot and every option it was compared with. */
export function sellLogContext(d: SellDecision): Record<string, unknown> {
  return {
    terminalId: d.terminalId, commodityId: d.commodityId, scu: d.line.scu, avgBuyPrice: d.line.avgBuyPrice,
    price: d.actualPrice, elapsedSec: d.elapsedSec,
    here: { profit: d.here.profit, roi: d.here.roi, uecPerHour: d.here.uecPerHour },
    alternatives: d.alternatives.map((a) => ({
      terminalId: a.destId, price: a.sell.price, low: a.sell.low, high: a.sell.high, source: a.sell.source,
      extraSec: a.extraSec, extraSource: a.extraSource, profit: a.expectedProfit,
      extraProfit: a.extraProfit, extraProfitLow: a.extraProfitLow, extraUecPerHour: a.extraUecPerHour,
    })),
  };
}

/**
 * What the decisions are about, without the clock: the same text while the same thing is being decided (the same
 * place, commodity, price and cargo), another when any of them changes. The log gets one line per decision, not one
 * per second.
 */
export const sellDecisionKey = (decisions: SellDecision[]): string => (
  decisions.map((d) => [d.terminalId, d.commodityId, d.actualPrice, d.line.scu, Math.round(d.line.avgBuyPrice)].join(':')).join('|')
);
