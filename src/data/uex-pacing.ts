import { UEX_MIN_GAP_MS, type UexPacing } from './uex-client';

// The pacing of the application's own UEX client (`createUexClient` takes it as its last argument): the real timer, and the
// gap UEX asks for (120 requests a minute). The client itself never sets a timer; this is the one place where the wait comes
// from. Tests and the fakes do not use it: a client created without pacing keeps no gap.

let minGapMs = UEX_MIN_GAP_MS;

/** Resolves after `ms` milliseconds. */
export const timerSleep = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

/** What the application hands to `createUexClient`. */
export const appPacing = (): UexPacing => ({ sleep: timerSleep, minGapMs });

/**
 * Changes the gap of the clients created from now on. The preview sets it to 0: its network is a fake that answers at once,
 * and there is no UEX to be kind to, so the gap would only make every scene slower.
 */
export function setAppMinGapMs(ms: number): void {
  minGapMs = ms;
}
