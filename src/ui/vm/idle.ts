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
}

/**
 * Whether the expanded window folds into the mini bar by itself: only when it is expanded, the time is
 * not switched off, the cursor is away, the whole time has passed since the last activity, and neither
 * the keyboard nor a dialog holds the window.
 */
export function shouldCollapse(i: IdleInput): boolean {
  if (i.mode !== 'expanded' || i.idleSec <= 0) return false;
  if (i.pointerInside || i.keyboardHeld || i.busy) return false;
  return i.now - i.lastActivityAt >= i.idleSec;
}
