import { describe, expect, it } from 'vitest';
import { panelRect, panelSideFor, stripRect } from '../../src/core/layout';

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
});
