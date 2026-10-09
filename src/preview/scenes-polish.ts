import type { Scene } from './scenes';

// The scenes of task 44, the last polish of the run and the trades (the persona review of an experienced hauler): the form of a
// trade that marks a price that is not mine, the notice of a run that was closed, the badge that says the window holds the keyboard
// and the target set from the section «Рейс». They run inside the page, so they reach for the elements themselves, as the scenes of
// `scenes.ts` do (that module imports this one, hence only the type comes from it).
// The list is added to `SCENES` in `scenes.ts`.

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** A click on what is on the screen, the way a button handler sees it; a scene that names something that is not there fails with its name. */
async function click(selector: string, text?: string): Promise<void> {
  const found = [...document.querySelectorAll<HTMLElement>(selector)].find((el) => text === undefined || (el.textContent ?? '').includes(text));
  if (found === undefined) throw new Error(`the scene wants to click "${selector}"${text === undefined ? '' : ` with "${text}"`}, and there is none`);
  found.click();
  await pause(60);
}

export const POLISH_SCENES: readonly Scene[] = [
  {
    // ALUM has only a price of UEX at HUR-L1: the form of the purchase starts with it, and the field is muted until it is touched
    // (`--do "eval:..."` reads the class `foreign` of `form.trade .in-price`; typing into the field makes the number the player's)
    name: 'trade-buy-foreign',
    title: '«Купил» для товара, у которого только цена UEX: цена в форме приглушена, пока её не тронули',
    dataset: 'default',
    act: async (app) => {
      await app.expand('preview');
      await click('.table button.line', 'ALUM');
      await click('.expand button', 'Купил');
    },
  },
];
