// The trigger keys are global: the hook of the Rust side fires an assigned key wherever it is pressed. Pressing an assigned key in a key
// field of the settings, to give the action another key, would therefore fire the action (a mark written into a run, the window folded
// under the player's hands). So while a key field has the focus the keys are suspended and, when the focus is gone, applied again.
// This is the decision of when; what suspending and resuming are is the state's (`suspendTriggers`, `resumeTriggers`).

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
