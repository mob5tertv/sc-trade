import type { Scene, SceneApp } from './scenes';

// Version 1.4: the storage of a place (party-mode.md sections 22–23). The preview dataset stands at HUR-L1 (terminal 3) with a Hercules of
// 696 SCU. Each scene leaves something at the storage of HUR-L1 the way a player does: a purchase over the hold.

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const HUR = 3;
const MIC = 4;

function stim(app: SceneApp): number {
  const found = [...app.reference.commodities.values()].find((c) => c.code === 'STIM');
  if (found === undefined) throw new Error('the storage scenes want Stims in the reference');
  return found.id;
}

async function press(selector: string): Promise<void> {
  for (let i = 0; i < 40; i++) {
    const found = document.querySelector<HTMLElement>(selector);
    if (found !== null) {
      found.click();
      await pause(250);
      return;
    }
    await pause(50);
  }
  throw new Error(`the storage scene wants to press "${selector}", and there is none`);
}

function type(selector: string, text: string): void {
  const field = document.querySelector<HTMLInputElement>(selector);
  if (field === null) throw new Error(`the storage scene wants the field "${selector}", and there is none`);
  field.value = text;
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Bought 1000 Stims at HUR-L1: 696 into the hold, 304 left at the storage (`intoHold` 0: everything left there, no run). */
async function overTheHold(app: SceneApp, intoHold = 696): Promise<void> {
  const failure = await app.buy({ terminalId: HUR, commodityId: stim(app), scu: 1000, price: 2860, knownScu: 1400, toStorage: 1000 - intoHold });
  if (failure !== null) throw new Error(`the purchase over the hold was refused: ${failure}`);
}

export const STORAGE_SCENES: readonly Scene[] = [
  {
    name: 'storage-buy-split',
    title: 'Склад: «Купил» 1000 при трюме 696 — строка «В трюм 696 · на склад HUR-L1: 304 SCU»',
    dataset: 'default',
    act: async (app) => {
      await app.expand('preview');
      app.setViewTerminal(HUR);
      await pause(200);
      await press('[data-tour-row="STIM"]');
      await press('[data-tour-open="STIM"] [data-tour="trade"]');
      type('form.trade .in-scu', '1000');
      await pause(200);
      if (document.querySelector('form.trade .split') === null) throw new Error('the form shows no line of the storage for a purchase over the hold');
    },
  },
  {
    name: 'storage-tab',
    title: 'Склад: вкладка «Склад · 1» терминала HUR-L1, строка Stims раскрыта',
    dataset: 'default',
    act: async (app) => {
      await app.expand('preview');
      app.setViewTerminal(HUR);
      await overTheHold(app, 0);
      app.showTerminalStorage();
      await pause(200);
      await press('[data-tour-storage="STIM"]');
    },
  },
  {
    name: 'storage-lookup',
    title: 'Склад: «Куда везти» строки склада — прибыль от цены закупки',
    dataset: 'default',
    act: async (app) => {
      await app.expand('preview');
      app.setViewTerminal(HUR);
      await overTheHold(app, 0);
      app.showTerminalStorage();
      await pause(200);
      await press('[data-tour-storage="STIM"]');
      await press('[data-tour="storage-lookup"]');
      await pause(800);
      if (app.lookup.request?.lot === undefined) throw new Error('«Куда везти» of the storage asked no lookup of the lot');
    },
  },
  {
    name: 'storage-loaded',
    title: 'Склад: «Погрузил» — рейс начался со склада, склад пуст',
    dataset: 'default',
    act: async (app) => {
      await app.expand('preview');
      app.setViewTerminal(HUR);
      await overTheHold(app, 0);
      app.showTerminalStorage();
      await pause(200);
      await press('[data-tour-storage="STIM"]');
      await press('[data-tour="storage-load"]');
      await pause(500);
      const load = app.activeRun?.events[0];
      if (load?.storage !== 'load' || load.scu !== 696) throw new Error(`«Погрузил» did not load the hold from the storage: ${JSON.stringify(load)}`);
    },
  },
  {
    name: 'storage-view',
    title: 'Склад: «Склад 1» шапки — все склады по станциям',
    dataset: 'default',
    act: async (app) => {
      await app.expand('preview');
      await overTheHold(app);
      await pause(200);
      await press('[data-tour="storage"]');
    },
  },
  {
    name: 'storage-strip',
    title: 'Склад: мини-строка на станции, где лежит груз — «склад 1000 STIM»',
    dataset: 'default',
    act: async (app) => {
      await overTheHold(app, 0);
      await pause(3500); // the message of the purchase goes first
      if (app.strip.kind !== 'idle' || app.strip.stored === undefined) throw new Error('the mini line says nothing of the storage of the place');
    },
  },
  {
    name: 'storage-sell-guess',
    title: 'Склад: «Продал» Stims на MIC-L1 без груза в трюме — «Со склада HUR-L1»',
    dataset: 'default',
    act: async (app) => {
      await app.expand('preview');
      await overTheHold(app, 0);
      app.setViewTerminal(MIC);
      app.setTerminalSide('sell');
      await pause(300);
      await press('[data-tour-row="STIM"]');
      await press('[data-tour-open="STIM"] [data-tour="trade"]');
      await pause(200);
      if (!document.querySelector('form.trade')?.textContent?.includes('HUR-L1')) throw new Error('the sale does not offer the storage of HUR-L1');
    },
  },
  {
    name: 'storage-lost-ask',
    title: 'Склад: «Груз потерян» спрашивает, сколько было на борту',
    dataset: 'default',
    act: async (app) => {
      await app.expand('preview');
      await overTheHold(app);
      await pause(300);
      const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === 'Груз потерян');
      if (button === undefined) throw new Error('the run card has no «Груз потерян»');
      button.click();
      await pause(200);
      type('.ask .qty', '400');
      await pause(200);
    },
  },
];
