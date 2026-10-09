import { describe, expect, it } from 'vitest';
import { findScene, SCENES } from '../../src/preview/scenes';
import { SCALE_BASES, SCALE_PERCENTS, SCALE_SCENES, scaleSceneName } from '../../src/preview/scenes-scale';

// The scenes of the scale: the five scenes that show the whole interface (the mini line, the mini line in a run, the
// expanded window, the settings with every group open, the table that does not fit a small monitor), each one at 125 and
// at 150 %. A scale scene does what its base scene does after it has set the scale, so it must stand on the same data and the
// same monitor as the base: it repeats those two fields, and this test keeps the repetition honest.

describe('the scenes of the scale', () => {
  it('are the five base scenes at 125 and at 150 percent, every one registered', () => {
    expect(SCALE_PERCENTS).toEqual([125, 150]);
    expect(SCALE_BASES.map((b) => b.base)).toEqual(['mini', 'mini-run', 'expanded', 'settings-open-all', 'expanded-tall']);
    expect(SCALE_SCENES).toHaveLength(SCALE_BASES.length * SCALE_PERCENTS.length);
    for (const scene of SCALE_SCENES) expect(findScene(scene.name), scene.name).toBe(scene);
  });

  it('are named by their base and the percent, and no name is used twice among all scenes', () => {
    expect(scaleSceneName('expanded', 125)).toBe('expanded-scale-125');
    const names = SCENES.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('stand on the data and the monitor of their base scene', () => {
    for (const { base } of SCALE_BASES) {
      const original = findScene(base);
      expect(original, base).toBeDefined();
      for (const percent of SCALE_PERCENTS) {
        const scaled = findScene(scaleSceneName(base, percent));
        expect(scaled, `${base} ${percent}`).toBeDefined();
        expect(scaled?.dataset, `${base} ${percent}: dataset`).toBe(original?.dataset);
        expect(scaled?.monitor, `${base} ${percent}: monitor`).toBe(original?.monitor);
        expect(scaled?.act, `${base} ${percent}: act`).toBeTypeOf('function');
      }
    }
  });

  it('say the percent and the base in their titles', () => {
    for (const scene of SCALE_SCENES) expect(scene.title).toMatch(/Масштаб (125|150) %/);
  });
});
