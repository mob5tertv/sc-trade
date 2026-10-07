import { isRateLimit, isUnreachable } from './uex-client';

// A sync that is made of many requests must not go on asking when UEX cannot be reached: every request then costs the whole
// timeout (15 s), and the queue of UEX is held for all that time. `Outage` counts how the requests of one series ended; the
// series asks it before every request.

/** Failures of the network in a row after which a series of requests gives up. */
export const NETWORK_FAILURES_IN_A_ROW = 3;

export class Outage {
  #streak = 0;
  #limited = false;

  /** How many requests in a row ended in a failure of the network (or in the answer "too many requests"). */
  get streak(): number {
    return this.#streak;
  }

  /** True when UEX answered "too many requests" (HTTP 429): it asks to wait, and the series stops at once. */
  get limited(): boolean {
    return this.#limited;
  }

  /** True when the series has to stop: UEX asked to wait, or the network failed `NETWORK_FAILURES_IN_A_ROW` times in a row. */
  get over(): boolean {
    return this.#limited || this.#streak >= NETWORK_FAILURES_IN_A_ROW;
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
}
