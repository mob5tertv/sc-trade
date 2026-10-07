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
  /** The player went to the game by himself: there are no holders now and the focus is not pulled back. */
  drop(): Promise<void>;
  /** At least one holder is there. */
  readonly held: boolean;
}

/**
 * `onChange` is told each time `held` flips. When an effect throws, the state is made consistent first
 * (a failed `take` forgets its holder, a failed `give` still counts as given) and the error goes to the caller.
 */
export function createKeyboardHolds(effects: HoldEffects, onChange?: (held: boolean) => void): KeyboardHolds {
  const holders = new Set<string>();
  const queue = createRequestQueue();

  return {
    hold: (why) =>
      queue(async () => {
        if (holders.has(why)) return;
        const first = holders.size === 0;
        holders.add(why);
        if (!first) return;
        onChange?.(true);
        try {
          await effects.take();
        } catch (err) {
          // nothing else can have joined while the take was running: the queue lets one request at a time in
          holders.delete(why);
          onChange?.(false);
          throw err;
        }
      }),

    release: (why) =>
      queue(async () => {
        if (!holders.delete(why) || holders.size > 0) return;
        onChange?.(false);
        await effects.give(true);
      }),

    drop: () =>
      queue(async () => {
        if (holders.size === 0) return;
        holders.clear();
        onChange?.(false);
        await effects.give(false);
      }),

    get held() {
      return holders.size > 0;
    },
  };
}
