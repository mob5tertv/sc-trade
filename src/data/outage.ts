import { isRateLimit, isUnreachable } from './uex-client';

// A sync that is made of many requests must not go on asking when UEX does not serve it: every request then costs the whole
// timeout (15 s), or a slow 5xx answer of the CDN in front of UEX, and the queue of UEX is held for all that time. `Outage`
// watches how the series ends its requests and its units of work (a batch of terminals, the vehicles of a manufacturer);
// the series asks it before every one.
//
// Three reasons to stop:
//  - the network failed `NETWORK_FAILURES_IN_A_ROW` times in a row (no answer, a timeout);
//  - UEX answered "too many requests" (HTTP 429): it asks to wait, and the series stops at once;
//  - `EMPTY_UNITS_IN_A_ROW` units in a row yielded nothing, whatever the kind of the failure: UEX answers, but gives nothing (a
//    CDN that is down answers 521, 522, 524, and the repeat terminal by terminal of every batch would only triple the load).

/** Failures of the network in a row after which a series of requests gives up. */
export const NETWORK_FAILURES_IN_A_ROW = 3;

/** Units of work in a row that brought nothing in, of any kind of failure, after which a series gives up. */
export const EMPTY_UNITS_IN_A_ROW = 3;

export type OutageReason = 'limit' | 'network' | 'nothing';

export class Outage {
  #streak = 0;
  #limited = false;
  #empty = 0;

  /** How many requests in a row ended in a failure of the network (or in the answer "too many requests"). */
  get streak(): number {
    return this.#streak;
  }

  /** True when UEX answered "too many requests" (HTTP 429): it asks to wait, and the series stops at once. */
  get limited(): boolean {
    return this.#limited;
  }

  /** Why the series has to stop, or `null` while it may go on. */
  get reason(): OutageReason | null {
    if (this.#limited) return 'limit';
    if (this.#streak >= NETWORK_FAILURES_IN_A_ROW) return 'network';
    if (this.#empty >= EMPTY_UNITS_IN_A_ROW) return 'nothing';
    return null;
  }

  /** True when the series has to stop. */
  get over(): boolean {
    return this.reason !== null;
  }

  /** A request went through. */
  reached(): void {
    this.#streak = 0;
  }

  /**
   * A request failed with `err`. A failure of the network adds to the count; any other failure (the server refused, the
   * answer was unreadable) means that UEX did answer, so the network works and the count starts again. The answer "too many
   * requests" counts as a failure of the network (nobody serves us now) and ends the series.
   */
  failed(err: unknown): void {
    this.#streak = isUnreachable(err) ? this.#streak + 1 : 0;
    if (isRateLimit(err)) this.#limited = true;
  }

  /**
   * A unit of work ended (a batch of terminals with its repeat one by one, the vehicles of a manufacturer). `yielded` says
   * whether it brought anything in; a unit that did starts the count of empty ones again.
   */
  unit(yielded: boolean): void {
    this.#empty = yielded ? 0 : this.#empty + 1;
  }
}
