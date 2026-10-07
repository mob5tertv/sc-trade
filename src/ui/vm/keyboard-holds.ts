import { createRequestQueue } from './request-queue';

/**
 * Who needs the keyboard, and when the window takes it from the game and gives it back.
 *
 * The overlay never takes the keyboard focus from the game by itself: buttons and rows are clicked
 * with the mouse and the game stays the active window. The keyboard is needed only while the player
 * edits a text field. Whoever needs it is a "holder" with a name ('field', ...). The first holder
 * takes the keyboard (remembers the window that had it, makes the overlay focusable, focuses it), the
 * last one gives it back (not focusable again, the remembered window gets the focus).
 *
 * Every request runs strictly after the previous one, so a `take` and a `give` are never in flight
 * together, and each request judges the state when its own turn comes.
 */
export interface HoldEffects {
  /** Remember the window that has the focus, then take the keyboard. */
  take(): Promise<void>;
  /** Stop taking the keyboard; `restore` hands the focus back to the remembered window. */
  give(restore: boolean): Promise<void>;
}

export interface KeyboardHolds {
  /** `why` needs the keyboard. The first holder takes it; a holder that is already there changes nothing. */
  hold(why: string): Promise<void>;
  /** `why` does not need the keyboard any more. The last holder to leave gives it back to the game. */
  release(why: string): Promise<void>;
  /**
   * The window lost the focus and it was the player who took it away (he clicked the game): there are no holders
   * now and the focus is not pulled back. Resolves to `true` when the holders were dropped.
   *
   * It is IGNORED (resolves to `false`) when the loss is only the echo of our own focus juggling: a request is being
   * taken care of (a take or a give is queued or running) or one finished less than `settleMs` ago. The blur that a
   * `give` causes arrives later than the `give` itself, and a new `take` may already be under way by then; dropping
   * the holder it is taking would leave the player typing into the game. The decision is made when `drop` is called,
   * not when the queue gets to it.
   */
  drop(): Promise<boolean>;
  /** At least one holder is there. */
  readonly held: boolean;
}

export interface KeyboardHoldsOptions {
  /** How long after a take or give a loss of the focus still counts as its echo. 0 (default): not at all. */
  settleMs?: number;
  /** The clock in milliseconds; for tests. */
  now?: () => number;
}

/**
 * `onChange` is told each time `held` flips. When an effect throws, the state is made consistent first
 * (a failed `take` forgets its holder, a failed `give` still counts as given) and the error goes to the caller.
 */
export function createKeyboardHolds(
  effects: HoldEffects,
  onChange?: (held: boolean) => void,
  options: KeyboardHoldsOptions = {},
): KeyboardHolds {
  const settleMs = options.settleMs ?? 0;
  const now = options.now ?? Date.now;
  const holders = new Set<string>();
  const queue = createRequestQueue();
  /** Requests that are queued or running: the focus is being moved by us right now, whatever blur comes belongs to that. */
  let pending = 0;
  /** When the last take or give ended; only an effect that really ran counts. */
  let effectEndedAt = Number.NEGATIVE_INFINITY;

  const request = <T>(job: () => Promise<T>): Promise<T> => {
    pending++;
    return queue(job).finally(() => {
      pending--;
    });
  };

  /** Runs a take or a give and remembers when it ended, whether it worked or not. */
  const run = async (effect: () => Promise<void>): Promise<void> => {
    try {
      await effect();
    } finally {
      effectEndedAt = now();
    }
  };

  return {
    hold: (why) =>
      request(async () => {
        if (holders.has(why)) return;
        const first = holders.size === 0;
        holders.add(why);
        if (!first) return;
        onChange?.(true);
        try {
          await run(() => effects.take());
        } catch (err) {
          // nothing else can have joined while the take was running: the queue lets one request at a time in
          holders.delete(why);
          onChange?.(false);
          throw err;
        }
      }),

    release: (why) =>
      request(async () => {
        if (!holders.delete(why) || holders.size > 0) return;
        onChange?.(false);
        await run(() => effects.give(true));
      }),

    drop: async () => {
      if (pending > 0 || holders.size === 0 || now() - effectEndedAt < settleMs) return false;
      return request(async () => {
        if (holders.size === 0) return false;
        holders.clear();
        onChange?.(false);
        await run(() => effects.give(false));
        return true;
      });
    },

    get held() {
      return holders.size > 0;
    },
  };
}
