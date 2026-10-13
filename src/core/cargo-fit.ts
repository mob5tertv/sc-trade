import type { Terminal, Vehicle } from './types';

// What the selected ship can do at a terminal (spec 14.19, item 10): which boxes to ask the kiosk for, and whether the ship
// can be loaded there at all. Both rest on what UEX says of the terminal and of the ship; where it says nothing, nothing is
// claimed.

/** `any`: every box the terminal sells fits the ship; `upTo`: boxes larger than `scu` do not fit it, so that is what to set at the kiosk. */
export type BoxAdvice = { kind: 'any' } | { kind: 'upTo'; scu: number };

/** The largest box of a list of sizes; `null` for an empty or absent list (unknown). */
const largest = (sizes: number[] | undefined): number | null => (sizes === undefined || sizes.length === 0 ? null : Math.max(...sizes));

/**
 * Which boxes to buy at `terminal` for `vehicle`: the largest box the terminal sells against the largest the ship takes.
 * `null` when either is unknown (no data of UEX for the terminal or the ship, or a ship typed in by hand): then no line is shown.
 * It is arithmetic by sizes, not a check that the boxes fit the grid of the hold.
 */
export function boxAdvice(
  terminal: Pick<Terminal, 'maxContainerScu'> | undefined, vehicle: Pick<Vehicle, 'containerScu'> | undefined,
): BoxAdvice | null {
  const shipMax = largest(vehicle?.containerScu);
  const terminalMax = terminal?.maxContainerScu ?? null;
  if (shipMax === null || terminalMax === null || !(terminalMax > 0)) return null;
  return terminalMax <= shipMax ? { kind: 'any' } : { kind: 'upTo', scu: shipMax };
}

/** 'Ящики: любые' or 'Ящики: до 8 SCU'; `null` without an advice. */
export function boxLine(advice: BoxAdvice | null): string | null {
  if (advice === null) return null;
  return advice.kind === 'any' ? 'Ящики: любые' : `Ящики: до ${advice.scu} SCU`;
}

/**
 * Why `vehicle` cannot be loaded at `terminal`, in a few words, or `null` when nothing says it cannot. The one rule that the
 * data of UEX states plainly: a ship that is loaded at an external loading dock (the Hull C and its kind) needs a terminal that
 * has one. A ship UEX does not describe, or one typed in by hand, is never refused.
 */
export function loadingBar(terminal: Pick<Terminal, 'hasLoadingDock'> | undefined, vehicle: Pick<Vehicle, 'isLoadingDock'> | undefined): string | null {
  if (terminal === undefined || vehicle === undefined || vehicle.isLoadingDock !== true) return null;
  return terminal.hasLoadingDock ? null : 'нет грузового дока';
}
