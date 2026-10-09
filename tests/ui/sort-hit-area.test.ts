import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The header «ROI» of the table of a terminal is a button that sorts, and its label is 17 × 17 px: in the game, with a cursor that hides, nobody hits it
// (the trader's second look). Its AREA OF PRESS is at least 28 × 24 px (version 1.1.1) while its look and the widths of the columns stay as they were:
// the button is as wide as the label and the head 18 px high, so the room comes from a transparent extension of the button, not from the layout.
// The sizes are CSS custom properties of the table (`--hit-w`, `--hit-h`, `--head-h`); this test reads them from the component, with the way they are used.

const root = resolve(__dirname, '..', '..');
const table = readFileSync(resolve(root, 'src/ui/components/TerminalTable.svelte'), 'utf8');

const px = (name: string): number => {
  const found = new RegExp(`${name}:\\s*(\\d+)px`).exec(table);
  if (found === null) throw new Error(`the table has no ${name} in px`);
  return Number(found[1]);
};

describe('the area of press of the sorting headers of the table of a terminal', () => {
  it('is no smaller than 28 × 24 px', () => {
    expect(px('--hit-w')).toBeGreaterThanOrEqual(28);
    expect(px('--hit-h')).toBeGreaterThanOrEqual(24);
  });

  it('fits the column of the ROI, so that no width of a column changes: 28 px is no more than the 32 of the column', () => {
    expect(px('--hit-w')).toBeLessThanOrEqual(px('--col-roi'));
  });

  it('keeps the head as high as it was, 18 px: the extra height of the area is a transparent extension below the head, no layout', () => {
    expect(px('--head-h')).toBe(18);
    expect(px('--hit-h')).toBeGreaterThan(px('--head-h'));
    expect(table).toMatch(/height:\s*var\(--head-h\)/);
  });

  it('is made by the button itself: its width from `--hit-w`, its height from a transparent `::after` that is `--hit-h` high from the top of the button', () => {
    expect(table).toMatch(/\.sort\s*\{[^}]*min-width:\s*var\(--hit-w\)/);
    expect(table).toMatch(/\.sort::after\s*\{[^}]*top:\s*0[^}]*height:\s*var\(--hit-h\)/);
  });

  it('lets the head stand over the rows, so that the extension below the head is pressed as the head and not as the row under it', () => {
    expect(table).toMatch(/\.head\s*\{[^}]*z-index:\s*1/);
  });
});
