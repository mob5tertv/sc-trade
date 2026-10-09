import { describe, expect, it } from 'vitest';
import { routePieces, titlePieces } from '../../src/ui/vm/route-pieces';

// A text that names the two ends of a route ('Port Tressler → TDD Area 18') or a title that names a terminal is cut in pieces, each with its own
// ellipsis, so that both ends of the route give way equally and the arrow is always there ('Port Tre… → TDD Are…'). Pure: the pieces are made here,
// the line that draws them is `components/PieceLine.svelte`.

describe('routePieces', () => {
  it('cuts a route at its arrow: the two ends can be shortened, the arrow cannot', () => {
    expect(routePieces('Port Tressler → TDD Area 18')).toEqual([
      { text: 'Port Tressler' }, { text: '→', fixed: true }, { text: 'TDD Area 18' },
    ]);
  });

  it('keeps the commodities of a row of the history in front of the route, whole: "GOLD:" is a short word that is never cut', () => {
    expect(routePieces('GOLD: Everus Harbor → CRU-L1')).toEqual([
      { text: 'GOLD:', fixed: true }, { text: 'Everus Harbor' }, { text: '→', fixed: true }, { text: 'CRU-L1' },
    ]);
    expect(routePieces('смеш.: HUR-L1 → ARC-L1')).toEqual([
      { text: 'смеш.:', fixed: true }, { text: 'HUR-L1' }, { text: '→', fixed: true }, { text: 'ARC-L1' },
    ]);
    expect(routePieces('GOLD, TITA: HUR-L1 → ARC-L1')[0]).toEqual({ text: 'GOLD, TITA:', fixed: true });
  });

  it('leaves a text that has no route in one piece: only its end may be cut', () => {
    expect(routePieces('GOLD: груз потерян')).toEqual([{ text: 'GOLD: груз потерян' }]);
    expect(routePieces('GOLD: смешанный рейс')).toEqual([{ text: 'GOLD: смешанный рейс' }]);
    expect(routePieces('—')).toEqual([{ text: '—' }]);
    expect(routePieces('')).toEqual([{ text: '' }]);
  });

  it('takes a dash for an end that is not known', () => {
    expect(routePieces('смеш.: — → ARC-L1')).toEqual([
      { text: 'смеш.:', fixed: true }, { text: '—' }, { text: '→', fixed: true }, { text: 'ARC-L1' },
    ]);
  });

  it('gives back the very same text when the pieces are put together again with a space between them', () => {
    for (const text of ['Port Tressler → TDD Area 18', 'GOLD: Everus Harbor → CRU-L1', 'GOLD: груз потерян', '—', 'смеш.: — → ARC-L1']) {
      expect(routePieces(text).map((piece) => piece.text).join(' ')).toBe(text);
    }
  });
});

describe('titlePieces: a title of the "Варианты" with the terminal it is about', () => {
  it('stands apart what is asked (the front) and where it is asked about (the terminal and what follows it): two ends that give way equally', () => {
    expect(titlePieces('Куда везти Gold с TDD Area 18 · покупка 5 088', 'TDD Area 18')).toEqual([
      { text: 'Куда везти Gold с' }, { text: 'TDD Area 18 · покупка 5 088' },
    ]);
  });

  it('has the terminal alone in the second piece when the title ends with it', () => {
    expect(titlePieces('Где купить Gold для HUR-L1', 'HUR-L1')).toEqual([{ text: 'Где купить Gold для' }, { text: 'HUR-L1' }]);
  });

  it('keeps the mark of a preliminary answer in the front, and the count of the distances with the terminal', () => {
    expect(titlePieces('≈ Куда везти с HUR-L1 и рядом · расстояния 7/15', 'HUR-L1')).toEqual([
      { text: '≈ Куда везти с' }, { text: 'HUR-L1 и рядом · расстояния 7/15' },
    ]);
  });

  it('is one piece when the terminal is not in the title, or starts it (nothing in front of it to stand apart)', () => {
    expect(titlePieces('Куда везти с HUR-L1', 'ARC-L1')).toEqual([{ text: 'Куда везти с HUR-L1' }]);
    expect(titlePieces('Куда везти с HUR-L1', '')).toEqual([{ text: 'Куда везти с HUR-L1' }]);
    expect(titlePieces('HUR-L1 · куда везти', 'HUR-L1')).toEqual([{ text: 'HUR-L1 · куда везти' }]);
    expect(titlePieces('', 'HUR-L1')).toEqual([{ text: '' }]);
  });

  it('takes the last place of the terminal: a commodity that has the name of the terminal in its own does not move the cut', () => {
    expect(titlePieces('Где купить Medical для Medical', 'Medical')).toEqual([{ text: 'Где купить Medical для' }, { text: 'Medical' }]);
  });

  it('gives back the very same title when the pieces are put together again with a space between them', () => {
    const title = 'Куда везти Gold с TDD Area 18 и рядом · покупка 5 088';
    expect(titlePieces(title, 'TDD Area 18').map((piece) => piece.text).join(' ')).toBe(title);
  });
});
