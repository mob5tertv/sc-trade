// The trigger keys are global: the hook of the Rust side fires an assigned key wherever it is pressed. Pressing an assigned key in a key
// field of the settings, to give the action another key, would therefore fire the action (a mark written into a run, the window folded
// under the player's hands). So while a key field has the focus the keys are suspended and, when the focus is gone, applied again.
// This is the decision of when; what suspending and resuming are is the state's (`suspendTriggers`, `resumeTriggers`).

/**
 * Whether the set of trigger keys has to go to the Rust side at all: it has when a key is saved, or when something is bound still (the key
 * that was taken off must be unbound, and a set of no keys that follows a set of keys must say so). Nothing saved and nothing bound:
 * "no keys" would be said again, two calls and two lines of the log for every visit to a key field of the settings.
 */
export function bindNeeded(keys: Record<string, string>, somethingBound: boolean): boolean {
  return somethingBound || Object.values(keys).some((key) => key.trim() !== '');
}

/**
 * The errors that are shown next to the keys, with those of the keys that are not saved taken away. When the call is left out
 * (`bindNeeded` says no) nothing else resets them: a key that the Rust side refused, taken off in its field with Backspace, would leave its
 * error under an empty field. The same object comes back when there is nothing to take away.
 */
export function withoutErrorsOfEmptyKeys<K extends string>(keys: Record<K, string>, errors: Record<K, string | null>): Record<K, string | null> {
  const names = Object.keys(keys) as K[];
  if (names.every((name) => keys[name].trim() !== '' || errors[name] === null)) return errors;
  const next = { ...errors };
  for (const name of names) if (keys[name].trim() === '') next[name] = null;
  return next;
}

/**
 * Whether a hook may stand on the Rust side after `keys` were sent. A set with a key may have installed one, whether or not the call got
 * there; an EMPTY set takes it out only if it did get there (`reached`), otherwise what was bound before may still be: the flag stays as it
 * was, and the next call tries again. So the flag never says "nothing bound" while a hook that no saved key asks for may still be installed.
 */
export function boundAfter(keys: Record<string, string>, wasBound: boolean, reached: boolean): boolean {
  if (Object.values(keys).some((key) => key.trim() !== '')) return true;
  return reached ? false : wasBound;
}

export interface SuspensionActions {
  suspend(): void;
  resume(): void;
}

/** The clock the resume waits on; the real one is `setTimeout`. */
export interface Timers {
  set(run: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface TriggerSuspension {
  /** A key field got the focus. */
  focus(): void;
  /** A key field lost the focus; the keys come back a moment later, unless another key field has taken it by then. */
  blur(): void;
  /** The key fields are gone (the screen of the settings was closed, or the window folded) and no blur will tell: the keys come back now. */
  release(): void;
  readonly suspended: boolean;
}

/**
 * `delayMs` is the wait between the blur of one key field and the resume: from one field to the next (Tab, a click) the blur and the
 * focus come in one moment, and the keys must not be bound and taken out again between them.
 */
export function triggerSuspension(
  actions: SuspensionActions, delayMs = 50, timers: Timers = { set: (run, ms) => setTimeout(run, ms), clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) },
): TriggerSuspension {
  let suspended = false;
  let waiting: unknown = null;

  const stopWaiting = (): void => {
    if (waiting === null) return;
    timers.clear(waiting);
    waiting = null;
  };

  return {
    get suspended() {
      return suspended;
    },
    focus() {
      stopWaiting();
      if (suspended) return;
      suspended = true;
      actions.suspend();
    },
    blur() {
      if (!suspended || waiting !== null) return;
      waiting = timers.set(() => {
        waiting = null;
        suspended = false;
        actions.resume();
      }, delayMs);
    },
    release() {
      stopWaiting();
      if (!suspended) return;
      suspended = false;
      actions.resume();
    },
  };
}
