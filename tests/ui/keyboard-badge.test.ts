import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/core/settings';
import { badgeForm, BADGE_HINT, BADGE_TEXT, FULL_FITS_FROM, FULL_FITS_FROM_WITH_HERE } from '../../src/ui/vm/keyboard-badge';

describe('badgeForm', () => {
  it('is the whole plaque in the window of the default width while the header has no «Я здесь»', () => {
    expect(badgeForm(DEFAULT_SETTINGS.panelWidth, false)).toBe('full');
  });

  it('is the keyboard icon at the default width when «Я здесь» is there: the location field would be squeezed under its floor', () => {
    expect(badgeForm(DEFAULT_SETTINGS.panelWidth, true)).toBe('compact');
  });

  it('is the icon in the narrowest window, with or without «Я здесь»', () => {
    expect(badgeForm(380, false)).toBe('compact');
    expect(badgeForm(380, true)).toBe('compact');
  });

  it('is the whole plaque in the widest window, with or without «Я здесь»', () => {
    expect(badgeForm(640, false)).toBe('full');
    expect(badgeForm(640, true)).toBe('full');
  });

  it('changes at the measured widths, and «Я здесь» (its button and a gap) moves the change up by its own width', () => {
    expect(badgeForm(FULL_FITS_FROM - 1, false)).toBe('compact');
    expect(badgeForm(FULL_FITS_FROM, false)).toBe('full');
    expect(badgeForm(FULL_FITS_FROM_WITH_HERE - 1, true)).toBe('compact');
    expect(badgeForm(FULL_FITS_FROM_WITH_HERE, true)).toBe('full');
    expect(FULL_FITS_FROM_WITH_HERE).toBeGreaterThan(FULL_FITS_FROM);
  });

  it('is never the plaque below the width the settings allow, and the widths the settings allow are on both sides of the change', () => {
    expect(FULL_FITS_FROM).toBeGreaterThan(380);
    expect(FULL_FITS_FROM_WITH_HERE).toBeLessThan(640);
  });
});

describe('the words of the badge', () => {
  it('say what to press and where the keyboard goes, and the hint says the badge is a button too', () => {
    expect(BADGE_TEXT).toBe('Esc — в игру');
    expect(BADGE_HINT).toContain('Esc');
    expect(BADGE_HINT).toContain('клик');
  });
});
