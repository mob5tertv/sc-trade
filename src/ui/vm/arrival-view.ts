import type { Side } from '../../core/types';

// What the window shows once a mark has been written (spec 14.12): the arrival at a target terminal makes it the place the
// ship stands and the terminal the window looks at, so the player sees everything local at once. The decision is made here;
// `state.svelte.ts` only carries it out, once the run and the market have been read again.

/** What to change on screen after a mark; `null` in a field means "leave it as it is". */
export interface ArrivalView {
  /** The terminal to save as the current location; `null` when the ship is there already, or nothing is changed. */
  locateAt: number | null;
  /** The terminal to show in the header and in the Terminal section; `null` when the view stays where it is. */
  show: number | null;
  /** The side of the table to ask for (the usual rule still moves it to the other side when this one has no rows); `null`: as usual. */
  preferSide: Side | null;
}

const UNTOUCHED: ArrivalView = { locateAt: null, show: null, preferSide: null };

/**
 * After a mark that was WRITTEN: only an arrival with a target changes anything. The target becomes the location (unless the
 * ship is there already) and the viewed terminal (even then: the player may have been looking at another one), on the "sell"
 * side when there is cargo aboard, since that is what is done at the target next. The target itself is not taken away.
 */
export function arrivalView(
  type: 'depart' | 'arrive', targetTerminalId: number | null, cargoAboard: boolean, currentTerminalId: number | null,
): ArrivalView {
  if (type !== 'arrive' || targetTerminalId === null) return UNTOUCHED;
  return {
    locateAt: currentTerminalId === targetTerminalId ? null : targetTerminalId,
    show: targetTerminalId,
    preferSide: cargoAboard ? 'sell' : null,
  };
}
