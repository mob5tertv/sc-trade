import { describe, expect, it } from 'vitest';
import {
  anchoredRect,
  anchorFromRect,
  maxContentSize,
  movedRect,
  toPhysicalRect,
  WINDOW_MARGIN,
  type Corner,
} from '../../src/core/layout';

const m = { width: 1920, height: 1080 };
const CORNERS: Corner[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

describe('maxContentSize', () => {
  it('is the monitor minus the anchor offsets and the margin on the far side', () => {
    expect(WINDOW_MARGIN).toBe(16);
    expect(maxContentSize(m)).toEqual({ width: 1888, height: 1048 });
    expect(maxContentSize(m, { dx: 100, dy: 50 })).toEqual({ width: 1804, height: 1014 });
  });

  it('lets the window grow to the edge of the monitor when the anchor is at the edge', () => {
    expect(maxContentSize(m, { dx: 0, dy: 0 })).toEqual({ width: 1904, height: 1064 });
  });

  it('takes a value that would push the window off the monitor as the largest one that does not', () => {
    // an offset is never more than half of the monitor: the window always has room
    expect(maxContentSize(m, { dx: 5000, dy: 5000 })).toEqual({ width: 944, height: 524 });
    expect(maxContentSize(m, { dx: -30, dy: -30 })).toEqual({ width: 1904, height: 1064 });
  });

  it('is never negative on a monitor smaller than the margins', () => {
    expect(maxContentSize({ width: 20, height: 10 })).toEqual({ width: 0, height: 0 });
  });
});

describe('anchoredRect', () => {
  const size = { width: 440, height: 300 };

  it('glues the window to each of the four corners, 16 px from the edges by default', () => {
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

  it('keeps the offsets from the anchor corner', () => {
    const offset = { dx: 100, dy: 50 };
    expect(anchoredRect(m, 'top-left', size, offset)).toEqual({ x: 100, y: 50, width: 440, height: 300 });
    expect(anchoredRect(m, 'top-right', size, offset)).toEqual({ x: 1380, y: 50, width: 440, height: 300 });
    expect(anchoredRect(m, 'bottom-left', size, offset)).toEqual({ x: 100, y: 730, width: 440, height: 300 });
    expect(anchoredRect(m, 'bottom-right', size, offset)).toEqual({ x: 1380, y: 730, width: 440, height: 300 });
  });

  it('glues the window to the very edge when the offsets are 0', () => {
    expect(anchoredRect(m, 'bottom-right', size, { dx: 0, dy: 0 })).toEqual({ x: 1480, y: 780, width: 440, height: 300 });
  });

  it('holds the anchor corner while the size changes: a window anchored bottom-right grows up and to the left', () => {
    const offset = { dx: 100, dy: 50 };
    const small = anchoredRect(m, 'bottom-right', { width: 310, height: 26 }, offset);
    const big = anchoredRect(m, 'bottom-right', { width: 440, height: 600 }, offset);
    expect(small.x + small.width).toBe(big.x + big.width); // the right edge stays
    expect(small.y + small.height).toBe(big.y + big.height); // the bottom edge stays
    expect(big.x).toBeLessThan(small.x);
    expect(big.y).toBeLessThan(small.y);
    // and a window anchored top-left grows down and to the right from its fixed corner
    const topSmall = anchoredRect(m, 'top-left', { width: 310, height: 26 }, offset);
    const topBig = anchoredRect(m, 'top-left', { width: 440, height: 600 }, offset);
    expect([topBig.x, topBig.y]).toEqual([topSmall.x, topSmall.y]);
  });

  it('cuts content larger than the monitor down to what fits between the offsets and the far margin', () => {
    const huge = { width: 3000, height: 2000 };
    for (const corner of CORNERS) {
      expect(anchoredRect(m, corner, huge), corner).toEqual({ x: 16, y: 16, width: 1888, height: 1048 });
    }
    const offset = { dx: 100, dy: 50 };
    expect(anchoredRect(m, 'top-left', huge, offset)).toEqual({ x: 100, y: 50, width: 1804, height: 1014 });
    expect(anchoredRect(m, 'bottom-right', huge, offset)).toEqual({ x: 16, y: 16, width: 1804, height: 1014 });
  });

  it('cuts only the side that does not fit and keeps the corner of the other one', () => {
    const tall = { width: 440, height: 5000 };
    expect(anchoredRect(m, 'top-right', tall)).toEqual({ x: 1464, y: 16, width: 440, height: 1048 });
    expect(anchoredRect(m, 'bottom-right', tall)).toEqual({ x: 1464, y: 16, width: 440, height: 1048 });
    const wide = { width: 4000, height: 26 };
    expect(anchoredRect(m, 'bottom-left', wide)).toEqual({ x: 16, y: 1038, width: 1888, height: 26 });
  });

  it('clamps an offset that would push the window off the monitor instead of refusing it', () => {
    for (const corner of CORNERS) {
      const rect = anchoredRect(m, corner, size, { dx: 5000, dy: 7000 });
      expect(rect.x, corner).toBeGreaterThanOrEqual(0);
      expect(rect.y, corner).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width, corner).toBeLessThanOrEqual(m.width);
      expect(rect.y + rect.height, corner).toBeLessThanOrEqual(m.height);
    }
    expect(anchoredRect(m, 'top-left', size, { dx: 5000, dy: 7000 })).toEqual({ x: 960, y: 540, width: 440, height: 300 });
  });

  it('keeps a window that fills the largest size where it is', () => {
    const max = maxContentSize(m);
    expect(anchoredRect(m, 'bottom-right', max)).toEqual({ x: 16, y: 16, width: max.width, height: max.height });
  });
});

describe('anchorFromRect', () => {
  const size = { width: 440, height: 300 };

  it('picks the nearest corner by the centre of the window and measures the offsets from it', () => {
    expect(anchorFromRect(m, { x: 100, y: 200, ...size })).toEqual({ corner: 'top-left', dx: 100, dy: 200 });
    expect(anchorFromRect(m, { x: 1380, y: 200, ...size })).toEqual({ corner: 'top-right', dx: 100, dy: 200 });
    expect(anchorFromRect(m, { x: 100, y: 730, ...size })).toEqual({ corner: 'bottom-left', dx: 100, dy: 50 });
    expect(anchorFromRect(m, { x: 1380, y: 730, ...size })).toEqual({ corner: 'bottom-right', dx: 100, dy: 50 });
  });

  it('goes by the centre, not by the corner of the window that is nearest', () => {
    // a wide window that starts in the left half but whose centre is in the right half belongs to the right
    expect(anchorFromRect(m, { x: 700, y: 16, width: 1000, height: 26 })).toEqual({ corner: 'top-right', dx: 220, dy: 16 });
  });

  it('puts a window whose centre is exactly in the middle to the left and to the top', () => {
    expect(anchorFromRect(m, { x: 16, y: 16, width: 1888, height: 1048 })).toEqual({ corner: 'top-left', dx: 16, dy: 16 });
  });

  it('never gives a negative offset, even for a window that sticks out of the monitor', () => {
    expect(anchorFromRect(m, { x: -50, y: -10, ...size })).toEqual({ corner: 'top-left', dx: 0, dy: 0 });
    expect(anchorFromRect(m, { x: 1700, y: 900, ...size })).toEqual({ corner: 'bottom-right', dx: 0, dy: 0 });
  });

  it('gives whole pixels', () => {
    expect(anchorFromRect(m, { x: 100.4, y: 200.6, ...size })).toEqual({ corner: 'top-left', dx: 100, dy: 201 });
  });

  it('is the inverse of anchoredRect for every corner and a few offsets', () => {
    for (const corner of CORNERS) {
      for (const offset of [{ dx: 16, dy: 16 }, { dx: 100, dy: 50 }, { dx: 0, dy: 0 }, { dx: 400, dy: 300 }]) {
        const rect = anchoredRect(m, corner, size, offset);
        expect(anchorFromRect(m, rect), `${corner} ${offset.dx},${offset.dy}`).toEqual({ corner, ...offset });
      }
    }
  });
});

describe('movedRect', () => {
  const start = { x: 1464, y: 16, width: 440, height: 300 };

  it('moves the window by the shift of the pointer and keeps its size', () => {
    expect(movedRect(start, { dx: -1000, dy: 500 }, m)).toEqual({ x: 464, y: 516, width: 440, height: 300 });
    expect(movedRect(start, { dx: 0, dy: 0 }, m)).toEqual(start);
  });

  it('does not let the window leave the monitor on any side', () => {
    expect(movedRect(start, { dx: -5000, dy: -5000 }, m)).toEqual({ x: 0, y: 0, width: 440, height: 300 });
    expect(movedRect(start, { dx: 5000, dy: 5000 }, m)).toEqual({ x: 1480, y: 780, width: 440, height: 300 });
  });

  it('works out the end of a drag from where it began, not from the previous move', () => {
    const once = movedRect(start, { dx: -300, dy: 200 }, m);
    const again = movedRect(start, { dx: -300, dy: 200 }, m);
    expect(once).toEqual(again);
  });

  it('gives whole pixels', () => {
    expect(movedRect(start, { dx: 10.4, dy: -3.6 }, m)).toEqual({ x: 1474, y: 12, width: 440, height: 300 });
  });

  it('puts a window that is bigger than the monitor at the corner', () => {
    expect(movedRect({ x: 5, y: 5, width: 3000, height: 2000 }, { dx: 100, dy: 100 }, m)).toEqual({ x: 0, y: 0, width: 3000, height: 2000 });
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
    const physical = toPhysicalRect(anchoredRect(monitor, 'bottom-right', { width: 440, height: 301 }, { dx: 0, dy: 0 }), { x: 0, y: 0 }, 1.25);
    expect(physical.x + physical.width).toBe(2560);
    expect(physical.y + physical.height).toBe(1440);
  });
});
