import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/core/settings';
import { nextTutorialStep, opensTutorialByItself, TUTORIAL_STEPS, tutorialCounter } from '../../src/ui/vm/tutorial';

const uiDir = join(__dirname, '..', '..', 'src', 'ui');
const components = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? components(path) : name.endsWith('.svelte') ? [readFileSync(path, 'utf8')] : [];
});

describe('the tutorial of 1.3', () => {
  it('starts with the ship, the one step that is a setting, and goes through the window in six steps', () => {
    expect(TUTORIAL_STEPS.map((step) => step.id)).toEqual(['ship', 'location', 'price', 'where', 'run', 'mini']);
    expect(tutorialCounter(1)).toBe('Шаг 2 из 6');
    expect([0, 4, 5].map(nextTutorialStep)).toEqual([1, 5, null]);
  });

  it('marks only elements the window really has: every target of a step stands as data-tour on a component', () => {
    const code = components(uiDir).join('\n');
    for (const step of TUTORIAL_STEPS) {
      if (step.target !== null) expect(code, step.id).toContain(`data-tour="${step.target}"`);
    }
  });

  it('opens by itself on a new database only: no ship set yet, and not gone through before', () => {
    expect(opensTutorialByItself(DEFAULT_SETTINGS)).toBe(true);
    expect(opensTutorialByItself({ ...DEFAULT_SETTINGS, scuCapacity: 696 })).toBe(false); // updated from 1.2: told where it is instead
    expect(opensTutorialByItself({ ...DEFAULT_SETTINGS, tutorialShown: true })).toBe(false);
  });
});
