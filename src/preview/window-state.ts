import { createFocusModel, type KeyboardOwner } from './focus-model';

// The one overlay window of the application as the preview knows it. The state lives in this one object,
// and every change is handed to `onChange` (the entry sends it to the desktop page). Numbers are PHYSICAL pixels.

export interface Point { x: number; y: number }
export interface Dimension { width: number; height: number }

export interface WindowSnapshot {
  visible: boolean;
  /** The application asked to close its window (`quit`): the preview shows nothing from then on. */
  closed: boolean;
  position: Point;
  size: Dimension;
  focusable: boolean;
  ignoreCursorEvents: boolean;
  skipTaskbar: boolean;
  keyboard: KeyboardOwner;
  /** How many times the game window was remembered: the `remember_foreground` calls the Rust side would store. */
  gameRemembered: number;
  /** How many times the focus was handed back to the game: the `restore_foreground` calls that worked. */
  focusReturnedToGame: number;
}

export interface PreviewWindowOptions {
  onChange?: (snapshot: WindowSnapshot) => void;
  /** The focus moved to the overlay (`true`) or away from it (`false`); the caller sends the Tauri event. */
  onFocus?: (focused: boolean) => void;
}

export interface PreviewWindow {
  snapshot(): WindowSnapshot;
  setSize(size: Dimension): void;
  setPosition(position: Point): void;
  /** `place_window`: position and size change together, in one report (never a frame with only one of them). */
  place(rect: Point & Dimension): void;
  show(): void;
  hide(): void;
  close(): void;
  setFocusable(focusable: boolean): void;
  setFocus(): void;
  isFocused(): boolean;
  setSkipTaskbar(skip: boolean): void;
  setIgnoreCursorEvents(ignore: boolean): void;
  rememberForeground(): void;
  restoreForeground(): boolean;
  /** The player clicks the game: an overlay that holds the keyboard loses it. */
  clickGame(): void;
  /** The player presses a mouse button inside the window: a window that can take the focus gets the keyboard. */
  pressInside(): void;
}

/** The window as `tauri.conf.json` creates it: hidden, 240x26, off the taskbar. */
export function createPreviewWindow(options: PreviewWindowOptions = {}): PreviewWindow {
  const focus = createFocusModel();
  let visible = false;
  let closed = false;
  let position: Point = { x: 0, y: 0 };
  let size: Dimension = { width: 240, height: 26 };
  let ignoreCursorEvents = false;
  let skipTaskbar = true;

  const snapshot = (): WindowSnapshot => {
    const { keyboard, focusable, gameRemembered, focusReturnedToGame } = focus.state();
    return {
      visible, closed, position: { ...position }, size: { ...size },
      focusable, ignoreCursorEvents, skipTaskbar, keyboard, gameRemembered, focusReturnedToGame,
    };
  };

  /** Sends the focus event of a change, then the new state: the page sees both at once. */
  const changed = (event: 'focus' | 'blur' | null = null): void => {
    if (event !== null) options.onFocus?.(event === 'focus');
    options.onChange?.(snapshot());
  };

  /** Runs `update` and reports only when it changed something that the snapshot shows. */
  const apply = (update: () => 'focus' | 'blur' | null | void): void => {
    const before = JSON.stringify(snapshot());
    const event = update() ?? null;
    if (event !== null || JSON.stringify(snapshot()) !== before) changed(event);
  };

  return {
    snapshot,
    setSize: (next) => apply(() => { size = { width: next.width, height: next.height }; }),
    setPosition: (next) => apply(() => { position = { x: next.x, y: next.y }; }),
    place: (rect) => apply(() => {
      position = { x: rect.x, y: rect.y };
      size = { width: rect.width, height: rect.height };
    }),
    // a shown window is activated, unless it cannot take the focus
    show: () => apply(() => {
      if (closed) return null;
      visible = true;
      return focus.take(true);
    }),
    hide: () => apply(() => {
      visible = false;
      return focus.leaveScreen();
    }),
    close: () => apply(() => {
      closed = true;
      visible = false;
      return focus.leaveScreen();
    }),
    setFocusable: (value) => apply(() => { focus.setFocusable(value); }),
    setFocus: () => apply(() => focus.take(visible)),
    isFocused: () => focus.isFocused(),
    setSkipTaskbar: (value) => apply(() => { skipTaskbar = value; }),
    setIgnoreCursorEvents: (value) => apply(() => { ignoreCursorEvents = value; }),
    rememberForeground: () => apply(() => focus.remember()),
    restoreForeground() {
      let restored = false;
      apply(() => {
        const result = focus.restore();
        restored = result.restored;
        return result.event;
      });
      return restored;
    },
    clickGame: () => apply(() => focus.clickGame()),
    // a window that lets the clicks through never gets the press
    pressInside: () => apply(() => focus.take(visible && !ignoreCursorEvents)),
  };
}
