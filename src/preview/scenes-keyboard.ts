import { KEYBOARD_IDLE_MS } from '../ui/vm/keyboard-idle';
import type { Scene, SceneApp } from './scenes';

// The scenes of the keyboard: the player's ways to it, through the real listeners of `ui/keyboard.ts` and the strict
// Windows of the preview (`focus-model.ts`). `preview:sweep` loads them like every scene, so a way to the keyboard that
// stops working, or that calls a command it must not (the focus command of Tauri is not mocked, see `ipc.ts`), fails there:
// a scene checks what it shows and fails with what it found instead.
// The list is added to `SCENES` in `scenes.ts`.

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Waits until `done()` is true; a scene that waits for what never comes fails with what it waited for. */
async function until(what: string, done: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (!done()) {
    if (performance.now() > deadline) throw new Error(`the scene waited ${timeoutMs / 1000} s for ${what}`);
    await pause(25);
  }
}

export function element(selector: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(selector);
  if (found === null) throw new Error(`the scene wants "${selector}", and there is none`);
  return found;
}

/**
 * The pointer comes over the element, and a moment later presses it: the two events a mouse sends, in the order and
 * with the pause of a hand (the arm reaches the window before the press). The press of a mouse that has NOT been seen
 * coming is `--do "eval:…dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))"` on the picture command.
 */
export async function hoverAndPress(selector: string): Promise<void> {
  const target = element(selector);
  target.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
  await pause(60);
  target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  await pause(60);
}

/** A click on what is on the screen, the way a button handler sees it. */
async function click(selector: string): Promise<void> {
  element(selector).click();
  await pause(60);
}

/** The first element matching `selector` whose text has `text`. */
function withText(selector: string, text: string): HTMLElement {
  const found = [...document.querySelectorAll<HTMLElement>(selector)].find((el) => (el.textContent ?? '').includes(text));
  if (found === undefined) throw new Error(`the scene wants "${selector}" with "${text}", and there is none`);
  return found;
}

function input(selector: string): HTMLInputElement {
  const found = element(selector);
  if (!(found instanceof HTMLInputElement)) throw new Error(`the scene wants an input at "${selector}"`);
  return found;
}

/** The selection of a field as `start..end`: `0..4` is the whole of a four-digit number, `1..1` a caret after its first digit. */
const selectionOf = (field: HTMLInputElement): string => `${field.selectionStart}..${field.selectionEnd}`;

/**
 * A click of the mouse on a number field, as the browser carries it out: the pointer comes over the field, the button goes down, the
 * browser gives the field the cursor and puts the caret where the mouse is (`caret`), the button goes up. A scene cannot move the real
 * mouse; the real one is `--do "click:<css>"` of the picture command, and it must end the same way.
 */
async function clickField(selector: string, caret: number): Promise<HTMLInputElement> {
  const field = input(selector);
  field.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
  await pause(60);
  field.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  field.focus();
  field.setSelectionRange(caret, caret);
  await pause(60);
  field.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
  await pause(30);
  return field;
}

/** The first click on a number field selects the whole number; the second one leaves the caret where it was put. */
async function firstClickSelects(what: string, selector: string): Promise<void> {
  const field = await clickField(selector, 1);
  if (field.value === '') throw new Error(`${what}: the scene needs a number in the field, and it is empty`);
  const whole = `0..${field.value.length}`;
  if (selectionOf(field) !== whole) throw new Error(`${what}: the first click did not select the whole number (${selectionOf(field)}, not ${whole})`);
  await clickField(selector, 1);
  if (selectionOf(field) !== '1..1') throw new Error(`${what}: the second click did not leave the caret where it was put (${selectionOf(field)}, not 1..1)`);
}

// ---- the buttons that open an entry ----------------------------------------------------------------------------------

/**
 * A press of the mouse on a button and the click it ends with. `hover: false`: the press was not seen coming, so the window
 * is not armed when it lands (touch, a pen, a press that beat the arm). `click: false`: the button goes down and the click
 * never comes, so what the button opens does not open.
 */
async function pressButton(target: HTMLElement, options: { hover?: boolean; click?: boolean } = {}): Promise<void> {
  if (options.hover !== false) {
    target.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
    await pause(60);
  }
  target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  await pause(60);
  if (options.click !== false) target.click();
  await pause(60);
}

/** The commands that ask something of Windows about the focus: none of them may follow a click on a plain button. */
const FOCUS_COMMAND = /foreground|focusable|is_focused/;

interface IpcCount { focus: string[]; all: number }

/**
 * Counts every command that crosses the mocked boundary from now on, by name: `focus` is what was asked of Windows about the
 * focus. Also `--do "eval:window.__ipc()"` of the picture command.
 */
function watchIpc(): () => IpcCount {
  const internals = (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, ...rest: unknown[]) => Promise<unknown> } }).__TAURI_INTERNALS__;
  const inner = internals.invoke;
  const seen: string[] = [];
  internals.invoke = (command, ...rest) => {
    seen.push(command);
    return inner.call(internals, command, ...rest);
  };
  const count = (): IpcCount => ({ focus: seen.filter((command) => FOCUS_COMMAND.test(command)), all: seen.length });
  (window as unknown as { __ipc: () => IpcCount }).__ipc = count;
  return count;
}

interface KeyboardNow {
  /** The application says the window holds the keyboard, and the state of its holds. */
  held: boolean;
  holds: string;
  /** Who has the keyboard in the mocked Windows, and whether the window can be activated. */
  owner: string | undefined;
  focusable: boolean | undefined;
  /** Where the cursor is: the classes of the field and of the form around it; its text and its selection. */
  cursor: string | null;
  text: string | null;
  selection: string | null;
}

function keyboardNow(app: SceneApp): KeyboardNow {
  const state = window.__preview?.state();
  const active = document.activeElement;
  const field = active instanceof HTMLInputElement ? active : null;
  // the class a form or a field is known by: `quick`, `trade`, `in-price`, `in-scu` (not the ones of the theme, of Svelte or of a state)
  const known = (el: Element | null): string => [...(el?.classList ?? [])].find((name) => /^(quick|trade|in-\w+)$/.test(name)) ?? '';
  return {
    held: app.keyboardHeld,
    holds: app.keyboard.state,
    owner: state?.keyboard,
    focusable: state?.focusable,
    cursor: field === null ? null : `${known(field.closest('form'))} ${field.getAttribute('role') ?? known(field)}`.trim(),
    text: field === null ? null : field.value,
    selection: field === null ? null : selectionOf(field),
  };
}

/** `--do "eval:window.__keys()"` of the picture command prints `keyboardNow` as one line. */
function watchKeys(app: SceneApp): void {
  (window as unknown as { __keys: () => string }).__keys = () => JSON.stringify(keyboardNow(app));
}

/** Fails the scene unless the keyboard is as `wanted` says (only the named parts are compared). */
function expectKeyboard(app: SceneApp, when: string, wanted: Partial<KeyboardNow>): void {
  const now = keyboardNow(app);
  for (const key of Object.keys(wanted) as Array<keyof KeyboardNow>) {
    if (now[key] !== wanted[key]) throw new Error(`${when}: ${key} is ${JSON.stringify(now[key])}, not ${JSON.stringify(wanted[key])} (${JSON.stringify(now)})`);
  }
}

/** How many times the mocked Windows was asked for the foreground (`asked: true`: the press itself had not activated the window). */
const askedCount = (): number => (window.__preview?.log ?? []).filter((line) => line.includes('take_foreground') && line.includes('(asked: true)')).length;

const QUICK_COMMODITY = '.quick .box input';
const cursorIn = (selector: string) => (): boolean => document.activeElement !== null && document.activeElement === document.querySelector(selector);

export const KEYBOARD_SCENES: readonly Scene[] = [
  {
    name: 'keyboard-held',
    title: 'Клик в поле цены строки быстрого ввода: окно активировано кликом, клавиатура у окна',
    dataset: 'default',
    act: async (app) => {
      await app.expand('preview');
      element('button.entry').click();
      await pause(60);
      await hoverAndPress('.quick input.in-price');
      const keyboard = window.__preview?.state().keyboard;
      if (!app.keyboardHeld || keyboard !== 'overlay') {
        throw new Error(`the press on the field did not bring the keyboard to the window (held: ${app.keyboardHeld}, keyboard: ${keyboard})`);
      }
    },
  },
  {
    // The number fields: the price and the quantity of the open row, of the form of a trade and of the quick entry. The scene walks
    // through all six and fails with the name of the first one that does not behave; with the real mouse it is
    // `--scene expanded-row --do "click:.expand .in-price;eval:[document.activeElement.selectionStart,document.activeElement.selectionEnd]"`.
    name: 'number-select',
    title: 'Числовые поля: первый клик выделяет число целиком, второй ставит курсор (строка таблицы, форма сделки, быстрый ввод)',
    dataset: 'default',
    act: async (app) => {
      await app.expand('preview');
      withText('.table button.line', 'MEDS').click();
      await pause(60);
      await firstClickSelects('the price of the open row', '.expand .in-price');
      withText('.expand button', 'Купил').click();
      await pause(100);
      await firstClickSelects('the quantity of the trade form', 'form.trade .in-scu');
      await firstClickSelects('the price of the trade form', 'form.trade .in-price');
      await click('button.entry');
      const price = input('.quick .in-price');
      const scu = input('.quick .in-scu');
      // the fields of the quick entry are empty until the player types: the scene types for him, as an `input` event does
      for (const [field, text] of [[price, '2400'], [scu, '120']] as const) {
        field.value = text;
        field.dispatchEvent(new Event('input', { bubbles: true }));
      }
      await firstClickSelects('the price of the quick entry', '.quick .in-price');
      await firstClickSelects('the quantity of the quick entry', '.quick .in-scu');
      // the last look of the picture: the price of the open row, selected by one click
      await clickField('.expand .in-price', 1);
    },
  },
  {
    // What the scenes below check, with the real mouse: `--do "hover:button.entry;click:button.entry;type:ste;eval:window.__keys()" --state`,
    // `--do "hover:.expand .sc-btn--act:last-child;click:.expand .sc-btn--act:last-child;eval:window.__keys()"`, and for a plain button
    // `--do "hover:header button.route;click:header button.route;wait:900;eval:window.__ipc()"`.
    name: 'entry-ready',
    title: 'Кнопки, открывающие ввод: развёрнутое окно с раскрытой строкой MEDS, для шагов --do (window.__keys(), window.__ipc())',
    dataset: 'default',
    act: async (app) => {
      await app.expand('preview');
      withText('.table button.line', 'MEDS').click();
      await pause(100);
      watchKeys(app);
      watchIpc();
    },
  },
  {
    name: 'entry-plus-price',
    title: '«+ цена»: наведение и клик — курсор в поле «Товар», клавиатура у окна, Windows ни о чём не просили',
    dataset: 'default',
    act: async (app) => {
      await app.expand('preview');
      watchKeys(app);
      await pressButton(element('button.entry'));
      await until('the cursor in the commodity field of the quick entry', cursorIn(QUICK_COMMODITY));
      expectKeyboard(app, 'after the click on «+ цена»', { held: true, holds: 'held', owner: 'overlay', cursor: 'quick combobox' });
      if (askedCount() !== 0) throw new Error('the click on «+ цена» had to ask Windows for the foreground: the press itself must activate the armed window');
    },
  },
  {
    name: 'entry-buy',
    title: '«Купил» в раскрытой строке: курсор в количестве формы, число выделено, клавиатура у окна',
    dataset: 'default',
    act: async (app) => {
      await app.expand('preview');
      watchKeys(app);
      withText('.table button.line', 'MEDS').click();
      await pause(100);
      await pressButton(withText('.expand button', 'Купил'));
      await until('the cursor in the quantity of the trade form', cursorIn('form.trade .in-scu'));
      const { text } = keyboardNow(app);
      expectKeyboard(app, 'after the click on «Купил»', { held: true, owner: 'overlay', cursor: 'trade in-scu', selection: `0..${text?.length}` });
      if (!text) throw new Error('the scene needs a quantity in the form of the purchase, and the field is empty');
    },
  },
  {
    name: 'entry-sell',
    title: '«Продал» в раскрытой строке: курсор в цене формы, число выделено, клавиатура у окна',
    dataset: 'default',
    act: async (app) => {
      await app.expand('preview');
      watchKeys(app);
      app.setTerminalSide('sell');
      await pause(60);
      element('.table button.line').click();
      await pause(100);
      await pressButton(withText('.expand button', 'Продал'));
      await until('the cursor in the price of the trade form', cursorIn('form.trade .in-price'));
      const { text } = keyboardNow(app);
      expectKeyboard(app, 'after the click on «Продал»', { held: true, owner: 'overlay', cursor: 'trade in-price', selection: `0..${text?.length}` });
      if (!text) throw new Error('the scene needs a price in the form of the sale, and the field is empty');
    },
  },
  {
    // The button goes down and the entry never opens (no click follows: the mouse was dragged away; a refusal or an error would end
    // the same way). The holder must not stay without a field: the watchdog takes it away, and with the pointer gone the window
    // cannot be activated.
    name: 'entry-not-opened',
    title: '«+ цена» нажата, а быстрый ввод не открылся: держатель снят, клавиатура у игры, окно не активируемое',
    dataset: 'default',
    act: async (app) => {
      await app.expand('preview');
      watchKeys(app);
      const button = element('button.entry');
      await pressButton(button, { click: false });
      expectKeyboard(app, 'right after the press on «+ цена»', { held: true, owner: 'overlay' });
      await until('the keyboard to go back to the game', () => !app.keyboardHeld);
      // the pointer still rests on the button: the window is armed for the next press, as it is over a field
      expectKeyboard(app, 'after the entry did not open', { held: false, holds: 'armed', owner: 'game', cursor: null });
      button.dispatchEvent(new PointerEvent('pointerout', { bubbles: true }));
      await until('the window to be disarmed', () => app.keyboard.state === 'idle' && window.__preview?.state().focusable === false);
      expectKeyboard(app, 'after the pointer left the button', { held: false, holds: 'idle', owner: 'game', focusable: false });
    },
  },
  {
    // The press lands before the window is armed, and the strict Windows refuses the foreground: nobody holds the keyboard, the form
    // opens all the same (the click is a click), and the next press on the button, now seen coming, puts the cursor into the form.
    name: 'entry-race',
    title: '«Купил» нажата без наведения: Windows отказала, держателя нет, форма открыта без курсора; второй клик ставит курсор',
    dataset: 'default',
    act: async (app) => {
      await app.expand('preview');
      watchKeys(app);
      withText('.table button.line', 'MEDS').click();
      await pause(100);
      const button = withText('.expand button', 'Купил');
      await pressButton(button, { hover: false });
      await pause(200);
      if (document.querySelector('form.trade') === null) throw new Error('the click on «Купил» did not open the form');
      expectKeyboard(app, 'after the press that was refused', { held: false, owner: 'game', cursor: null });
      if (askedCount() !== 1) throw new Error(`the press that was not seen coming asks Windows once, and it asked ${askedCount()} times`);
      await pressButton(button);
      await until('the cursor in the quantity of the trade form', cursorIn('form.trade .in-scu'));
      expectKeyboard(app, 'after the second click on «Купил»', { held: true, owner: 'overlay', cursor: 'trade in-scu' });
      if (askedCount() !== 1) throw new Error('the second click had to ask Windows for the foreground');
    },
  },
  {
    // «Маршрут», the tab of the side, a row of the table, «Где купить», the looking glass: none of them is a field or opens an entry.
    // Not one command about the focus may cross the boundary, hovered and clicked.
    name: 'plain-buttons',
    title: 'Обычные кнопки («Маршрут», вкладка стороны, строка, «Где купить», лупа): окно не взводится, Windows ни о чём не спрашивают',
    dataset: 'default',
    act: async (app) => {
      await app.expand('preview');
      watchKeys(app);
      const ipc = watchIpc();
      const buttons: Array<[string, () => HTMLElement]> = [
        ['«Маршрут»', () => element('header button.route')],
        ['the tab «Продать»', () => withText('.sc-seg button', 'Продать')],
        ['a row of the table', () => element('.table button.line')],
        ['«Где купить»', () => withText('.expand button', 'Где купить')],
        ['the looking glass', () => element('button.search')],
      ];
      for (const [what, find] of buttons) {
        await pressButton(find());
        await pause(300);
        const { focus } = ipc();
        if (focus.length > 0) throw new Error(`${what}: a plain button asked Windows about the focus: ${focus.join(', ')}`);
        expectKeyboard(app, `after the click on ${what}`, { held: false, holds: 'idle', owner: 'game', focusable: false });
      }
    },
  },
  {
    // The player clicked the price of the open row and typed nothing: after `KEYBOARD_IDLE_MS` without a key the keyboard is the
    // game's again, the way `Esc` gives it back (the field loses the cursor, the row stays open), with one line in the log. The scene
    // takes that long. What keeps the keyboard is shown with the real keys: `--scene entry-ready --do "hover:.expand .in-price;
    // click:.expand .in-price;type:24;wait:16500;eval:window.__keys()"` (typed and not saved: the keyboard stays).
    name: 'keyboard-idle',
    title: 'Клавиатура у окна, 15 секунд ни одной клавиши и в поле ничего не набрано: клавиатура сама вернулась игре, строка осталась раскрытой',
    dataset: 'default',
    act: async (app) => {
      await app.expand('preview');
      watchKeys(app);
      withText('.table button.line', 'MEDS').click();
      await pause(100);
      await clickField('.expand .in-price', 1);
      expectKeyboard(app, 'after the click on the price', { held: true, owner: 'overlay', cursor: 'in-price' });
      await pause(KEYBOARD_IDLE_MS - 1500);
      expectKeyboard(app, 'a second and a half before the limit', { held: true, owner: 'overlay', cursor: 'in-price' });
      await until('the keyboard to go back to the game by itself', () => !app.keyboardHeld);
      await pause(100);
      expectKeyboard(app, `after ${KEYBOARD_IDLE_MS / 1000} s without a key`, { held: false, owner: 'game', cursor: null });
      if (document.querySelector('.expand') === null) throw new Error('the open row was folded when the keyboard went back');
      const said = (window.__preview?.log ?? []).filter((line) => line.includes('[ui] the keyboard was not used'));
      if (said.length !== 1) throw new Error(`the log must say once that the keyboard went back by itself, and it says so ${said.length} times`);
    },
  },
];
