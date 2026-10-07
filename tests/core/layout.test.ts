import { describe, expect, it } from 'vitest';
import { anchoredRect, maxContentSize, toPhysicalRect, WINDOW_MARGIN } from '../../src/core/layout';

const m = { width: 1920, height: 1080 };

describe('maxContentSize', () => {
  it('is the monitor minus the margin on each side', () => {
    expect(WINDOW_MARGIN).toBe(16);
    expect(maxContentSize(m)).toEqual({ width: 1888, height: 1048 });
  });

  it('takes the margin as a parameter', () => {
    expect(maxContentSize(m, 0)).toEqual(m);
    expect(maxContentSize(m, 40)).toEqual({ width: 1840, height: 1000 });
  });

  it('is never negative on a monitor smaller than the margins', () => {
    expect(maxContentSize({ width: 20, height: 10 })).toEqual({ width: 0, height: 0 });
  });
});

describe('anchoredRect', () => {
  const size = { width: 440, height: 300 };

  it('glues the window to each of the four corners, `margin` away from the edges', () => {
    expect(anchoredRect(m, 'top-left', size)).toEqual({ x: 16, y: 16, width: 440, height: 300 });
    expect(anchoredRect(m, 'top-right', size)).toEqual({ x: 1464, y: 16, width: 440, height: 300 }); // 1920 − 440 − 16
    expect(anchoredRect(m, 'bottom-left', size)).toEqual({ x: 16, y: 764, width: 440, height: 300 }); // 1080 − 300 − 16
    expect(anchoredRect(m, 'bottom-right', size)).toEqual({ x: 1464, y: 764, width: 440, height: 300 });
  });

  it('places a one-line mini bar by its own size', () => {
    const mini = { width: 310, height: 26 };
    expect(anchoredRect(m, 'top-right', mini)).toEqual({ x: 1594, y: 16, width: 310, height: 26 });
    expect(anchoredRect(m, 'bottom-left', mini)).toEqual({ x: 16, y: 1038, width: 310, height: 26 });
  });

  it('takes the margin as a parameter', () => {
    expect(anchoredRect(m, 'bottom-right', size, 0)).toEqual({ x: 1480, y: 780, width: 440, height: 300 });
    expect(anchoredRect(m, 'top-left', size, 30)).toEqual({ x: 30, y: 30, width: 440, height: 300 });
  });

  it('cuts content larger than the monitor down to the largest content size, in every corner', () => {
    const huge = { width: 3000, height: 2000 };
    const max = maxContentSize(m);
    for (const corner of ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const) {
      expect(anchoredRect(m, corner, huge), corner).toEqual({ x: 16, y: 16, width: max.width, height: max.height });
    }
  });

  it('cuts only the side that does not fit and keeps the corner of the other one', () => {
    const tall = { width: 440, height: 5000 };
    expect(anchoredRect(m, 'top-right', tall)).toEqual({ x: 1464, y: 16, width: 440, height: 1048 });
    expect(anchoredRect(m, 'bottom-right', tall)).toEqual({ x: 1464, y: 16, width: 440, height: 1048 });
    const wide = { width: 4000, height: 26 };
    expect(anchoredRect(m, 'bottom-left', wide)).toEqual({ x: 16, y: 1038, width: 1888, height: 26 });
  });

  it('leaves content that exactly fills the largest size where it is', () => {
    const max = maxContentSize(m);
    expect(anchoredRect(m, 'bottom-right', max)).toEqual({ x: 16, y: 16, width: max.width, height: max.height });
  });
});

describe('toPhysicalRect', () => {
  it('leaves a rect unchanged on a monitor at the origin with scale 1', () => {
    const rect = { x: 1644, y: 16, width: 260, height: 36 };
    expect(toPhysicalRect(rect, { x: 0, y: 0 }, 1)).toEqual(rect);
  });

  it('scales by the scale of the target monitor and adds the monitor position', () => {
    // A window in the top-right corner of a 1.5x monitor that starts at x = 2560.
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
    // 2560x1440 at 1.25 is 2048x1152 logical; a window glued to the bottom-right edge must end at 2560x1440.
    const monitor = { width: 2048, height: 1152 };
    const physical = toPhysicalRect(anchoredRect(monitor, 'bottom-right', { width: 440, height: 301 }, 0), { x: 0, y: 0 }, 1.25);
    expect(physical.x + physical.width).toBe(2560);
    expect(physical.y + physical.height).toBe(1440);
  });
});
