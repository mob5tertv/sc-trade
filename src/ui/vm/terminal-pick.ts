// What choosing a terminal in the field of the location does (spec 14.2, version 1.1). The window decides it here; `state.svelte.ts` carries it
// out (`app.pickTerminal`). A choice always makes the terminal the one the window looks at. Whether it also becomes the CURRENT location
// ("Я здесь") depends on whether the player is in a run: with none he is simply telling where he stands, in a run he may be reading the prices
// of a far station and must not lose the "from" of his trip.

/** What the choice does: the terminal is only viewed (`view`), or viewed and made the current location too (`here`). */
export type PickEffect = 'view' | 'here';

export interface PickContext {
  /** A run is going (the hold may be full and the ship under way). */
  runGoing: boolean;
  /** The choice was made with Ctrl held (Ctrl+Enter): "Я здесь", whatever else is true. */
  ctrl: boolean;
  /** The field asks "Где прилетел?" (an arrival was marked with no target): the next terminal is where the ship has landed. */
  askingWhere: boolean;
}

export function pickEffect({ runGoing, ctrl, askingWhere }: PickContext): PickEffect {
  return ctrl || askingWhere || !runGoing ? 'here' : 'view';
}

/**
 * The field asks "Где прилетел?" after an arrival that was written with no target: with a target the window moves to it by itself
 * (`arrivalView`), without one nothing tells where the ship has landed. A take-off does not ask.
 */
export function arrivalAsksWhere(type: 'depart' | 'arrive', targetTerminalId: number | null): boolean {
  return type === 'arrive' && targetTerminalId === null;
}

const LOCATION_PLACEHOLDER = 'Локация…';
export const WHERE_ARRIVED_PLACEHOLDER = 'Где прилетел?';

/** The placeholder of the field: the question while it asks where the ship has landed. */
export function locationPlaceholder(askingWhere: boolean): string {
  return askingWhere ? WHERE_ARRIVED_PLACEHOLDER : LOCATION_PLACEHOLDER;
}

const HINT_NO_RUN = 'Enter — посмотреть терминал и сделать его локацией («Я здесь»). Ctrl+Enter — «Я здесь» всегда, и в рейсе.';
const HINT_RUN = 'Enter — только посмотреть терминал: твоё «откуда» не меняется. Ctrl+Enter — «Я здесь», сделать его локацией.';
const HINT_ASKING = 'Где прилетел? Enter или Ctrl+Enter — этот терминал станет локацией («Я здесь»).';

/**
 * The tooltip of the field: what it says of the terminal that is shown (`base`), then what Enter and Ctrl+Enter do now. While the field asks
 * "Где прилетел?" it shows no terminal and the tooltip is the question alone.
 */
export function locationFieldTitle(base: string, { runGoing, askingWhere }: Pick<PickContext, 'runGoing' | 'askingWhere'>): string {
  if (askingWhere) return HINT_ASKING;
  return `${base}\n${runGoing ? HINT_RUN : HINT_NO_RUN}`;
}
