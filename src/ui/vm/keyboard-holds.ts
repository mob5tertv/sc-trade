import { createRequestQueue } from './request-queue';

/**
 * Who needs the keyboard, and when the window takes it from the game and gives it back.
 *
 * The overlay never takes the keyboard focus from the game by itself: buttons and rows are clicked
 * with the mouse and the game stays the active window. The keyboard is needed only while the player
 * edits a text field. Whoever needs it is a "holder" with a name ('field', ...).
 *
 * The window gets the keyboard by the player's own click, the way any window does, not by a call that
 * Windows may refuse (and nothing synthetic is ever sent to make Windows agree). For that it is made
 * activatable while the pointer is over a text field. Three states:
 *  - `idle`: the window cannot be activated; clicks on buttons and rows leave the game active;
 *  - `armed`: the pointer is over a text field and nobody holds the keyboard: the window can be
 *    activated, so a press on the field activates it;
 *  - `held`: at least one holder is there.
 *
 *   state | event                        | effects                                   | next
 *   ------+------------------------------+-------------------------------------------+---------------
 *   idle  | pointer comes over a field   | arm                                       | armed
 *   idle  | hold                         | take                                      | held
 *   idle  | press next to a field        | (only within `settleMs` of a disarm:)     | idle
 *         |                              | isForeground, and if yes give(true)       |
 *   armed | pointer leaves the field     | disarm                                    | idle
 *   armed | hold                         | take                                      | held
 *   armed | press next to a field        | isForeground, and if yes give(true), arm  | armed
 *   held  | pointer comes or leaves      | none (remembered for the release)         | held
 *   held  | hold by another holder       | none                                      | held
 *   held  | release, holders remain      | none                                      | held
 *   held  | release of the last holder   | give(true), then arm when the pointer is  | armed or idle
 *         |                              | still over a field                        |
 *   held  | drop (the player went away)  | give(false)                               | idle
 *
 * Everything else changes nothing (a release of somebody who is not a holder, a drop without holders, a
 * press next to a field while somebody holds the keyboard).
 *
 * Every request runs strictly after the previous one, so two effects are never in flight together,
 * and each request judges the state when its own turn comes.
 */
export interface HoldEffects {
  /**
   * The pointer came over a text field: remember the window that has the focus (after the click it will be our own)
   * and make the overlay activatable. Nothing is activated here: the player's press does that.
   */
  arm(): Promise<void>;
  /** The pointer left the field without a press: the overlay cannot be activated again. No focus was taken, none is returned. */
  disarm(): Promise<void>;
  /**
   * A field was pressed: remember the window that has the focus, make the overlay activatable and make sure it is the
   * foreground window. After a press on an armed window it already is; otherwise Windows is asked once and may refuse.
   */
  take(): Promise<void>;
  /** Stop taking the keyboard: the overlay cannot be activated; `restore` hands the focus back to the remembered window. */
  give(restore: boolean): Promise<void>;
  /** Whether the overlay is the foreground window: Windows' answer, not the focus of the page. */
  isForeground(): Promise<boolean>;
}

export type HoldState = 'idle' | 'armed' | 'held';

export interface KeyboardHolds {
  /** `why` needs the keyboard. The first holder takes it; a holder that is already there changes nothing. */
  hold(why: string): Promise<void>;
  /**
   * `why` does not need the keyboard any more. The last holder to leave gives it back to the game; when the pointer is
   * still over a text field the window is armed again, so that the next press on the field activates it.
   */
  release(why: string): Promise<void>;
  /**
   * The window lost the focus and it was the player who took it away (he clicked the game): there are no holders
   * now, the focus is not pulled back, and the window cannot be activated. Resolves to `true` when the holders were dropped.
   *
   * It is IGNORED (resolves to `false`) when the loss is only the echo of our own focus juggling: a request is being
   * taken care of (a take or a give is queued or running) or one finished less than `settleMs` ago. The blur that a
   * `give` causes arrives later than the `give` itself, and a new `take` may already be under way by then; dropping
   * the holder it is taking would leave the player typing into the game. The decision is made when `drop` is called,
   * not when the queue gets to it.
   */
  drop(): Promise<boolean>;
  /** The pointer came over a text field (`true`) or is not over one any more (`false`). Telling the same thing twice changes nothing. */
  pointerOverField(over: boolean): Promise<void>;
  /**
   * The player pressed something of the window that is not a text field. Usually that needs nothing. But a press that
   * comes right after the pointer left a field may have activated the window: the disarm had not reached Windows yet.
   * Nobody holds the keyboard then, so it would stay in the window. Hence: when nobody holds the keyboard and the window
   * is still armed, or was disarmed less than `settleMs` ago, Windows is asked whether the window is the foreground one,
   * and if it is, the keyboard goes back to the game at once. Resolves to `true` when it did.
   *
   * Outside that time a press makes no request at all. Whether to look is decided when it is called, like `drop`.
   */
  pressOutsideField(): Promise<boolean>;
  /** At least one holder is there. */
  readonly held: boolean;
  readonly state: HoldState;
}

export interface KeyboardHoldsOptions {
  /**
   * How long after a take or give a loss of the focus still counts as its echo, and how long after a disarm a press
   * next to a field is still checked for having activated the window. 0 (default): not at all.
   */
  settleMs?: number;
  /** The clock in milliseconds; for tests. */
  now?: () => number;
}

/**
 * `onChange` is told each time `held` flips. When an effect throws, the state is made consistent first
 * (a failed `take` forgets its holder, a failed `arm` is not armed, a failed `give` or `disarm` still counts as
 * done) and the error goes to the caller.
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
  /** The pointer is over a text field, as the page last said. */
  let over = false;
  /** The window was made activatable for the pointer over a field, and nobody holds the keyboard. */
  let armed = false;
  /** A disarm is on its way to Windows. */
  let disarming = false;
  /** When the last disarm ended. */
  let disarmedAt = Number.NEGATIVE_INFINITY;

  /** A request that may move the focus: while it is queued or running a loss of the focus is its echo (see `drop`). */
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

  /**
   * With nobody holding the keyboard the window is armed exactly while the pointer is over a field. Always called
   * inside a job of the queue. Arming and disarming move no focus, so they start no echo time.
   */
  const followPointer = async (): Promise<void> => {
    if (holders.size > 0 || armed === over) return;
    if (over) {
      armed = true;
      try {
        await effects.arm();
      } catch (err) {
        armed = false;
        throw err;
      }
      return;
    }
    armed = false;
    disarming = true;
    try {
      await effects.disarm();
    } finally {
      disarming = false;
      disarmedAt = now();
    }
  };

  return {
    hold: (why) =>
      request(async () => {
        if (holders.has(why)) return;
        const first = holders.size === 0;
        holders.add(why);
        if (!first) return;
        // from here on it is the holder that keeps the window activatable
        armed = false;
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
        // the pointer has not moved off the field: the next press on it must find the window activatable
        await followPointer();
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

    pointerOverField: (value) => {
      if (over === value) return Promise.resolve();
      over = value;
      // not a `request`: making the window activatable or not moves no focus, and must not pass for a take or a give
      return queue(followPointer);
    },

    pressOutsideField: async () => {
      if (holders.size > 0) return false;
      if (!armed && !disarming && now() - disarmedAt >= settleMs) return false;
      return request(async () => {
        // a field was pressed before this turn came: the window is active because the keyboard is wanted
        if (holders.size > 0) return false;
        if (!(await effects.isForeground())) return false;
        armed = false;
        await run(() => effects.give(true));
        await followPointer();
        return true;
      });
    },

    get held() {
      return holders.size > 0;
    },

    get state() {
      if (holders.size > 0) return 'held';
      return armed ? 'armed' : 'idle';
    },
  };
}
