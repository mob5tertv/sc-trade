export interface IdleInput {
  mode: 'mini' | 'expanded';
  /** The player's setting: seconds without activity before the window collapses by itself; 0 or less: never. */
  idleSec: number;
  /** Unix seconds. */
  now: number;
  /** The cursor is over the window. */
  pointerInside: boolean;
  /** Unix seconds of the last click or movement over the window, or of the moment it was expanded. */
  lastActivityAt: number;
  /** The keyboard is with the window: the player is typing. */
  keyboardHeld: boolean;
  /** Something needs the window to stay (a dialog is open, the settings are open). */
  busy: boolean;
  /**
   * The start has failed: the window unfolded to say so and waits for «Повторить». Whatever the setting of the mini line says,
   * it stays: folded, it would be hidden with that line off, and the player would lose the error.
   */
  startFailed: boolean;
}

/**
 * Whether the expanded window folds into the mini bar by itself: only when it is expanded, the time is
 * not switched off, the cursor is away, the whole time has passed since the last activity, and neither
 * the keyboard, a dialog nor a failed start holds the window. (The minus button folds it whenever the player wants.)
 */
export function shouldCollapse(i: IdleInput): boolean {
  if (i.mode !== 'expanded' || i.idleSec <= 0) return false;
  if (i.pointerInside || i.keyboardHeld || i.busy || i.startFailed) return false;
  return i.now - i.lastActivityAt >= i.idleSec;
}
