// A text that names the two ends of a route ('Port Tressler → TDD Area 18'), or a title that names a terminal, is shown in pieces that give way to
// each other equally (`components/PieceLine.svelte`): when the line is too short each piece that does not fit is cut with an ellipsis of its own,
// and a piece that fits is never cut for the sake of a long one: 'Port Tre… → TDD Are…', the arrow always there. Pure: the cutting of the text is here.

/** One piece of a line. `fixed`: it keeps its whole width and is never cut (the arrow, a short word before the route). */
export interface Piece { text: string; fixed?: boolean }

const ARROW = ' → ';

/**
 * 'Port Tressler → TDD Area 18' is the two ends and the arrow between them; a row of the history has the commodities in front of its route
 * ('GOLD: Everus Harbor → CRU-L1'): they stand as a piece of their own, whole. A text without an arrow ('GOLD: груз потерян', a dash) is one
 * piece, of which only the end may be cut.
 */
export function routePieces(text: string): Piece[] {
  const at = text.indexOf(ARROW);
  if (at < 0) return [{ text }];
  const left = text.slice(0, at);
  const to = text.slice(at + ARROW.length);
  const colon = left.indexOf(': ');
  const pieces: Piece[] = colon < 0 ? [] : [{ text: left.slice(0, colon + 1), fixed: true }];
  pieces.push({ text: colon < 0 ? left : left.slice(colon + 2) }, { text: '→', fixed: true }, { text: to });
  return pieces;
}

/**
 * A title that names a terminal ('Куда везти Gold с TDD Area 18 · покупка 5 088', in the header of the "Варианты"): what is asked, then where, the
 * terminal with what follows it ('TDD Area 18 · покупка 5 088'). The two give way equally, so that the name of the terminal is not the first thing a
 * narrow line loses: what follows it is cut before it is. `place` is the terminal as the title spells it; its LAST place in the title is the one (a
 * commodity before it may have the same word in its name). Without it in the title, or when nothing stands in front of it, the title is one piece.
 */
export function titlePieces(title: string, place: string): Piece[] {
  const at = place === '' ? -1 : title.lastIndexOf(place);
  const lead = at < 0 ? '' : title.slice(0, at).trim();
  if (lead === '') return [{ text: title }];
  return [{ text: lead }, { text: title.slice(at).trim() }];
}
