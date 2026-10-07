import { tick } from 'svelte';

// What a gallery state does after it is drawn: it drives the REAL component with the events a person makes
// (a click, typing, a key), so a state that needs an open list or a failed field is made by the component itself.
// `mountGallery` waits for every scheduled act before it measures the page.

// The acts run one after another, in the order of the states on the page: there is one keyboard focus on a page, so
// a state that leaves a field focused or a list open keeps it only when no later state takes the focus away.
let chain: Promise<void> = Promise.resolve();

/** Runs `job` after the state is on the page and after every act scheduled before it; the page is not measured until it is done. */
export function schedule(job: () => void | Promise<void>): void {
  chain = chain.then(job).catch((err: unknown) => {
    // a broken act must show up in the picture log, not vanish: the state is then drawn as far as it got
    console.error(`[gallery] a state act failed: ${err instanceof Error ? err.message : String(err)}`);
  });
}

export async function settled(): Promise<void> {
  await chain;
}

const pause = (ms = 0): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export function find<T extends Element = HTMLElement>(root: ParentNode, selector: string): T {
  const found = root.querySelector<T>(selector);
  if (found === null) throw new Error(`no element matches "${selector}"`);
  return found;
}

export async function click(el: Element): Promise<void> {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  await tick();
  await pause();
}

/** Puts the cursor into the field and types the text into it as one input. */
export async function typeInto(input: HTMLInputElement, text: string): Promise<void> {
  input.focus();
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await tick();
  await pause();
}

export async function press(el: Element, key: string): Promise<void> {
  el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  await tick();
  await pause();
}
