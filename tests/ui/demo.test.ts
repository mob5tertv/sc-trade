import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/core/settings';
import { DEMO_STEPS, demoAdvance, demoCoach, opensDemoByItself, type DemoView } from '../../src/ui/vm/demo';

// The steps of the demo trip of 1.3: each moves on when the window shows what it asked for, a step already done is passed over,
// and the arrow points at the first of its elements that is on the screen.

const at = (id: string): number => DEMO_STEPS.findIndex((step) => step.id === id);
const start: DemoView = {
  mode: 'expanded', locationId: null, viewedId: null, lookupCommodityId: null, targetId: null, targetName: '',
  run: 'none', hadRun: false, openRow: null, formOpen: false,
};
const actions = { begin: () => {}, leave: () => {}, finish: () => {}, newPlayer: true };

describe('the demo trip', () => {
  it('goes from the station to the sale in eleven steps, with a card at each end', () => {
    expect(DEMO_STEPS.map((step) => step.id)).toEqual(['start', 'location', 'row', 'where', 'target', 'buy', 'trade', 'depart', 'fly', 'sell', 'done']);
    expect(demoAdvance(0, start)).toBe(0); // the first card waits for its button, whatever the window shows
  });

  it('moves on as the player does what the hint asks, and passes over what he did ahead', () => {
    expect(demoAdvance(at('location'), { ...start, locationId: 3 })).toBe(at('row'));
    expect(demoAdvance(at('row'), { ...start, locationId: 3, openRow: 'STIM' })).toBe(at('where'));
    expect(demoAdvance(at('where'), { ...start, lookupCommodityId: 8 })).toBe(at('target'));
    expect(demoAdvance(at('target'), { ...start, targetId: 4 })).toBe(at('buy'));
    expect(demoAdvance(at('buy'), { ...start, targetId: 4, formOpen: true })).toBe(at('trade'));
    // bought: the row, the lookup and the target are behind
    expect(demoAdvance(at('location'), { ...start, run: 'loading', hadRun: true })).toBe(at('depart'));
    expect(demoAdvance(at('depart'), { ...start, run: 'unloading', hadRun: true })).toBe(at('sell'));
    // sold: the last card
    expect(demoAdvance(at('fly'), { ...start, run: 'none', hadRun: true })).toBe(at('done'));
    expect(demoAdvance(at('done'), { ...start, run: 'none', hadRun: true })).toBe(at('done'));
  });

  it('points the arrow at the first of its elements on the screen, and asks to fold the window in flight', () => {
    const on = (selectors: string[]) => (selector: string) => selectors.includes(selector);
    const buy = demoCoach(at('buy'), { ...start, targetId: 4, targetName: 'MIC-L1' }, on(['[data-tour-row="STIM"]']), actions);
    expect(buy.target).toBe('[data-tour-row="STIM"]'); // the row is closed: the arrow shows the row first
    expect(buy.text).toContain('MIC-L1');
    const fly = demoCoach(at('fly'), { ...start, run: 'flight', hadRun: true }, on(['[data-tour="collapse"]', '[data-tour="mark"]']), actions);
    expect(fly.target).toBe('[data-tour="collapse"]');
    const flyMini = demoCoach(at('fly'), { ...start, mode: 'mini', run: 'flight', hadRun: true }, on(['[data-tour="mark"]']), actions);
    expect(flyMini.target).toBe('[data-tour="mark"]');
  });

  it('has a way out at every step but the last, a start button on the first card, and the ship of a new player on the last', () => {
    const none = () => false;
    expect(demoCoach(0, start, none, actions)).toMatchObject({ target: null, primary: { label: 'Начать' }, leave: { label: 'Пропустить' } });
    expect(demoCoach(at('row'), start, none, actions).leave?.label).toBe('Выйти из демо');
    const last = demoCoach(at('done'), start, none, actions);
    expect(last.leave).toBeUndefined();
    expect(last.primary?.label).toBe('Выбрать свой корабль');
    expect(demoCoach(at('done'), start, none, { ...actions, newPlayer: false }).primary?.label).toBe('Готово');
  });

  it('opens by itself on a new database only: no ship set yet, and not seen before', () => {
    expect(opensDemoByItself(DEFAULT_SETTINGS)).toBe(true);
    expect(opensDemoByItself({ ...DEFAULT_SETTINGS, scuCapacity: 696 })).toBe(false);
    expect(opensDemoByItself({ ...DEFAULT_SETTINGS, tutorialShown: true })).toBe(false);
  });
});
