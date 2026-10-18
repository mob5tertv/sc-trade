import { BADGE_TEXT, GONE_SIGN_MS, GONE_TEXT, keyboardSign } from '../ui/vm/keyboard-badge';
import { KEYBOARD_IDLE_MS } from '../ui/vm/keyboard-idle';
import { PRICE_CHECK_NOTE } from '../ui/vm/trade-form';
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
  /** Where the cursor is: the classes of the field and of the form around it (`radio`: a side of the switch); its text and its selection. */
  cursor: string | null;
  text: string | null;
  selection: string | null;
  /** The sign of the keyboard the application says stands: «Esc — в игру» (`held`), «Клавиатура у игры» (`gone`), or none. */
  sign: 'held' | 'gone' | null;
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
    cursor: field === null ? null : `${known(field.closest('form'))} ${field.getAttribute('role') ?? (field.type === 'radio' ? 'radio' : known(field))}`.trim(),
    text: field === null ? null : field.value,
    selection: field === null ? null : selectionOf(field),
    sign: keyboardSign(app.keyboardHeld, app.keyboardGoneSign),
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

// ---- the form of a trade and a price that is not mine ------------------------------------------------------------------

/** Types `text` into a field the way the keys do: the text, and the `input` event the form hears. */
function typeInto(selector: string, text: string): void {
  const field = input(selector);
  field.value = text;
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

/** A confirmation of the form of a trade from the keyboard: Enter in the field that has the cursor submits the form. */
async function confirmTrade(): Promise<void> {
  const form = element('form.trade');
  if (!(form instanceof HTMLFormElement)) throw new Error('the form of a trade is not a form');
  form.requestSubmit();
  await pause(200);
}

/** The prices the application was told to write so far, and how many times the log says the keyboard went back by itself. */
const pricesWritten = (): string[] => (window.__preview?.log ?? []).filter((line) => line.includes('[ui] record price'));
const wentBackLines = (): string[] => (window.__preview?.log ?? []).filter((line) => line.includes('[ui] the keyboard was not used'));
/** The settings the application has written so far. */
const settingChanges = (): string[] => (window.__preview?.log ?? []).filter((line) => line.includes('[ui] change setting'));

/** The trades the service has written so far (its own lines in the log). */
const tradesWritten = (): string[] => (window.__preview?.log ?? []).filter((line) => /\[run\] (buy|sell|income) /.test(line));

/** What the form says under its fields: the question about the price, and the refusal of the service. */
const formSays = (): { check: string | null; error: string | null } => ({
  check: document.querySelector('form.trade .check')?.textContent?.trim() ?? null,
  error: document.querySelector('form.trade [role="alert"]')?.textContent?.trim() ?? null,
});

/** Fails the scene unless the form asks about the price (or does not), and unless `written` trades were written. */
function expectForm(when: string, wanted: { asks: boolean; written: number; error?: string | null }): void {
  const says = formSays();
  const asks = says.check === PRICE_CHECK_NOTE();
  if (says.check !== null && !asks) throw new Error(`${when}: the form asks in other words than it should: "${says.check}"`);
  if (asks !== wanted.asks) throw new Error(`${when}: the form ${asks ? 'asks' : 'does not ask'} to check the price (${JSON.stringify(says)})`);
  if (tradesWritten().length !== wanted.written) throw new Error(`${when}: ${tradesWritten().length} trades are written, not ${wanted.written}`);
  if (wanted.error !== undefined && says.error !== wanted.error) throw new Error(`${when}: the refusal is ${JSON.stringify(says.error)}, not ${JSON.stringify(wanted.error)}`);
}

// ---- one Esc ---------------------------------------------------------------------------------------------------------

/** The lines of the log that say `Esc` gave the keyboard back. */
const escapeLines = (): string[] => (window.__preview?.log ?? []).filter((line) => line.includes('[ui] escape: the keyboard goes back'));

/** A key goes down in `target`, as the page hears it. `repeat`: the key was down already and Windows repeats it. */
function keyDown(target: HTMLElement, key: string, repeat = false): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, repeat, bubbles: true, cancelable: true }));
}

const LOCATION = 'header .location input';

/** One key of the keyboard typed into a field: the key goes down, its letter lands at the end of the text, the field hears `input`. */
function typeKey(selector: string, char: string): void {
  const field = input(selector);
  keyDown(field, char);
  field.value += char;
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * ONE press of Esc in `field`, and the keyboard is the game's: the scene fails where a second press would be needed. It waits a
 * moment after the keyboard went, so that whatever the blur of the return may have started (a save of a cell that is left) is in
 * the log by the time the scene looks. With the real key: `--do "…;press:Escape;eval:window.__keys()"` of the picture command.
 */
async function oneEscape(app: SceneApp, where: string, field: HTMLElement): Promise<void> {
  const before = escapeLines().length;
  keyDown(field, 'Escape');
  await until(`the keyboard to go back to the game after ONE Esc ${where}`, () => !app.keyboardHeld, 1000);
  await pause(300);
  // the player gave the keyboard back himself: no sign tells him where it is
  expectKeyboard(app, `after one Esc ${where}`, { held: false, owner: 'game', cursor: null, sign: null });
  if (escapeLines().length !== before + 1) throw new Error(`the log must say once that Esc gave the keyboard back ${where}, and it says so ${escapeLines().length - before} times`);
}

// ---- the switch of the side of the quick entry ---------------------------------------------------------------------------

const QUICK_PRICE = '.quick .in-price';
/** The two sides of the switch, by the words the player reads on them. */
type SideWord = 'Куп.' | 'Прод.';
const sideRadio = (word: SideWord): HTMLInputElement => input(`.quick .side:nth-child(${word === 'Куп.' ? 1 : 2}) input`);

/** The side the switch shows: the label that is lit. It must be the one whose radio is checked: one state, not two. */
function quickSide(): string {
  const words = (elements: Element[]): string[] => elements.map((el) => (el.closest('.side')?.textContent ?? '').trim());
  const lit = words([...document.querySelectorAll('.quick .side.is-on')]);
  const checked = words([...document.querySelectorAll<HTMLInputElement>('.quick .side input')].filter((radio) => radio.checked));
  if (lit.length !== 1 || checked.length !== 1 || lit[0] !== checked[0]) {
    throw new Error(`the switch of the side is in two states: lit ${JSON.stringify(lit)}, checked ${JSON.stringify(checked)}`);
  }
  return lit[0];
}

function expectSide(when: string, word: SideWord): void {
  if (quickSide() !== word) throw new Error(`${when}: the switch shows «${quickSide()}», not «${word}»`);
}

/**
 * A click of the mouse on a side of the switch, as the browser carries it out: the button goes down on the radio (which covers
 * its label), the browser gives the pressed radio the focus, the button goes up and the click picks the side. `hover: false`: the
 * pointer is there already. With the real mouse: `--do "hover:.quick .side:nth-child(2) input;click:.quick .side:nth-child(2) input"`.
 */
async function clickSide(word: SideWord, options: { hover?: boolean } = {}): Promise<void> {
  const radio = sideRadio(word);
  if (options.hover !== false) {
    radio.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
    await pause(60);
  }
  radio.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  radio.focus();
  await pause(80);
  radio.click();
  await pause(60);
}

/** Opens the quick entry with the mouse, picks the first commodity that matches `query` with Enter: the cursor is in the empty price. */
async function quickWith(app: SceneApp, query: string): Promise<HTMLInputElement> {
  if (document.querySelector('form.quick') === null) {
    await pressButton(element('button.entry'));
    await until('the cursor in the commodity field of the quick entry', cursorIn(QUICK_COMMODITY));
  }
  const commodity = input(QUICK_COMMODITY);
  typeInto(QUICK_COMMODITY, query);
  await pause(60);
  keyDown(commodity, 'Enter');
  await until('the cursor in the price of the quick entry', cursorIn(QUICK_PRICE));
  if (commodity.value === '' || commodity.value === query) throw new Error(`Enter picked no commodity for "${query}": the field holds "${commodity.value}"`);
  expectKeyboard(app, `with «${commodity.value}» picked`, { held: true, owner: 'overlay', cursor: 'quick in-price' });
  return commodity;
}

/**
 * Opens the quick entry with the mouse and leaves it empty: the cursor is in the commodity field. Since version 1.2 the line
 * offers only what the terminal trades on the side it stands on, and a commodity that is picked cannot be turned to the other
 * side; so the scenes of the switch turn the side of the EMPTY line, and pick the commodity after it (`pickQuick`).
 */
async function openQuick(): Promise<void> {
  if (document.querySelector('form.quick') === null) await pressButton(element('button.entry'));
  await until('the cursor in the commodity field of the quick entry', cursorIn(QUICK_COMMODITY));
}

/** Picks the first commodity that matches `query` in the line as it stands (its side, what is typed in its price): the cursor goes into the price. */
async function pickQuick(query: string): Promise<void> {
  const commodity = input(QUICK_COMMODITY);
  commodity.focus();
  typeInto(QUICK_COMMODITY, query);
  await pause(60);
  keyDown(commodity, 'Enter');
  await until(`the cursor in the price after «${query}» was picked`, cursorIn(QUICK_PRICE));
  if (commodity.value === '' || commodity.value === query) throw new Error(`Enter picked no commodity for "${query}": the field holds "${commodity.value}"`);
}

/** Sends the line of the quick entry (Enter in one of its fields) and waits for the price to be told to the application. */
async function sendQuick(): Promise<string> {
  const before = pricesWritten().length;
  const form = element('form.quick');
  if (!(form instanceof HTMLFormElement)) throw new Error('the quick entry is not a form');
  form.requestSubmit();
  await until('the price to be written', () => pricesWritten().length === before + 1);
  return pricesWritten()[before];
}

// ---- the sign that the keyboard went back by itself --------------------------------------------------------------------

/** The sign of the keyboard in the header of the settings: what it reads and whether it is a button; `null` when there is none. */
function settingsSign(): { text: string; button: boolean; muted: boolean } | null {
  const badge = document.querySelector('header .badge');
  return badge === null ? null : { text: (badge.textContent ?? '').trim(), button: badge instanceof HTMLButtonElement, muted: badge.classList.contains('gone') };
}

function expectSettingsSign(app: SceneApp, when: string, wanted: 'held' | 'gone' | null): void {
  const sign = settingsSign();
  const told = keyboardSign(app.keyboardHeld, app.keyboardGoneSign);
  const fail = (): never => {
    throw new Error(`${when}: the sign must be ${JSON.stringify(wanted)}; the header shows ${JSON.stringify(sign)}, the application says ${JSON.stringify(told)}`);
  };
  if (told !== wanted) fail();
  if (wanted === null && sign !== null) fail();
  if (wanted === 'held' && !(sign !== null && sign.text === BADGE_TEXT() && sign.button && !sign.muted)) fail();
  // «Клавиатура у игры» only tells: it is muted, and it is no button
  if (wanted === 'gone' && !(sign !== null && sign.text === GONE_TEXT() && !sign.button && sign.muted)) fail();
}

/**
 * The slot of the UEX indicator in the header of the main screen. `sign`: the sign of the keyboard that stands in it (its words, whether
 * it is muted, whether it is no wider than the slot); `null` while the slot shows the indicator. `disabled`: the button of the slot says
 * that a press on it does nothing (`aria-disabled`). `widths`: the slot and the location field beside it, in px, so that a scene can
 * tell that a sign moved nothing.
 */
function headerSlot(): { sign: { text: string; muted: boolean; fits: boolean } | null; disabled: boolean; widths: string } {
  const slot = element('header .uex');
  const keys = slot.querySelector('.keys');
  const width = (el: Element): number => el.getBoundingClientRect().width;
  return {
    sign: keys === null ? null : { text: keys.textContent ?? '', muted: slot.classList.contains('gone'), fits: keys.scrollWidth <= Math.ceil(width(slot)) },
    disabled: slot.getAttribute('aria-disabled') === 'true',
    widths: `${width(slot)} / ${width(element('header .location'))}`,
  };
}

/** Fails the scene unless the slot of the main header shows the sign `wanted` (`null`: the UEX indicator), and the application says the same. */
function expectHeaderSign(app: SceneApp, when: string, wanted: 'held' | 'gone' | null): void {
  const { sign, disabled } = headerSlot();
  const told = keyboardSign(app.keyboardHeld, app.keyboardGoneSign);
  const fail = (): never => {
    throw new Error(`${when}: the sign must be ${JSON.stringify(wanted)}; the slot of the header shows ${JSON.stringify(sign)} (aria-disabled: ${disabled}), the application says ${JSON.stringify(told)}`);
  };
  if (told !== wanted) fail();
  if (wanted === null && sign !== null) fail();
  if (wanted === 'held' && !(sign !== null && sign.text === BADGE_TEXT() && !sign.muted && sign.fits)) fail();
  // «Клавиатура у игры» only tells: it is muted, and it stands inside the slot «Esc — в игру» stood in
  if (wanted === 'gone' && !(sign !== null && sign.text === GONE_TEXT() && sign.muted && sign.fits)) fail();
  // a press on the slot does nothing only while that sign stands, and the button says so then and at no other time: «Esc — в игру»
  // gives the keyboard back, the indicator refreshes the prices
  if (disabled !== (wanted === 'gone')) fail();
}

/** Opens the settings, puts the cursor into «Вместимость» and lets the keyboard go back by itself: the scene is at the moment the sign appears. */
async function settingsKeyboardGone(app: SceneApp): Promise<void> {
  await app.expand('preview');
  app.openSettings();
  await pause(100);
  watchKeys(app);
  await clickField('#set-scuCapacity', 1);
  expectSettingsSign(app, 'with the cursor in a field', 'held');
  await pause(KEYBOARD_IDLE_MS - 1500);
  expectSettingsSign(app, 'a second and a half before the limit', 'held');
  await until('the keyboard to go back to the game by itself', () => !app.keyboardHeld, 3000);
  await until('the sign «Клавиатура у игры» to stand where «Esc — в игру» stood', () => settingsSign()?.text === GONE_TEXT(), 1000);
  expectKeyboard(app, 'after the keyboard went back by itself', { held: false, owner: 'game', cursor: null });
  expectSettingsSign(app, 'after the keyboard went back by itself', 'gone');
}

/** Opens the form of a purchase of ALUM, which has only a price of UEX at HUR-L1: the keyboard is with the window, the cursor in the quantity. */
async function openForeignPurchase(app: SceneApp): Promise<void> {
  await app.expand('preview');
  watchKeys(app);
  withText('.table button.line', 'ALUM').click();
  await pause(100);
  await pressButton(withText('.expand button', 'Купил'));
  await until('the cursor in the quantity of the trade form', cursorIn('form.trade .in-scu'));
}

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
    // the run of the dataset holds MEDS; ARC-L1 (terminal 1) buys it: the form starts with the whole cargo, so the price is what is typed first
    name: 'entry-sell',
    title: '«Продал» товара из трюма: количество уже стоит (весь груз), курсор в цене формы, число выделено, клавиатура у окна',
    dataset: 'run',
    act: async (app) => {
      await app.expand('preview');
      watchKeys(app);
      app.setViewTerminal(1);
      app.setTerminalSide('sell');
      await pause(60);
      withText('.table button.line', 'MEDS').click();
      await pause(100);
      await pressButton(withText('.expand button', 'Продал'));
      await until('the cursor in the price of the trade form', cursorIn('form.trade .in-price'));
      const { text } = keyboardNow(app);
      expectKeyboard(app, 'after the click on «Продал»', { held: true, owner: 'overlay', cursor: 'trade in-price', selection: `0..${text?.length}` });
      if (!text) throw new Error('the scene needs a price in the form of the sale, and the field is empty');
      if (input('form.trade .in-scu').value === '') throw new Error('the scene needs the cargo in the quantity of the form, and the field is empty');
    },
  },
  {
    // A sale of goods that are not in the hold (an income): the quantity is empty, and it is what the player types first. With the
    // cursor in the price (selected) the quantity he types would replace the price.
    name: 'entry-sell-income',
    title: '«Продал» товара, которого нет в трюме: количество пустое, курсор в количестве; набранное количество не затирает цену',
    dataset: 'default',
    act: async (app) => {
      await app.expand('preview');
      watchKeys(app);
      app.setTerminalSide('sell');
      await pause(60);
      element('.table button.line').click();
      await pause(100);
      await pressButton(withText('.expand button', 'Продал'));
      await until('the cursor in the quantity of the trade form', cursorIn('form.trade .in-scu'));
      expectKeyboard(app, 'after the click on «Продал»', { held: true, owner: 'overlay', cursor: 'trade in-scu', text: '' });
      const price = input('form.trade .in-price').value;
      if (price === '') throw new Error('the scene needs a price in the form of the income, and the field is empty');
      typeInto('form.trade .in-scu', '10');
      await pause(60);
      if (input('form.trade .in-price').value !== price) throw new Error(`the typed quantity changed the price: "${input('form.trade .in-price').value}", not "${price}"`);
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
    // The header of the main screen tells the player of that return: where «Esc — в игру» stood, the slot of the UEX indicator says
    // «Клавиатура у игры», muted, and the header does not move. The scene ends with the sign on, so the picture shows it.
    name: 'keyboard-idle',
    title: 'Клавиатура у окна, 15 секунд ни одной клавиши и в поле ничего не набрано: клавиатура сама вернулась игре, строка осталась раскрытой, в шапке на месте «Esc — в игру» приглушённое «Клавиатура у игры»',
    dataset: 'default',
    act: async (app) => {
      await app.expand('preview');
      watchKeys(app);
      withText('.table button.line', 'MEDS').click();
      await pause(100);
      expectHeaderSign(app, 'before any press', null);
      const { widths } = headerSlot();
      await clickField('.expand .in-price', 1);
      expectKeyboard(app, 'after the click on the price', { held: true, owner: 'overlay', cursor: 'in-price' });
      expectHeaderSign(app, 'with the cursor in the price', 'held');
      await pause(KEYBOARD_IDLE_MS - 1500);
      expectKeyboard(app, 'a second and a half before the limit', { held: true, owner: 'overlay', cursor: 'in-price' });
      expectHeaderSign(app, 'a second and a half before the limit', 'held');
      await until('the keyboard to go back to the game by itself', () => !app.keyboardHeld);
      await pause(100);
      expectKeyboard(app, `after ${KEYBOARD_IDLE_MS / 1000} s without a key`, { held: false, owner: 'game', cursor: null, sign: 'gone' });
      expectHeaderSign(app, `after ${KEYBOARD_IDLE_MS / 1000} s without a key`, 'gone');
      if (headerSlot().widths !== widths) throw new Error(`the sign moved the header: the slot and the location field are ${headerSlot().widths} px wide, and were ${widths}`);
      if (document.querySelector('.expand') === null) throw new Error('the open row was folded when the keyboard went back');
      if (wentBackLines().length !== 1) throw new Error(`the log must say once that the keyboard went back by itself, and it says so ${wentBackLines().length} times`);
    },
  },
  {
    // Trace A of the review of task 47. A price is typed into the row and NOT confirmed; the cursor goes on to the quantity (Tab: the
    // other field of the same cell, so the table saves nothing). The automatic return would take the cursor out of the cell, and the
    // table saves a cell that is left: a timer would write the price. So the keyboard stays, however long: what was typed still waits.
    name: 'keyboard-idle-typed',
    title: 'В цене строки набрано число, курсор ушёл в количество (Tab), 16,5 с тишины: клавиатура осталась у окна, таймер ничего не записал',
    dataset: 'default',
    act: async (app) => {
      await app.expand('preview');
      watchKeys(app);
      withText('.table button.line', 'MEDS').click();
      await pause(100);
      await clickField('.expand .in-price', 1);
      typeInto('.expand .in-price', '2400');
      input('.expand .in-scu').focus();
      await pause(KEYBOARD_IDLE_MS + 1500);
      expectKeyboard(app, `${(KEYBOARD_IDLE_MS + 1500) / 1000} s after the price was typed and the cursor went to the quantity`, { held: true, owner: 'overlay', cursor: 'in-scu' });
      if (pricesWritten().length !== 0) throw new Error(`nobody confirmed the price, and it was written: ${pricesWritten()[0]}`);
      if (wentBackLines().length !== 0) throw new Error('the log says the keyboard went back by itself, over a price that was typed and not confirmed');
      if (input('.expand .in-price').value !== '2400') throw new Error(`the typed price is gone from its field: "${input('.expand .in-price').value}"`);
    },
  },
  {
    // ...and the same price confirmed with Enter: it is written once, by the player, and fifteen seconds after that key the keyboard
    // is the game's again. The blur of the return writes nothing a second time.
    name: 'keyboard-idle-entered',
    title: 'В цене строки набрано число и нажат Enter, 16,5 с тишины: цена записана один раз, клавиатура сама вернулась игре',
    dataset: 'default',
    act: async (app) => {
      await app.expand('preview');
      watchKeys(app);
      withText('.table button.line', 'MEDS').click();
      await pause(100);
      const price = await clickField('.expand .in-price', 1);
      typeInto('.expand .in-price', '2400');
      price.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
      await until('the price to be written', () => pricesWritten().length === 1);
      await pause(KEYBOARD_IDLE_MS - 1500);
      expectKeyboard(app, 'a second and a half before the limit', { held: true, owner: 'overlay', cursor: 'in-price' });
      await until('the keyboard to go back to the game by itself', () => !app.keyboardHeld);
      await pause(200);
      expectKeyboard(app, `after ${KEYBOARD_IDLE_MS / 1000} s without a key`, { held: false, owner: 'game', cursor: null });
      if (wentBackLines().length !== 1) throw new Error(`the log must say once that the keyboard went back by itself, and it says so ${wentBackLines().length} times`);
      if (pricesWritten().length !== 1) throw new Error(`the price was written ${pricesWritten().length} times, not once`);
    },
  },
  {
    // Trace N of the second review. «Бюджет» of the settings holds 90000; the player empties the field and presses neither Tab nor
    // Enter. An empty field is not "nothing typed": it was not empty before he touched it, and the settings save a field that is
    // left — the automatic return would write "no budget" by a timer. So the keyboard stays.
    name: 'keyboard-idle-emptied',
    title: 'Настройки: поле «Бюджет» (90000) стёрто, ни Tab, ни Enter, 16,5 с тишины: клавиатура осталась у окна, бюджет не изменён',
    dataset: 'default',
    act: async (app) => {
      await app.updateSetting('budget', 90000);
      await app.expand('preview');
      app.openSettings();
      await pause(100);
      watchKeys(app);
      const changes = settingChanges().length;
      const budget = await clickField('#set-budget', 1);
      if (budget.value !== '90000') throw new Error(`the scene needs 90000 in the budget field, and it holds "${budget.value}"`);
      typeInto('#set-budget', '');
      await pause(KEYBOARD_IDLE_MS + 1500);
      expectKeyboard(app, `${(KEYBOARD_IDLE_MS + 1500) / 1000} s after the budget was emptied`, { held: true, owner: 'overlay', text: '' });
      if (document.activeElement !== budget) throw new Error('the cursor is not in the budget field any more');
      if (settingChanges().length !== changes) throw new Error(`nobody confirmed the empty budget, and a setting was written: ${settingChanges().at(-1)}`);
      if (app.settings.budget !== 90000) throw new Error(`the budget is ${app.settings.budget}, not 90000`);
      if (wentBackLines().length !== 0) throw new Error('the log says the keyboard went back by itself, over a field that was emptied and not confirmed');
    },
  },
  {
    // Trace P of the second review, and the pin of "a field of the quick entry is a field of a form". A commodity is typed and picked
    // with Enter: the list puts its name in place of the letters, and the cursor goes to the price, which is empty. Nothing else was
    // typed, so only the pick holds the keyboard: it is the player's entry too, and a window without the keyboard could fold over the
    // line. (With a price typed as well the keyboard would stay whatever the rules took the fields for, and the scene would pin nothing.)
    name: 'keyboard-idle-quick',
    title: 'Быстрый ввод: товар набран и выбран Enter, курсор в пустой цене, 16,5 с тишины: клавиатура осталась у окна, выбранный товар на месте',
    dataset: 'default',
    act: async (app) => {
      await app.expand('preview');
      watchKeys(app);
      await pressButton(element('button.entry'));
      await until('the cursor in the commodity field of the quick entry', cursorIn(QUICK_COMMODITY));
      const commodity = input(QUICK_COMMODITY);
      typeInto(QUICK_COMMODITY, 'sti');
      await pause(60);
      commodity.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
      await until('the cursor in the price of the quick entry', cursorIn('.quick .in-price'));
      const picked = commodity.value;
      if (picked === '' || picked === 'sti') throw new Error(`Enter picked no commodity: the field holds "${picked}"`);
      await pause(KEYBOARD_IDLE_MS + 1500);
      expectKeyboard(app, `${(KEYBOARD_IDLE_MS + 1500) / 1000} s after the commodity was picked`, { held: true, owner: 'overlay', cursor: 'quick in-price', text: '' });
      if (commodity.value !== picked) throw new Error(`the picked commodity is gone from its field: "${commodity.value}", not "${picked}"`);
      if (wentBackLines().length !== 0) throw new Error('the log says the keyboard went back by itself, over a line of the quick entry that is not saved');
      if (pricesWritten().length !== 0) throw new Error(`nothing was confirmed, and a price was written: ${pricesWritten()[0]}`);
    },
  },
  {
    // The word of a player after version 1.1: «я записал цену и сразу пошёл в корабль, нажал W: буква встала в пустой „Товар“, выпал
    // список, и клавиатура не вернётся сама никогда». A query that is typed and not picked is a search, not an entry (the one exception
    // to the invariant, `vm/keyboard-idle.ts`): it does not hold the keyboard, and the box drops it when the cursor is taken out.
    // With the real keys: `--scene entry-ready --do "hover:button.entry;click:button.entry;type:ste;press:Enter;type:2400;press:Enter;
    // wait:2000;type:w;wait:16500;eval:window.__keys()"`.
    name: 'keyboard-idle-stray',
    title: 'Быстрый ввод: цена записана, случайная S в пустом «Товаре» (список выпал), 16,5 с тишины: клавиатура сама вернулась игре, запрос сброшен',
    dataset: 'default',
    act: async (app) => {
      await app.expand('preview');
      watchKeys(app);
      await pressButton(element('button.entry'));
      await until('the cursor in the commodity field of the quick entry', cursorIn(QUICK_COMMODITY));
      const commodity = input(QUICK_COMMODITY);
      typeInto(QUICK_COMMODITY, 'sti');
      await pause(60);
      keyDown(commodity, 'Enter');
      await until('the cursor in the price of the quick entry', cursorIn('.quick .in-price'));
      typeInto('.quick .in-price', '2400');
      const form = element('form.quick');
      if (!(form instanceof HTMLFormElement)) throw new Error('the quick entry is not a form');
      form.requestSubmit();
      await until('the price to be written', () => pricesWritten().length === 1);
      await until('the cursor back in the empty commodity field', () => cursorIn(QUICK_COMMODITY)() && commodity.value === '');
      // S (the key of flying backwards), not W: since 1.2 the list holds only what HUR-L1 sells, and no code or name of those starts with W
      typeKey(QUICK_COMMODITY, 's');
      await pause(100);
      if (document.querySelector('.quick .list') === null) throw new Error('the scene needs the list of the commodity box open over the stray key');
      expectKeyboard(app, 'with the stray key in the commodity box', { held: true, owner: 'overlay', cursor: 'quick combobox', text: 's' });
      await pause(KEYBOARD_IDLE_MS - 1500);
      expectKeyboard(app, 'a second and a half before the limit', { held: true, owner: 'overlay', cursor: 'quick combobox', text: 's' });
      await until('the keyboard to go back to the game by itself, over a query that nobody picked', () => !app.keyboardHeld, 3000);
      await pause(200);
      expectKeyboard(app, `${KEYBOARD_IDLE_MS / 1000} s after the stray key`, { held: false, owner: 'game', cursor: null });
      if (commodity.value !== '') throw new Error(`the query is still in the commodity box: "${commodity.value}"`);
      if (document.querySelector('.quick .list') !== null) throw new Error('the list of the commodity box is still open');
      if (wentBackLines().length !== 1) throw new Error(`the log must say once that the keyboard went back by itself, and it says so ${wentBackLines().length} times`);
      if (pricesWritten().length !== 1) throw new Error(`one price was confirmed, and ${pricesWritten().length} were written`);
    },
  },
  {
    // the same rule in the other search box, the location of the header: the query goes, the viewed place stays
    name: 'keyboard-idle-query',
    title: 'Поле локации: набран запрос, список открыт, ничего не выбрано, 16,5 с тишины: клавиатура сама вернулась игре, в поле снова название места',
    dataset: 'default',
    act: async (app) => {
      await app.expand('preview');
      watchKeys(app);
      const box = input(LOCATION);
      const shown = box.value;
      const viewed = app.viewTerminalId;
      await hoverAndPress(LOCATION);
      await until('the cursor in the location box', cursorIn(LOCATION));
      for (const char of 'arc') typeKey(LOCATION, char);
      await pause(100);
      if (document.querySelector('header .location .list') === null) throw new Error('the scene needs the list of the location box open');
      expectKeyboard(app, 'with a query in the location box', { held: true, owner: 'overlay', text: 'arc' });
      await pause(KEYBOARD_IDLE_MS - 1500);
      expectKeyboard(app, 'a second and a half before the limit', { held: true, owner: 'overlay', text: 'arc' });
      await until('the keyboard to go back to the game by itself, over a query that nobody picked', () => !app.keyboardHeld, 3000);
      await pause(200);
      expectKeyboard(app, `${KEYBOARD_IDLE_MS / 1000} s after the last letter of the query`, { held: false, owner: 'game', cursor: null });
      if (box.value !== shown || shown === '') throw new Error(`the query is still in the location box: "${box.value}", not "${shown}"`);
      if (document.querySelector('header .location .list') !== null) throw new Error('the list of the location box is still open');
      if (app.viewTerminalId !== viewed) throw new Error(`nothing was picked, and the viewed terminal changed from ${viewed} to ${app.viewTerminalId}`);
      if (wentBackLines().length !== 1) throw new Error(`the log must say once that the keyboard went back by itself, and it says so ${wentBackLines().length} times`);
    },
  },
  {
    // ...and what the exception does NOT cover. A commodity is picked, the cursor comes back into its box and a stray key lands there:
    // the box shows the query, but the pick still stands behind it (the box shows it again when it is left). The pick is the player's
    // entry and holds the keyboard; Esc drops the query and the commodity is there.
    name: 'keyboard-idle-over-pick',
    title: 'Быстрый ввод: товар выбран, поверх него в «Товаре» набрана буква, 16,5 с тишины: клавиатура осталась у окна — выбранный товар под запросом держит',
    dataset: 'default',
    act: async (app) => {
      await app.expand('preview');
      watchKeys(app);
      await pressButton(element('button.entry'));
      await until('the cursor in the commodity field of the quick entry', cursorIn(QUICK_COMMODITY));
      const commodity = input(QUICK_COMMODITY);
      typeInto(QUICK_COMMODITY, 'sti');
      await pause(60);
      keyDown(commodity, 'Enter');
      await until('the cursor in the price of the quick entry', cursorIn('.quick .in-price'));
      const picked = commodity.value;
      if (picked === '' || picked === 'sti') throw new Error(`Enter picked no commodity: the field holds "${picked}"`);
      await clickField(QUICK_COMMODITY, 0);
      typeKey(QUICK_COMMODITY, 'w');
      await pause(KEYBOARD_IDLE_MS + 1500);
      expectKeyboard(app, `${(KEYBOARD_IDLE_MS + 1500) / 1000} s after a letter was typed over the picked commodity`, { held: true, owner: 'overlay', cursor: 'quick combobox', text: 'w' });
      if (wentBackLines().length !== 0) throw new Error('the log says the keyboard went back by itself, over a commodity that is picked and not saved');
      await oneEscape(app, 'in the commodity box', commodity);
      if (commodity.value !== picked) throw new Error(`the picked commodity is gone from its field: "${commodity.value}", not "${picked}"`);
      if (pricesWritten().length !== 0) throw new Error(`nothing was confirmed, and a price was written: ${pricesWritten()[0]}`);
    },
  },
  {
    // ALUM has only a price of UEX at HUR-L1, and nobody touched it in the form: Enter writes nothing. The form asks, in one line, and
    // the cursor stands in the price with the number selected. With the real keys and the button of the form:
    // `--scene trade-buy-foreign --do "hover:form.trade [type=submit];click:form.trade [type=submit];eval:document.querySelector('form.trade .check').textContent"`.
    name: 'trade-check-price',
    title: '«Купил» с ценой UEX, первое подтверждение: ничего не записано, под формой «Цена справочная — проверь её и подтверди ещё раз», курсор в цене',
    dataset: 'default',
    act: async (app) => {
      await openForeignPurchase(app);
      await confirmTrade();
      expectForm('after the first confirmation', { asks: true, written: 0, error: null });
      const { text } = keyboardNow(app);
      expectKeyboard(app, 'after the first confirmation', { held: true, owner: 'overlay', cursor: 'trade in-price', selection: `0..${text?.length}` });
      if (!input('form.trade .in-price').classList.contains('foreign')) throw new Error('the price was only selected, and it does not look like a price that is not mine any more');
    },
  },
  {
    name: 'trade-check-price-written',
    title: '«Купил» с ценой UEX, второе подтверждение: покупка записана по этой цене, форма закрыта',
    dataset: 'default',
    act: async (app) => {
      await openForeignPurchase(app);
      await confirmTrade();
      expectForm('after the first confirmation', { asks: true, written: 0 });
      await confirmTrade();
      await until('the purchase to be written', () => tradesWritten().length === 1);
      await until('the form to close', () => document.querySelector('form.trade') === null);
      if (app.activeRun === null) throw new Error('the second confirmation wrote no purchase');
    },
  },
  {
    // the same number typed over the price of UEX is a number the player put there: it is written by the first confirmation
    name: 'trade-check-price-touched',
    title: '«Купил» с ценой UEX, цену набрали заново (ту же): покупка записана с первого подтверждения',
    dataset: 'default',
    act: async (app) => {
      await openForeignPurchase(app);
      typeInto('form.trade .in-price', input('form.trade .in-price').value);
      await confirmTrade();
      await until('the purchase to be written', () => tradesWritten().length === 1);
      if (document.querySelector('form.trade') !== null) throw new Error('the form is still open after the purchase was written');
    },
  },
  {
    // The refusals come before the question: more than the hold takes is refused by the service as before, and nothing is said about
    // the price. With the quantity put right the form asks, and the confirmation after that writes.
    name: 'trade-check-price-hold',
    // version 1.4: more than the hold is no refusal any more, the rest goes to the storage of the place; the price of UEX is asked about all the same
    title: '«Купил» с ценой UEX и количеством больше трюма: первое подтверждение спрашивает о цене, погрузка — после него',
    dataset: 'default',
    act: async (app) => {
      await openForeignPurchase(app);
      typeInto('form.trade .in-scu', '700');
      await confirmTrade();
      expectForm('with more than the hold takes', { asks: true, written: 0, error: null });
    },
  },
  {
    // a sale of goods that are not in the hold (an income) at a price of UEX: the same rule
    name: 'trade-check-price-income',
    title: '«Продал» без закупки с ценой UEX: первое подтверждение спрашивает о цене, второе записывает доход',
    dataset: 'default',
    act: async (app) => {
      await app.expand('preview');
      watchKeys(app);
      app.setTerminalSide('sell');
      await pause(60);
      element('.table button.line').click();
      await pause(100);
      await pressButton(withText('.expand button', 'Продал'));
      await until('the cursor in the quantity of the trade form', cursorIn('form.trade .in-scu'));
      typeInto('form.trade .in-scu', '10');
      await confirmTrade();
      expectForm('after the first confirmation of the income', { asks: true, written: 0, error: null });
      await confirmTrade();
      await until('the income to be written', () => tradesWritten().length === 1);
      if (!tradesWritten()[0].includes('[run] income')) throw new Error(`what was written is not an income: ${tradesWritten()[0]}`);
    },
  },
  {
    // The sign of the header says «Esc — в игру», and one press must be enough wherever the cursor stands. The row uses Esc itself (it
    // drops the draft and stops the key), so the order is what the scene pins: the row first, the keyboard after it. The other way
    // round the blur of the return would save the very price Esc was pressed to drop: there must be no `record price` in the log.
    // With the real keys: `--scene entry-ready --do "hover:.expand .in-price;click:.expand .in-price;type:2400;press:Escape;wait:400;eval:window.__keys()"`.
    name: 'esc-row',
    title: 'Строка таблицы: цена набрана, ОДИН Esc — черновик отброшен, ничего не записано, клавиатура у игры',
    dataset: 'default',
    act: async (app) => {
      await app.expand('preview');
      watchKeys(app);
      withText('.table button.line', 'MEDS').click();
      await pause(100);
      const price = await clickField('.expand .in-price', 1);
      const saved = price.value;
      typeInto('.expand .in-price', '2400');
      await pause(60);
      expectKeyboard(app, 'with a price typed into the row', { held: true, owner: 'overlay', cursor: 'in-price', text: '2400' });
      await oneEscape(app, 'in the row', price);
      if (pricesWritten().length !== 0) throw new Error(`Esc was pressed to drop the price, and it was written: ${pricesWritten()[0]}`);
      if (price.value !== saved) throw new Error(`the draft is still in the field: "${price.value}", not "${saved}"`);
      if (document.querySelector('.expand') === null) throw new Error('the open row was folded by Esc');
    },
  },
  {
    // The line of the quick entry with a commodity picked and a price typed. Esc in the price takes the price back, as it always did,
    // and the keyboard goes with the same press. What is left is a line that is not finished (the commodity): nothing is written.
    name: 'esc-quick',
    title: 'Быстрый ввод: товар выбран, цена набрана, ОДИН Esc — цена стёрта, товар остался, ничего не записано, клавиатура у игры',
    dataset: 'default',
    act: async (app) => {
      await app.expand('preview');
      watchKeys(app);
      await pressButton(element('button.entry'));
      await until('the cursor in the commodity field of the quick entry', cursorIn(QUICK_COMMODITY));
      const commodity = input(QUICK_COMMODITY);
      typeInto(QUICK_COMMODITY, 'sti');
      await pause(60);
      keyDown(commodity, 'Enter');
      await until('the cursor in the price of the quick entry', cursorIn('.quick .in-price'));
      const picked = commodity.value;
      typeInto('.quick .in-price', '2400');
      await pause(60);
      await oneEscape(app, 'in the price of the quick entry', input('.quick .in-price'));
      if (pricesWritten().length !== 0) throw new Error(`nothing was confirmed, and a price was written: ${pricesWritten()[0]}`);
      if (input('.quick .in-price').value !== '') throw new Error(`Esc did not take the price back: "${input('.quick .in-price').value}"`);
      if (commodity.value !== picked || picked === '') throw new Error(`the picked commodity is gone from its field: "${commodity.value}", not "${picked}"`);
    },
  },
  {
    name: 'esc-search',
    title: 'Поле локации с открытым списком: ОДИН Esc — список закрыт, запрос сброшен, клавиатура у игры',
    dataset: 'default',
    act: async (app) => {
      await app.expand('preview');
      watchKeys(app);
      const box = input(LOCATION);
      const shown = box.value;
      await hoverAndPress(LOCATION);
      await until('the cursor in the location box', cursorIn(LOCATION));
      typeInto(LOCATION, 'arc');
      await pause(60);
      if (document.querySelector('header .location .list') === null) throw new Error('the scene needs the list of the location box open');
      await oneEscape(app, 'in the location box', box);
      if (document.querySelector('header .location .list') !== null) throw new Error('the list of the location box is still open');
      if (box.value !== shown || shown === '') throw new Error(`the query is still in the box: "${box.value}", not "${shown}"`);
    },
  },
  {
    // the form of a trade lets Esc go on, so it always was one press: the scene keeps it so
    name: 'esc-trade',
    title: 'Форма сделки: количество набрано, ОДИН Esc — форма закрыта, ничего не записано, клавиатура у игры',
    dataset: 'default',
    act: async (app) => {
      await app.expand('preview');
      watchKeys(app);
      withText('.table button.line', 'MEDS').click();
      await pause(100);
      await pressButton(withText('.expand button', 'Купил'));
      await until('the cursor in the quantity of the trade form', cursorIn('form.trade .in-scu'));
      typeInto('form.trade .in-scu', '50');
      await pause(60);
      await oneEscape(app, 'in the form of a trade', input('form.trade .in-scu'));
      if (document.querySelector('form.trade') !== null) throw new Error('the form of the trade is still open');
      if (tradesWritten().length !== 0) throw new Error(`nothing was confirmed, and a trade was written: ${tradesWritten()[0]}`);
      if (pricesWritten().length !== 0) throw new Error(`nothing was confirmed, and a price was written: ${pricesWritten()[0]}`);
    },
  },
  {
    // A field of the settings is saved when it is left, and the return of the keyboard takes the cursor out of it: Esc used to SAVE
    // the number. Now it takes the number back first, like the row of the table. The typing of a scene is not a hand's: the browser
    // sends `change` when a field a HAND typed into is left, and that event is what saves a setting. So the scene sends it itself
    // after the Esc, as the browser does at the blur of the return: it must find nothing to save.
    // With the real keys: `--scene esc-settings --do "click:#set-budget;type:5;press:Escape;wait:400;eval:window.__keys()"`.
    name: 'esc-settings',
    title: 'Настройки: в «Бюджет» (90000) набрано другое число, ОДИН Esc — в поле снова 90000, ничего не сохранено, клавиатура у игры',
    dataset: 'default',
    act: async (app) => {
      await app.updateSetting('budget', 90000);
      await app.expand('preview');
      app.openSettings();
      await pause(100);
      watchKeys(app);
      const changes = settingChanges().length;
      const budget = await clickField('#set-budget', 1);
      if (budget.value !== '90000') throw new Error(`the scene needs 90000 in the budget field, and it holds "${budget.value}"`);
      typeInto('#set-budget', '12345');
      await pause(60);
      await oneEscape(app, 'in a field of the settings', budget);
      if (budget.value !== '90000') throw new Error(`Esc did not take the number back: the field holds "${budget.value}", not "90000"`);
      // the `change` of the browser at the blur of the return
      budget.dispatchEvent(new Event('change', { bubbles: true }));
      await pause(300);
      if (settingChanges().length !== changes) throw new Error(`Esc was pressed to take the number back, and a setting was written: ${settingChanges().at(-1)}`);
      if (app.settings.budget !== 90000) throw new Error(`the budget is ${app.settings.budget}, not 90000`);
      if (budget.value !== '90000') throw new Error(`after the change of the blur the field holds "${budget.value}", not "90000"`);
      if (budget.getAttribute('aria-invalid') === 'true') throw new Error('the field is marked as refused after Esc');
    },
  },
  {
    // "A new press is a new intention" holds for the return after Esc too. That return waits for the end of the press of the key; a
    // press on a FIELD that lands before it (the mouse was on its way already) asks for the keyboard there, and the return is called
    // off: it would take the cursor out of the field the player has just pressed. Esc has still done its part in the field it was
    // pressed in (the draft is dropped). A press on what is no field asks for no keyboard: there one Esc ends at the game as always.
    // The key and the press are sent in one breath here, so nothing can run between them.
    name: 'esc-new-press',
    title: 'Esc и тут же клик в другое поле: возврат отменён, курсор в новом поле, клавиатура у окна, черновик отброшен; Esc и клик по обычной кнопке — клавиатура у игры',
    dataset: 'default',
    act: async (app) => {
      await app.expand('preview');
      watchKeys(app);
      withText('.table button.line', 'MEDS').click();
      await pause(100);
      const price = await clickField('.expand .in-price', 1);
      const saved = price.value;
      typeInto('.expand .in-price', '2400');
      await pause(60);
      const scu = input('.expand .in-scu');
      keyDown(price, 'Escape');
      scu.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
      scu.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      scu.focus();
      await pause(700);
      expectKeyboard(app, 'after Esc and, at once, a press on another field', { held: true, holds: 'held', owner: 'overlay', cursor: 'in-scu', sign: 'held' });
      if (escapeLines().length !== 0) throw new Error(`the press on a field did not call the return after Esc off: ${escapeLines()[0]}`);
      if (price.value !== saved) throw new Error(`Esc did not drop the draft: the price holds "${price.value}", not "${saved}"`);
      if (pricesWritten().length !== 0) throw new Error(`Esc was pressed to drop the price, and it was written: ${pricesWritten()[0]}`);
      // ...and a press on a plain button
      const route = element('header button.route');
      keyDown(scu, 'Escape');
      route.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
      route.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      await until('the keyboard to go back to the game after Esc and a press on a plain button', () => !app.keyboardHeld, 1000);
      await pause(300);
      expectKeyboard(app, 'after Esc and, at once, a press on a plain button', { held: false, owner: 'game', cursor: null, sign: null });
      if (escapeLines().length !== 1) throw new Error(`the log must say once that Esc gave the keyboard back, and it says so ${escapeLines().length} times`);
      if (pricesWritten().length !== 0) throw new Error(`nothing was confirmed, and a price was written: ${pricesWritten()[0]}`);
    },
  },
  {
    // The location box on a fresh install shows no place: no terminal is viewed. It must drop a query that was typed and not picked
    // when the cursor leaves it, like everywhere else; a box with no value to go back to used to keep it. The scene has no dataset
    // without a place, so it views a terminal the reference does not know: the header has no name to show for it either.
    name: 'query-left-no-place',
    title: 'Поле локации без места (как после установки): набран запрос, курсор ушёл в другое поле — запрос сброшен, список закрыт',
    dataset: 'default',
    act: async (app) => {
      await app.expand('preview');
      watchKeys(app);
      app.setViewTerminal(9999);
      element('button.entry').click();
      await pause(100);
      const box = input(LOCATION);
      if (box.value !== '') throw new Error(`the scene needs a location box that shows no place, and it shows "${box.value}"`);
      await hoverAndPress(LOCATION);
      await until('the cursor in the location box', cursorIn(LOCATION));
      for (const char of 'arc') typeKey(LOCATION, char);
      await pause(100);
      if (document.querySelector('header .location .list') === null) throw new Error('the scene needs the list of the location box open');
      // the player presses another field: the cursor leaves the box
      await clickField(QUICK_PRICE, 0);
      await until('the cursor in the price of the quick entry', cursorIn(QUICK_PRICE));
      if (box.value !== '') throw new Error(`the query is still in the location box after the cursor left it: "${box.value}"`);
      if (document.querySelector('header .location .list') !== null) throw new Error('the list of the location box is still open');
      expectKeyboard(app, 'with the cursor in the price', { held: true, owner: 'overlay', cursor: 'quick in-price' });
    },
  },
  {
    // What did not change. A key of the game that is still down when the window takes the keyboard is not a press: its repeats are
    // swallowed before anything hears them, Esc among them. And Esc with the keyboard at the game is nobody's business.
    name: 'esc-guard',
    title: 'Esc, удержанный с игры (повтор без нажатия), клавиатуру не отдаёт; свежий Esc отдаёт; Esc без клавиатуры у окна ничего не делает',
    dataset: 'default',
    act: async (app) => {
      await app.expand('preview');
      watchKeys(app);
      withText('.table button.line', 'MEDS').click();
      await pause(100);
      const price = await clickField('.expand .in-price', 1);
      keyDown(price, 'Escape', true);
      await pause(500);
      expectKeyboard(app, 'after a repeat of an Esc that was never pressed in the window', { held: true, owner: 'overlay', cursor: 'in-price' });
      if (escapeLines().length !== 0) throw new Error('a key of the game that was still held down gave the keyboard back');
      await oneEscape(app, 'pressed anew', price);
      keyDown(document.body, 'Escape');
      await pause(500);
      expectKeyboard(app, 'after an Esc with the keyboard at the game', { held: false, owner: 'game', cursor: null });
      if (escapeLines().length !== 1) throw new Error(`an Esc pressed while the game had the keyboard was answered: ${escapeLines().at(-1)}`);
      if (document.querySelector('.expand') === null) throw new Error('the open row was folded by Esc');
    },
  },
  {
    // The switch stands between «Товар» and the price, and a click on it used to take the cursor out of the price: the watchdog found
    // no field being edited and gave the keyboard to the game, with the line half written. The switch is a button that opens an entry
    // now (the fifth kind): the click picks the side and the cursor is back in the price, its number selected.
    // With the real mouse: `--scene entry-ready --do "hover:button.entry;click:button.entry;type:sti;press:Enter;type:2400;
    // hover:.quick .side:nth-child(2) input;click:.quick .side:nth-child(2) input;wait:1500;eval:window.__keys()"`.
    name: 'side-switch',
    title: 'Быстрый ввод: цена набрана, клик по «Прод.» — сторона сменилась, курсор снова в цене (число выделено), клавиатура у окна',
    dataset: 'default',
    act: async (app) => {
      await app.expand('preview');
      watchKeys(app);
      await openQuick();
      expectSide('the empty line, opened on the tab «Купить»', 'Куп.');
      input(QUICK_PRICE).focus();
      typeInto(QUICK_PRICE, '2400');
      await pause(60);
      await clickSide('Прод.');
      await until('the cursor to come back into the price after the click on «Прод.»', cursorIn(QUICK_PRICE), 1500);
      expectSide('after the click on «Прод.»', 'Прод.');
      expectKeyboard(app, 'after the click on «Прод.»', { held: true, owner: 'overlay', cursor: 'quick in-price', text: '2400', selection: '0..4' });
      // past the time a press is given: the watchdog finds a field with the cursor, and the keyboard stays
      await pause(1500);
      expectKeyboard(app, 'a second and a half after the click on «Прод.»', { held: true, owner: 'overlay', cursor: 'quick in-price', text: '2400' });
      if (askedCount() !== 0) throw new Error('the click on the switch had to ask Windows for the foreground');
      // the list is of the side now: Gold is what HUR-L1 buys, and the price that was typed stays in the line
      await pickQuick('gol');
      expectSide('with Gold picked on «Прод.»', 'Прод.');
      const written = await sendQuick();
      if (!written.includes('"side":"sell"') || !written.includes('"price":2400')) throw new Error(`the switch showed «Прод.», and what was written is ${written}`);
    },
  },
  {
    // ...and with the keyboard at the game (Esc, or the return by itself): the pointer over the switch arms the window, as over a
    // field, so the player's press activates it, and the cursor goes into the price. Windows is asked for nothing.
    name: 'side-switch-armed',
    title: 'Быстрый ввод, клавиатура у игры: наведение на «Куп./Прод.» взводит окно, клик меняет сторону и ставит курсор в цену, клавиатура у окна',
    dataset: 'default',
    act: async (app) => {
      await app.expand('preview');
      watchKeys(app);
      await openQuick();
      await oneEscape(app, 'in the empty commodity field', input(QUICK_COMMODITY));
      await until('the window to be idle: the pointer is over no field', () => app.keyboard.state === 'idle' && window.__preview?.state().focusable === false);
      const radio = sideRadio('Прод.');
      radio.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
      await until('the pointer over the switch to arm the window', () => app.keyboard.state === 'armed' && window.__preview?.state().focusable === true, 1500);
      expectKeyboard(app, 'with the pointer over the switch', { held: false, holds: 'armed', owner: 'game', focusable: true });
      await clickSide('Прод.', { hover: false });
      await until('the cursor to go into the price after the click on «Прод.»', cursorIn(QUICK_PRICE), 1500);
      expectSide('after the click on «Прод.»', 'Прод.');
      expectKeyboard(app, 'after the click on «Прод.»', { held: true, holds: 'held', owner: 'overlay', cursor: 'quick in-price' });
      if (askedCount() !== 0) throw new Error('the click on the switch had to ask Windows for the foreground: the press itself must activate the armed window');
    },
  },
  {
    // The cursor comes to the switch by Tab too (from «Товар», or back from the price). A side of the switch is no text field, and the
    // watchdog used to find "no field is being edited" there and hand the keyboard to the game in the middle of the line, without a
    // word. A side of the switch is part of the line now: the keyboard stays, the arrows pick the side, Tab goes on to the price.
    // A scene cannot press the real Tab (the browser moves the cursor, not the page): it puts the cursor where the browser would.
    // With the real keys: `--scene entry-ready --do "hover:button.entry;click:button.entry;type:sti;press:Enter;press:Shift+Tab;
    // wait:2000;eval:window.__keys();press:ArrowRight;wait:300;press:Tab;eval:window.__keys()"`.
    name: 'side-switch-tab',
    title: 'Быстрый ввод: Tab на «Куп./Прод.» — через 2 с клавиатура всё ещё у окна; стрелка меняет сторону; Tab ставит курсор в цену',
    dataset: 'default',
    act: async (app) => {
      await app.expand('preview');
      watchKeys(app);
      await openQuick();
      expectSide('the empty line, opened on the tab «Купить»', 'Куп.');
      // Tab from the commodity field: the cursor goes to the side that is picked
      const buy = sideRadio('Куп.');
      keyDown(input(QUICK_COMMODITY), 'Tab');
      buy.focus();
      await pause(2000);
      expectKeyboard(app, '2 s after Tab onto the switch', { held: true, holds: 'held', owner: 'overlay', cursor: 'quick radio' });
      if (document.activeElement !== buy) throw new Error('the cursor is not on «Куп.» any more');
      // ArrowRight: the browser picks the next side and moves the cursor to it
      const sell = sideRadio('Прод.');
      keyDown(buy, 'ArrowRight');
      sell.focus();
      sell.click();
      await pause(1500);
      expectSide('after the arrow', 'Прод.');
      expectKeyboard(app, 'a second and a half after the arrow', { held: true, holds: 'held', owner: 'overlay', cursor: 'quick radio' });
      if (document.activeElement !== sell) throw new Error('the cursor is not on «Прод.» any more: picking a side with the arrows must not move it');
      // Tab: on to the price
      keyDown(sell, 'Tab');
      input(QUICK_PRICE).focus();
      await pause(100);
      expectKeyboard(app, 'after Tab from the switch', { held: true, holds: 'held', owner: 'overlay', cursor: 'quick in-price' });
      const gone = (window.__preview?.log ?? []).filter((line) => line.includes('no field is being edited') || line.includes('[window] keyboard given'));
      if (gone.length !== 0) throw new Error(`the keyboard was handed to the game while the cursor was on the switch: ${gone[0]}`);
      typeInto(QUICK_PRICE, '2400');
      await pickQuick('gol');                    // the list is of «Прод.» now: Gold is what HUR-L1 buys
      const written = await sendQuick();
      if (!written.includes('"side":"sell"') || !written.includes('"price":2400')) throw new Error(`the arrows picked «Прод.», and what was written is ${written}`);
    },
  },
  {
    // ...and the switch is no way to keep the keyboard for good: with nothing entered in the line the cursor on a side of the switch
    // is like the cursor in an empty field, and after `KEYBOARD_IDLE_MS` without a key the keyboard is the game's again, with the sign.
    name: 'side-switch-tab-idle',
    title: 'Быстрый ввод пустой, Tab из «Товара» на «Куп./Прод.», 16,5 с тишины: клавиатура сама вернулась игре (как из пустого поля)',
    dataset: 'default',
    act: async (app) => {
      await app.expand('preview');
      watchKeys(app);
      await pressButton(element('button.entry'));
      await until('the cursor in the commodity field of the quick entry', cursorIn(QUICK_COMMODITY));
      const buy = sideRadio('Куп.');
      keyDown(input(QUICK_COMMODITY), 'Tab');
      buy.focus();
      await pause(KEYBOARD_IDLE_MS - 1500);
      expectKeyboard(app, 'a second and a half before the limit', { held: true, holds: 'held', owner: 'overlay', cursor: 'quick radio' });
      await until('the keyboard to go back to the game by itself', () => !app.keyboardHeld, 3000);
      await pause(200);
      expectKeyboard(app, `${KEYBOARD_IDLE_MS / 1000} s after Tab onto the switch, with nothing entered`, { held: false, owner: 'game', sign: 'gone' });
      if (document.activeElement === buy) throw new Error('the cursor is still on the switch after the keyboard went back');
      if (wentBackLines().length !== 1) throw new Error(`the log must say once that the keyboard went back by itself, and it says so ${wentBackLines().length} times`);
      if ((window.__preview?.log ?? []).some((line) => line.includes('no field is being edited'))) throw new Error('the watchdog took the cursor on the switch for "no field is being edited"');
    },
  },
  {
    // «На вкладке „Продать“ переключатель горит „Куп.“, хотя цена ложится на сторону „Продать“». The switch showed «Куп.» whenever no
    // commodity was chosen, and for a commodity the terminal trades both ways or not at all, whatever tab the player was on; such a
    // price was then written to the buy side under his eyes on «Продать». The side is the one the terminal trades the commodity on,
    // and where that does not say (no commodity yet, both ways, not at all) the tab the player looks at. What the switch shows is
    // what is written. Since 1.2 the list follows the side too (the author, 13.10.2026): on «Прод.» the line offers what HUR-L1 buys
    // (Gold), and MEDS, which it only sells, is not found there; QUAR, which it does not trade at all, is offered on neither side.
    name: 'entry-side',
    title: 'Быстрый ввод на вкладке «Продать»: переключатель горит «Прод.», в списке то, что станция покупает; товар, который здесь только продают, переводит его на «Куп.»',
    dataset: 'default',
    act: async (app) => {
      await app.expand('preview');
      watchKeys(app);
      app.setTerminalSide('sell');
      await pause(60);
      await pressButton(element('button.entry'));
      await until('the cursor in the commodity field of the quick entry', cursorIn(QUICK_COMMODITY));
      expectSide('the empty line, opened on the tab «Продать»', 'Прод.');
      await quickWith(app, 'gol');
      expectSide('Gold, which HUR-L1 buys, on the tab «Продать»', 'Прод.');
      typeInto(QUICK_PRICE, '7500');
      const gold = await sendQuick();
      if (!gold.includes('"side":"sell"') || !gold.includes('"price":7500')) throw new Error(`the switch showed «Прод.», and what was written is ${gold}`);
      await until('the line to be empty again', () => input(QUICK_COMMODITY).value === '');
      expectSide('the line emptied after the save', 'Прод.');
      // a commodity the terminal only sells cannot be sold to it, and one it does not trade cannot be entered: the list of «Прод.» has neither
      for (const query of ['meds', 'quar']) {
        typeInto(QUICK_COMMODITY, query);
        await pause(60);
        keyDown(input(QUICK_COMMODITY), 'Enter');
        await pause(100);
        if (cursorIn(QUICK_PRICE)()) throw new Error(`"${query}" was picked on «Прод.», and HUR-L1 does not buy it`);
        typeInto(QUICK_COMMODITY, '');
      }
      // on the tab «Купить» the same MEDS is there, on its own side
      app.setTerminalSide('buy');
      await pause(60);
      await quickWith(app, 'meds');
      expectSide('MEDS, which HUR-L1 sells, on the tab «Купить»', 'Куп.');
      typeInto(QUICK_PRICE, '2300');
      const meds = await sendQuick();
      if (!meds.includes('"side":"buy"') || !meds.includes('"price":2300')) throw new Error(`the switch showed «Куп.», and what was written is ${meds}`);
      await until('the line to be empty again', () => input(QUICK_COMMODITY).value === '');
      // the tab is what the empty line follows, also when the player turns it
      app.setTerminalSide('buy');
      await pause(60);
      expectSide('the empty line after the tab was turned to «Купить»', 'Куп.');
      app.setTerminalSide('sell');
      await pause(60);
      expectSide('the empty line after the tab was turned back to «Продать»', 'Прод.');
    },
  },
  {
    // «Пока я смотрю в UEX на втором мониторе, клавиатура уходит к игре, а мои цифры уходят в игру. Единственный сигнал — подпись
    // погасла». When the keyboard goes back BY ITSELF, the place of «Esc — в игру» says so for six seconds: a muted «Клавиатура у игры»,
    // which shifts nothing and is no button. The scene ends with the sign on, so the picture shows it.
    name: 'keyboard-gone-sign',
    title: 'Настройки: клавиатура вернулась игре сама (15 с без клавиш) — на месте «Esc — в игру» приглушённая плашка «Клавиатура у игры»',
    dataset: 'default',
    act: async (app) => {
      await settingsKeyboardGone(app);
    },
  },
  {
    name: 'keyboard-gone-sign-over',
    title: 'Знак «Клавиатура у игры» стоит 6 секунд и уходит сам',
    dataset: 'default',
    act: async (app) => {
      await settingsKeyboardGone(app);
      await pause(GONE_SIGN_MS - 1500);
      expectSettingsSign(app, 'a second and a half before the sign has had its time', 'gone');
      await until('the sign «Клавиатура у игры» to go', () => settingsSign() === null, 3000);
      expectSettingsSign(app, `${GONE_SIGN_MS / 1000} s after the keyboard went back by itself`, null);
      if (wentBackLines().length !== 1) throw new Error(`the keyboard went back by itself once in this scene, and the log says so ${wentBackLines().length} times`);
    },
  },
  {
    name: 'keyboard-gone-sign-press',
    title: 'Знак «Клавиатура у игры» на экране, клик в поле — знак снят сразу, на его месте «Esc — в игру»; после Esc он не возвращается',
    dataset: 'default',
    act: async (app) => {
      await settingsKeyboardGone(app);
      // the press itself takes the sign away, before the keyboard is even taken
      const budget = input('#set-budget');
      budget.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
      await pause(60);
      budget.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      if (app.keyboardGoneSign) throw new Error('the press on a field did not take the sign «Клавиатура у игры» away at once');
      await until('the cursor in the budget field', cursorIn('#set-budget'));
      expectSettingsSign(app, 'after the press on a field', 'held');
      // the six seconds of the sign are not over yet: it must not come back when the keyboard goes by the player's own hand
      await oneEscape(app, 'in the budget field', budget);
      expectSettingsSign(app, 'after Esc, with the six seconds of the sign not yet over', null);
    },
  },
  {
    // only the return BY ITSELF brings the sign: Esc and a click on the game are the player's own, he knows where the keyboard is
    name: 'keyboard-gone-sign-none',
    title: 'После Esc и после клика в игру знака «Клавиатура у игры» нет: игрок сам отдал клавиатуру',
    dataset: 'default',
    act: async (app) => {
      await app.expand('preview');
      app.openSettings();
      await pause(100);
      watchKeys(app);
      const field = await clickField('#set-scuCapacity', 1);
      expectSettingsSign(app, 'with the cursor in a field', 'held');
      await oneEscape(app, 'in a field of the settings', field);
      expectSettingsSign(app, 'after Esc', null);
      await clickField('#set-scuCapacity', 1);
      expectSettingsSign(app, 'with the cursor in the field again', 'held');
      // past the echo of the take: a loss of the focus is the player's from here on
      await pause(700);
      window.__preview?.clickGame();
      await until('the keyboard to be dropped after the click on the game', () => !app.keyboardHeld, 3000);
      await pause(200);
      expectSettingsSign(app, 'after a click on the game', null);
      if (wentBackLines().length !== 0) throw new Error('the log says the keyboard went back by itself, and it was the player who gave it back');
    },
  },
  {
    // The same on the main screen, where the sign stands in the slot of the UEX indicator (`keyboard-idle` shows it there after the
    // return by itself). After Esc and after a click on the game the slot is the indicator again at once, with no sign in between.
    name: 'keyboard-gone-sign-main-none',
    title: 'Главный экран: после Esc и после клика в игру в шапке снова «UEX …», знака «Клавиатура у игры» нет',
    dataset: 'default',
    act: async (app) => {
      await app.expand('preview');
      watchKeys(app);
      withText('.table button.line', 'MEDS').click();
      await pause(100);
      expectHeaderSign(app, 'before any press', null);
      const { widths } = headerSlot();
      const price = await clickField('.expand .in-price', 1);
      expectHeaderSign(app, 'with the cursor in the price', 'held');
      await oneEscape(app, 'in the row', price);
      expectHeaderSign(app, 'after Esc', null);
      await clickField('.expand .in-price', 1);
      expectHeaderSign(app, 'with the cursor in the price again', 'held');
      // past the echo of the take: a loss of the focus is the player's from here on
      await pause(700);
      window.__preview?.clickGame();
      await until('the keyboard to be dropped after the click on the game', () => !app.keyboardHeld, 3000);
      await pause(200);
      expectHeaderSign(app, 'after a click on the game', null);
      if (!(element('header .uex').textContent ?? '').includes('UEX')) throw new Error(`the slot of the header does not show the UEX indicator: "${element('header .uex').textContent?.trim()}"`);
      if (headerSlot().widths !== widths) throw new Error(`the header moved: the slot and the location field are ${headerSlot().widths} px wide, and were ${widths}`);
      if (wentBackLines().length !== 0) throw new Error('the log says the keyboard went back by itself, and it was the player who gave it back');
    },
  },
];
