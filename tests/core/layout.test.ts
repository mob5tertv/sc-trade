import { describe, expect, it } from 'vitest';
import { panelRect, panelSideFor, stripRect, toPhysicalRect } from '../../src/core/layout';

const m = { width: 1920, height: 1080 };

describe('layout', () => {
  it('panel takes full height on the chosen side', () => {
    expect(panelRect(m, 'right', 470)).toEqual({ x: 1450, y: 0, width: 470, height: 1080 });
    expect(panelRect(m, 'left', 470)).toEqual({ x: 0, y: 0, width: 470, height: 1080 });
  });

  it('strip is a small corner badge', () => {
    expect(stripRect(m, 'top-right')).toEqual({ x: 1644, y: 16, width: 260, height: 36 }); // 1920 − 260 − 16
    expect(stripRect(m, 'top-left')).toEqual({ x: 16, y: 16, width: 260, height: 36 });
    expect(stripRect(m, 'bottom-right')).toEqual({ x: 1644, y: 1028, width: 260, height: 36 }); // 1080 − 36 − 16
  });

  it('the panel opens on the side of the strip', () => {
    expect(panelSideFor('top-left')).toBe('left');
    expect(panelSideFor('bottom-left')).toBe('left');
    expect(panelSideFor('top-right')).toBe('right');
    expect(panelSideFor('bottom-right')).toBe('right');
  });

  it('panel never exceeds the monitor width', () => {
    expect(panelRect({ width: 400, height: 800 }, 'right', 470)).toEqual({
      x: 0,
      y: 0,
      width: 400,
      height: 800,
    });
  });
  describe('toPhysicalRect', () => {
    it('leaves a rect unchanged on a monitor at the origin with scale 1', () => {
      const rect = { x: 1644, y: 16, width: 260, height: 36 };
      expect(toPhysicalRect(rect, { x: 0, y: 0 }, 1)).toEqual(rect);
    });

    it('scales by the scale of the target monitor and adds the monitor position', () => {
      // Strip in the top-right corner of a 1.5x monitor that starts at x = 2560.
      expect(toPhysicalRect({ x: 1644, y: 16, width: 260, height: 36 }, { x: 2560, y: 0 }, 1.5)).toEqual({
        x: 2560 + 2466,
        y: 24,
        width: 390,
        height: 54,
      });
    });

    it('works for a monitor to the left of the primary one (negative position)', () => {
      expect(toPhysicalRect({ x: 16, y: 16, width: 260, height: 36 }, { x: -1920, y: 0 }, 1)).toEqual({
        x: -1904,
        y: 16,
        width: 260,
        height: 36,
      });
    });

    it('keeps a fractional scale flush with the monitor edges', () => {
      // 2560x1440 at 1.25 is 2048x1152 logical; the panel glued to the right edge must end at 2560.
      const monitor = { width: 2048, height: 1152 };
      const physical = toPhysicalRect(panelRect(monitor, 'right', 470), { x: 0, y: 0 }, 1.25);
      expect(physical.x + physical.width).toBe(2560);
      expect(physical.y).toBe(0);
      expect(physical.height).toBe(1440);
    });
  });
});
