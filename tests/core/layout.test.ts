import { describe, expect, it } from 'vitest';
import { panelRect, stripRect } from '../../src/core/layout';

const m = { width: 1920, height: 1080 };

describe('layout', () => {
  it('panel takes full height on the chosen side', () => {
    expect(panelRect(m, 'right', 470)).toEqual({ x: 1450, y: 0, width: 470, height: 1080 });
    expect(panelRect(m, 'left', 470)).toEqual({ x: 0, y: 0, width: 470, height: 1080 });
  });

  it('strip sits in a corner with a 16 px margin', () => {
    expect(stripRect(m, 'top-left')).toEqual({ x: 16, y: 16, width: 520, height: 32 });
    expect(stripRect(m, 'bottom-right')).toEqual({ x: 1384, y: 1032, width: 520, height: 32 });
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
