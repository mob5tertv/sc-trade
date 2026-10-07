import { describe, expect, it } from 'vitest';
import { anchoredRect, toPhysicalRect, type Rect } from '../../src/core/layout';
import {
  DEFAULT_MONITOR, formatMonitor, logicalSize, parseMonitor, toLogicalRect,
} from '../../src/preview/monitor';

describe('parseMonitor', () => {
  it('reads width x height @ scale', () => {
    expect(parseMonitor('2560x1440@1')).toEqual({ width: 2560, height: 1440, scale: 1 });
    expect(parseMonitor('3840x2160@1.5')).toEqual({ width: 3840, height: 2160, scale: 1.5 });
  });

  it('takes scale 1 when the scale is left out', () => {
    expect(parseMonitor('1366x768')).toEqual({ width: 1366, height: 768, scale: 1 });
  });

  it('falls back to 1920x1080@1 when there is no parameter', () => {
    expect(DEFAULT_MONITOR).toEqual({ width: 1920, height: 1080, scale: 1 });
    expect(parseMonitor(null)).toEqual(DEFAULT_MONITOR);
    expect(parseMonitor(undefined)).toEqual(DEFAULT_MONITOR);
    expect(parseMonitor('')).toEqual(DEFAULT_MONITOR);
  });

  it.each(['1920', 'abc', '1920x', '1920x1080@', '1920x1080@0', '1920x1080@9', '10x10@1', '1920*1080'])(
    'rejects %j with a message that shows the expected form',
    (text) => {
      expect(() => parseMonitor(text)).toThrow(/2560x1440@1/);
      expect(() => parseMonitor(text)).toThrow(text);
    },
  );

  it('formats back what it parses', () => {
    expect(formatMonitor({ width: 2560, height: 1440, scale: 1.5 })).toBe('2560x1440@1.5');
    expect(formatMonitor(parseMonitor('1920x1080@1'))).toBe('1920x1080@1');
  });
});

describe('logicalSize', () => {
  it('is the physical size divided by the scale', () => {
    expect(logicalSize({ width: 2560, height: 1440, scale: 1.5 })).toEqual({ width: 2560 / 1.5, height: 960 });
    expect(logicalSize({ width: 1920, height: 1080, scale: 1 })).toEqual({ width: 1920, height: 1080 });
  });
});

describe('toLogicalRect', () => {
  const origin = { x: 0, y: 0 };

  it('undoes the scale', () => {
    expect(toLogicalRect({ x: 300, y: 150, width: 600, height: 300 }, origin, 1.5))
      .toEqual({ x: 200, y: 100, width: 400, height: 200 });
  });

  it('subtracts the origin of the monitor first', () => {
    expect(toLogicalRect({ x: 2560 + 100, y: 20, width: 200, height: 100 }, { x: 2560, y: 0 }, 2))
      .toEqual({ x: 50, y: 10, width: 100, height: 50 });
  });

  // The window layer sends toPhysicalRect(logical rect); the desktop page must show the same rectangle.
  describe.each([
    { width: 1920, height: 1080, scale: 1 },
    { width: 2560, height: 1440, scale: 1 },
    { width: 2560, height: 1440, scale: 1.25 },
    { width: 2560, height: 1440, scale: 1.5 },
    { width: 3840, height: 2160, scale: 2 },
    { width: 1366, height: 768, scale: 1 },
  ])('monitor %o', (monitor) => {
    const size = logicalSize(monitor);
    const tolerance = 0.5 / monitor.scale + 1e-9;
    const rects: Array<[string, Rect]> = [
      ['mini bar top-right', anchoredRect(size, 'top-right', { width: 310, height: 26 })],
      ['mini bar bottom-left', anchoredRect(size, 'bottom-left', { width: 310, height: 26 })],
      ['expanded top-right', anchoredRect(size, 'top-right', { width: 440, height: 612 })],
      ['expanded bottom-left', anchoredRect(size, 'bottom-left', { width: 440, height: 612 })],
    ];

    it.each(rects)('converges with toPhysicalRect for %s', (_name, rect) => {
      const back = toLogicalRect(toPhysicalRect(rect, origin, monitor.scale), origin, monitor.scale);
      expect(Math.abs(back.x - rect.x)).toBeLessThanOrEqual(tolerance);
      expect(Math.abs(back.y - rect.y)).toBeLessThanOrEqual(tolerance);
      expect(Math.abs(back.width - rect.width)).toBeLessThanOrEqual(2 * tolerance);
      expect(Math.abs(back.height - rect.height)).toBeLessThanOrEqual(2 * tolerance);
    });

    it('keeps a window glued to the corner of the desktop when there is no margin', () => {
      const corner = toLogicalRect(
        toPhysicalRect(anchoredRect(size, 'bottom-right', { width: 440, height: 612 }, 0), origin, monitor.scale),
        origin,
        monitor.scale,
      );
      expect(corner.x + corner.width).toBeCloseTo(size.width, 6);
      expect(corner.y + corner.height).toBeCloseTo(size.height, 6);
    });
  });
});
