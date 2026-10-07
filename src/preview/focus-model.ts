// "Who holds the keyboard": the game or the overlay. This is the whole model behind `remember_foreground`,
// `restore_foreground`, `set_focus`, `set_focusable` and `is_focused`. It decides; the caller sends the
// `tauri://focus` / `tauri://blur` event that Tauri would send when the answer is not `null`.

export type KeyboardOwner = 'game' | 'overlay';
export type FocusEvent = 'focus' | 'blur';

export interface FocusState {
  keyboard: KeyboardOwner;
  /** The window may take the focus (it is not a never-activating badge). */
  focusable: boolean;
  /** How many times `remember_foreground` stored the game window (a call made while the overlay held the keyboard stores nothing). */
  gameRemembered: number;
  /** How many times `restore_foreground` gave the focus back to the game and Windows accepted it. */
  focusReturnedToGame: number;
}

export interface FocusModel {
  state(): FocusState;
  isFocused(): boolean;
  /** `remember_foreground`: the window that has the keyboard now is the game. */
  remember(): void;
  /** `restore_foreground`: the keyboard goes back to the remembered game window, if there is one. */
  restore(): { restored: boolean; event: FocusEvent | null };
  /**
   * The overlay takes the keyboard when it can (focusable and on screen). Windows gives it to a window in three
   * ways: `set_focus`, showing the window, and a mouse press inside it. A window that cannot take the focus
   * (the strip) gets it in none of them.
   */
  take(onScreen: boolean): FocusEvent | null;
  setFocusable(focusable: boolean): void;
  /** The player clicks the game: the overlay loses the keyboard by itself. */
  clickGame(): FocusEvent | null;
  /** The window disappears from the screen: whatever it held goes to the game. */
  leaveScreen(): FocusEvent | null;
}

export function createFocusModel(): FocusModel {
  let keyboard: KeyboardOwner = 'game';
  let focusable = true;
  let gameRemembered = 0;
  let focusReturnedToGame = 0;
  /** A game window is known to hand the focus back to. */
  let gameKnown = false;

  const toGame = (): FocusEvent | null => {
    if (keyboard === 'game') return null;
    keyboard = 'game';
    return 'blur';
  };

  return {
    state: () => ({ keyboard, focusable, gameRemembered, focusReturnedToGame }),
    isFocused: () => keyboard === 'overlay',
    remember() {
      // The Rust side never remembers its own window: while the overlay holds the keyboard, nothing is stored.
      if (keyboard !== 'game') return;
      gameKnown = true;
      gameRemembered++;
    },
    restore() {
      if (!gameKnown) return { restored: false, event: null };
      focusReturnedToGame++;
      return { restored: true, event: toGame() };
    },
    take(onScreen) {
      if (!focusable || !onScreen || keyboard === 'overlay') return null;
      keyboard = 'overlay';
      return 'focus';
    },
    setFocusable(value) {
      focusable = value;
    },
    clickGame: toGame,
    leaveScreen: toGame,
  };
}
