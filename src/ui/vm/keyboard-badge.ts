// The badge «Esc — в игру» of the headers (`KeyboardBadge.svelte`): what it says and in which of its two forms it fits.
// Only the display lives here; who holds the keyboard, and how it goes back, is `keyboard.ts` and `vm/keyboard-holds.ts`.

/** The plaque, as the player reads it. */
export const BADGE_TEXT = 'Esc — в игру';

/** The tooltip, and what the icon says where the plaque is too wide: the badge is a button, and the key does the same. */
export const BADGE_HINT = 'Клавиатура у окна: Esc или клик сюда возвращают её игре';

export type BadgeForm = 'full' | 'compact';

// The header of the expanded window is one flex row, and nothing in it wraps: the location field takes what the other parts leave, and
// it has a floor. The widths below are px, measured in the preview (`preview:shot`, scene `keyboard-badge`): the grip 20, the indicator
// of UEX 'UEX 12 мин' 67, «Маршрут» 66, the four icons 96, the gaps of 4, the right padding of 3 and the frame of 2; the floor of the
// location 60; «Я здесь» 56; the plaque 69. A longer text of the indicator ('UEX офлайн 12 мин') takes more: then the header squeezes
// the location under its floor while the badge is shown (the header does that, `.squeezed`), and does not push a button out.
const GRIP_UEX_ROUTE_ICONS = 20 + 67 + 66 + 96;
const GAPS_WITHOUT_BADGE = 4 * 4;
const PADDING_AND_FRAME = 3 + 2;
const LOCATION_FLOOR = 60;
const GAP = 4;
const HERE_BUTTON = 56;
const FULL_PLAQUE = 69;

/** The panel width from which the plaque fits beside a location field of its floor width, without «Я здесь». */
export const FULL_FITS_FROM = PADDING_AND_FRAME + GRIP_UEX_ROUTE_ICONS + GAPS_WITHOUT_BADGE + LOCATION_FLOOR + GAP + FULL_PLAQUE;

/** The same while «Я здесь» is in the header: its button and a gap more. */
export const FULL_FITS_FROM_WITH_HERE = FULL_FITS_FROM + GAP + HERE_BUTTON;

/**
 * Which form of the badge the header can hold: the plaque «Esc — в игру», or, where the plaque would squeeze the location field under
 * its floor (the default width with «Я здесь», the narrow window), the keyboard icon alone, which says the same in its tooltip.
 */
export function badgeForm(panelWidth: number, hereVisible: boolean): BadgeForm {
  return panelWidth >= (hereVisible ? FULL_FITS_FROM_WITH_HERE : FULL_FITS_FROM) ? 'full' : 'compact';
}
