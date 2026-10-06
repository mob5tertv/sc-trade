/**
 * Swallows the auto-repeat of a key that was already held down before the panel got the focus.
 *
 * The player holds `F` in the game (that is how the game shows its cursor) and clicks the strip:
 * the panel opens while `F` is still down, and Windows keeps repeating it into the panel. A key may
 * type only after it was pressed inside the window, so a repeat of a key we never saw go down is
 * ignored. Typing is unaffected: a key pressed in the window is marked, so its own repeats pass.
 */
export interface HeldKeyGuard {
  /** Forget everything: call it each time the panel opens or the window gains the focus. */
  reset(): void;
  /** True when this keydown must be dropped. A fresh press marks its key and is never dropped. */
  shouldSwallow(event: { code: string; repeat: boolean }): boolean;
  /** The key went up: its next repeat (if any) belongs to a press we did not see. */
  released(code: string): void;
}

export function createHeldKeyGuard(): HeldKeyGuard {
  const pressedHere = new Set<string>();
  return {
    reset: () => pressedHere.clear(),
    shouldSwallow({ code, repeat }) {
      if (!repeat) {
        pressedHere.add(code);
        return false;
      }
      return !pressedHere.has(code);
    },
    released: (code) => {
      pressedHere.delete(code);
    },
  };
}
