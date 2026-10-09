import type { Scene } from './scenes';

// The scene of the keyboard: the player's way to it, through the real listeners of `ui/keyboard.ts` and the strict
// Windows of the preview (`focus-model.ts`). `preview:sweep` loads it like every scene, so a way to the keyboard that
// stops working, or that calls a command it must not (the focus command of Tauri is not mocked, see `ipc.ts`), fails there.
// The list is added to `SCENES` in `scenes.ts`.

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

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
];
