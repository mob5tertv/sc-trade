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
// the monitor of the player's log: 2560x1440, scale 1
const qhd = { width: 2560, height: 1440 };
const CORNERS: Corner[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
const MINI = { width: 189, height: 28 };
const EXPANDED = { width: 440, height: 642 };

describe('maxContentSize', () => {
  it('is the monitor minus the margin on both sides', () => {
    expect(WINDOW_MARGIN).toBe(16);
    expect(maxContentSize(m)).toEqual({ width: 1888, height: 1048 });
    expect(maxContentSize(qhd)).toEqual({ width: 2528, height: 1408 });
  });

  it('is never negative on a monitor smaller than the margins', () => {
    expect(maxContentSize({ width: 20, height: 10 })).toEqual({ width: 0, height: 0 });
  });

  it('does not shrink with the distance of the anchor: content of the largest size is kept whole wherever the anchor is', () => {
    const max = maxContentSize(m);
    for (const corner of CORNERS) {
      for (const offset of [{ dx: 100, dy: 50 }, { dx: 900, dy: 500 }, { dx: 1800, dy: 1000 }]) {
        const rect = anchoredRect(m, corner, max, offset);
        expect(rect, `${corner} ${offset.dx},${offset.dy}`).toEqual({ x: 16, y: 16, width: max.width, height: max.height });
      }
    }
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

  it('glues the window to the very edge when the offsets are 0, and does not touch a window that fits', () => {
    expect(anchoredRect(m, 'bottom-right', size, { dx: 0, dy: 0 })).toEqual({ x: 1480, y: 780, width: 440, height: 300 });
    expect(anchoredRect(m, 'top-left', size, { dx: 0, dy: 0 })).toEqual({ x: 0, y: 0, width: 440, height: 300 });
    expect(anchoredRect(m, 'top-right', size, { dx: 0, dy: 0 })).toEqual({ x: 1480, y: 0, width: 440, height: 300 });
    expect(anchoredRect(m, 'bottom-left', size, { dx: 0, dy: 0 })).toEqual({ x: 0, y: 780, width: 440, height: 300 });
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

  it('keeps the mini line where the header of the dragged window was: the case of the log, 440x642 dragged to 101,627', () => {
    const anchor = anchorFromRect(qhd, { x: 101, y: 627, ...EXPANDED });
    expect(anchor).toEqual({ corner: 'top-left', dx: 101, dy: 627 });
    const offset = { dx: anchor.dx, dy: anchor.dy };
    expect(anchoredRect(qhd, anchor.corner, EXPANDED, offset)).toEqual({ x: 101, y: 627, width: 440, height: 642 });
    expect(anchoredRect(qhd, anchor.corner, MINI, offset)).toEqual({ x: 101, y: 627, width: 189, height: 28 });
  });

  describe('a window that does not fit from its anchor is shifted onto the screen, not shrunk', () => {
    it('shifts up when there is no room below the anchor, with the margin from the edge it was pushed against', () => {
      const offset = { dx: 101, dy: 1400 };
      expect(anchoredRect(qhd, 'top-left', MINI, offset)).toEqual({ x: 101, y: 1400, width: 189, height: 28 });
      expect(anchoredRect(qhd, 'top-left', EXPANDED, offset)).toEqual({ x: 101, y: 782, width: 440, height: 642 }); // 1440 − 642 − 16
    });

    it('shifts left when there is no room to the right of a left anchor', () => {
      const offset = { dx: 2300, dy: 100 };
      expect(anchoredRect(qhd, 'top-left', MINI, offset)).toEqual({ x: 2300, y: 100, width: 189, height: 28 });
      expect(anchoredRect(qhd, 'top-left', EXPANDED, offset)).toEqual({ x: 2104, y: 100, width: 440, height: 642 }); // 2560 − 440 − 16
    });

    it('shifts right when there is no room to the left of a right anchor', () => {
      const offset = { dx: 2300, dy: 100 };
      expect(anchoredRect(qhd, 'top-right', MINI, offset)).toEqual({ x: 71, y: 100, width: 189, height: 28 }); // 2560 − 189 − 2300
      expect(anchoredRect(qhd, 'top-right', EXPANDED, offset)).toEqual({ x: 16, y: 100, width: 440, height: 642 });
    });

    it('shifts on both axes at once', () => {
      expect(anchoredRect(qhd, 'top-left', EXPANDED, { dx: 2400, dy: 1400 })).toEqual({ x: 2104, y: 782, width: 440, height: 642 });
    });

    it('does not move a window that fits, even when it is closer to the edge than the margin', () => {
      expect(anchoredRect(qhd, 'top-left', EXPANDED, { dx: 2120, dy: 798 })).toEqual({ x: 2120, y: 798, width: 440, height: 642 }); // right edge 2560, bottom edge 1440
      expect(anchoredRect(qhd, 'top-left', EXPANDED, { dx: 2121, dy: 799 }).x).toBe(2104); // one pixel more and it is pushed
      expect(anchoredRect(qhd, 'top-left', EXPANDED, { dx: 2121, dy: 799 }).y).toBe(782);
    });

    it('keeps the anchor: the same anchor gives the mini line back at the same place, whatever the expanded window did', () => {
      const offset = { dx: 101, dy: 1400 };
      const first = anchoredRect(qhd, 'top-left', MINI, offset);
      anchoredRect(qhd, 'top-left', EXPANDED, offset);
      expect(anchoredRect(qhd, 'top-left', MINI, offset)).toEqual(first);
    });

    it('shifts a bottom anchor down when there is no room above it, with the margin from the top', () => {
      expect(anchoredRect(qhd, 'bottom-left', EXPANDED, { dx: 100, dy: 1300 })).toEqual({ x: 100, y: 16, width: 440, height: 642 });
      expect(anchoredRect(qhd, 'bottom-right', EXPANDED, { dx: 100, dy: 1300 })).toEqual({ x: 2020, y: 16, width: 440, height: 642 });
    });

    it('does not take a negative offset for a way off the screen', () => {
      for (const corner of CORNERS) {
        const rect = anchoredRect(m, corner, size, { dx: -30, dy: -30 });
        expect(rect.x, corner).toBeGreaterThanOrEqual(0);
        expect(rect.y, corner).toBeGreaterThanOrEqual(0);
      }
      expect(anchoredRect(m, 'top-left', size, { dx: -30, dy: -30 })).toEqual({ x: 0, y: 0, width: 440, height: 300 });
    });

    it('puts a window whose anchor is far off the monitor on the screen, whichever corner it is anchored to', () => {
      for (const corner of CORNERS) {
        const rect = anchoredRect(m, corner, size, { dx: 5000, dy: 7000 });
        expect(rect.x, corner).toBeGreaterThanOrEqual(WINDOW_MARGIN);
        expect(rect.y, corner).toBeGreaterThanOrEqual(WINDOW_MARGIN);
        expect(rect.x + rect.width, corner).toBeLessThanOrEqual(m.width - WINDOW_MARGIN);
        expect(rect.y + rect.height, corner).toBeLessThanOrEqual(m.height - WINDOW_MARGIN);
        expect([rect.width, rect.height], corner).toEqual([440, 300]);
      }
      expect(anchoredRect(m, 'top-left', size, { dx: 5000, dy: 7000 })).toEqual({ x: 1464, y: 764, width: 440, height: 300 });
    });
  });

  it('cuts content larger than the monitor down to the screen minus the margins and puts it at the margins', () => {
    const huge = { width: 3000, height: 2000 };
    for (const corner of CORNERS) {
      expect(anchoredRect(m, corner, huge), corner).toEqual({ x: 16, y: 16, width: 1888, height: 1048 });
    }
    const offset = { dx: 100, dy: 50 };
    expect(anchoredRect(m, 'top-left', huge, offset)).toEqual({ x: 16, y: 16, width: 1888, height: 1048 });
    expect(anchoredRect(m, 'bottom-right', huge, offset)).toEqual({ x: 16, y: 16, width: 1888, height: 1048 });
  });

  it('cuts only the side that does not fit and keeps the corner of the other one', () => {
    const tall = { width: 440, height: 5000 };
    expect(anchoredRect(m, 'top-right', tall)).toEqual({ x: 1464, y: 16, width: 440, height: 1048 });
    expect(anchoredRect(m, 'bottom-right', tall)).toEqual({ x: 1464, y: 16, width: 440, height: 1048 });
    const wide = { width: 4000, height: 26 };
    expect(anchoredRect(m, 'bottom-left', wide)).toEqual({ x: 16, y: 1038, width: 1888, height: 26 });
  });

  it('keeps a window that fills the largest size where it is', () => {
    const max = maxContentSize(m);
    expect(anchoredRect(m, 'bottom-right', max)).toEqual({ x: 16, y: 16, width: max.width, height: max.height });
  });
});

describe('anchorFromRect', () => {
  const size = { width: 440, height: 300 };

  it('is always anchored by the top edge: a window in the lower half gives a top corner and the distance from the top', () => {
    expect(anchorFromRect(m, { x: 100, y: 730, ...size })).toEqual({ corner: 'top-left', dx: 100, dy: 730 });
    expect(anchorFromRect(m, { x: 1380, y: 730, ...size })).toEqual({ corner: 'top-right', dx: 100, dy: 730 });
    expect(anchorFromRect(m, { x: 100, y: 780, ...size })).toEqual({ corner: 'top-left', dx: 100, dy: 780 }); // glued to the bottom edge
  });

  it('picks the side by the centre of the window and measures dx from that side', () => {
    expect(anchorFromRect(m, { x: 100, y: 200, ...size })).toEqual({ corner: 'top-left', dx: 100, dy: 200 });
    expect(anchorFromRect(m, { x: 1380, y: 200, ...size })).toEqual({ corner: 'top-right', dx: 100, dy: 200 });
  });

  it('goes by the centre, not by the corner of the window that is nearest', () => {
    // a wide window that starts in the left half but whose centre is in the right half belongs to the right
    expect(anchorFromRect(m, { x: 700, y: 16, width: 1000, height: 26 })).toEqual({ corner: 'top-right', dx: 220, dy: 16 });
  });

  it('puts a window whose centre is exactly in the middle to the left', () => {
    expect(anchorFromRect(m, { x: 16, y: 16, width: 1888, height: 1048 })).toEqual({ corner: 'top-left', dx: 16, dy: 16 });
  });

  it('never gives a negative offset, even for a window that sticks out of the monitor', () => {
    expect(anchorFromRect(m, { x: -50, y: -10, ...size })).toEqual({ corner: 'top-left', dx: 0, dy: 0 });
    expect(anchorFromRect(m, { x: 1700, y: 900, ...size })).toEqual({ corner: 'top-right', dx: 0, dy: 900 });
  });

  it('gives whole pixels', () => {
    expect(anchorFromRect(m, { x: 100.4, y: 200.6, ...size })).toEqual({ corner: 'top-left', dx: 100, dy: 201 });
  });

  it('is the inverse of anchoredRect for a window that fits, for the top corners and a few offsets', () => {
    for (const corner of ['top-left', 'top-right'] as const) {
      for (const offset of [{ dx: 16, dy: 16 }, { dx: 100, dy: 50 }, { dx: 0, dy: 0 }, { dx: 400, dy: 300 }, { dx: 100, dy: 780 }]) {
        const rect = anchoredRect(m, corner, size, offset);
        expect(anchorFromRect(m, rect), `${corner} ${offset.dx},${offset.dy}`).toEqual({ corner, ...offset });
      }
    }
  });

  it('puts a window that stood at a bottom corner back to the same place from its top anchor', () => {
    for (const corner of ['bottom-left', 'bottom-right'] as const) {
      const rect = anchoredRect(m, corner, size, { dx: 100, dy: 50 });
      const anchor = anchorFromRect(m, rect);
      expect(anchor.corner.startsWith('top'), corner).toBe(true);
      expect(anchoredRect(m, anchor.corner, size, { dx: anchor.dx, dy: anchor.dy }), corner).toEqual(rect);
    }
  });

  it('gives back every window of the screen: placing it by its own anchor puts it where it was', () => {
    for (const x of [0, 1, 101, 700, 959, 960, 1200, 1480]) {
      for (const y of [0, 16, 627, 700, 780]) {
        const rect = { x, y, ...size };
        const anchor = anchorFromRect(m, rect);
        expect(anchoredRect(m, anchor.corner, size, { dx: anchor.dx, dy: anchor.dy }), `${x},${y}`).toEqual(rect);
      }
    }
  });

  it('keeps the top edge and the side edge of the anchor when the window changes its size', () => {
    // dragged expanded, left half: the mini line has the same top and the same left edge
    const expanded = { x: 101, y: 627, ...EXPANDED };
    const left = anchorFromRect(qhd, expanded);
    const miniLeft = anchoredRect(qhd, left.corner, MINI, { dx: left.dx, dy: left.dy });
    expect([miniLeft.x, miniLeft.y]).toEqual([expanded.x, expanded.y]);
    // dragged expanded, right half: the mini line has the same top and the same right edge
    const right = anchorFromRect(qhd, { x: 1900, y: 627, ...EXPANDED });
    expect(right.corner).toBe('top-right');
    const miniRight = anchoredRect(qhd, right.corner, MINI, { dx: right.dx, dy: right.dy });
    expect(miniRight.y).toBe(627);
    expect(miniRight.x + miniRight.width).toBe(1900 + 440);
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
