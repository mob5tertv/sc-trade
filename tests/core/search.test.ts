import { describe, expect, it } from 'vitest';
import { search } from '../../src/core/search';

const items = [
  { id: 1, code: 'GOLD', name: 'Gold' }, { id: 2, code: 'GOLM', name: 'Golden Medmon' },
  { id: 3, code: 'AGRI', name: 'Agricium' }, { id: 4, code: 'AGRS', name: 'Agricultural Supplies' },
  { id: 5, code: 'RMC', name: 'Recycled Material Composite' }, { id: 6, code: 'TITA', name: 'Titanium' },
  { id: 7, code: 'STIM', name: 'Stims' }, { id: 8, code: 'TDA18', name: 'TDD Area 18', aliases: ['ArcCorp'] },
];
const ids = (q: string, boost?: Set<number>) => search(items, q, boost).map(i => i.id);

describe('search', () => {
  it('matches code prefix case-insensitively', () => expect(ids('gol')).toEqual([1, 2]));
  it('boosts commodities traded here', () => expect(ids('gol', new Set([2]))).toEqual([2, 1]));
  it('resolves an ambiguous prefix alphabetically', () => expect(ids('AGR')).toEqual([3, 4]));
  it('ranks code prefix above word prefix above substring', () => { expect(ids('ti')).toEqual([6, 7]); expect(ids('mat')).toEqual([5]); expect(ids('tan')).toEqual([6]); });
  it('searches aliases', () => { expect(ids('area')).toEqual([8]); expect(ids('arc')).toEqual([8]); });
  it('returns nothing for a blank query', () => { expect(ids('')).toEqual([]); expect(ids('   ')).toEqual([]); });

  it('never lets a boost lift an item above a better match level', () => {
    // 'ti': Titanium is a code prefix, Stims is only a substring
    expect(ids('ti', new Set([7]))).toEqual([6, 7]);
  });
  it('matches a word start in the middle of a multi-word query', () => {
    expect(ids('golden m')).toEqual([2]);
    expect(ids('material c')).toEqual([5]);
  });
  it('treats punctuation as a word boundary', () => {
    const list = [{ id: 1, code: 'Z1', name: 'Zinc-Fuel' }, { id: 2, code: 'R1', name: 'Refueled' }];
    // Zinc-Fuel is a word-start match, Refueled a plain substring, although it sorts first alphabetically
    expect(search(list, 'fuel').map(i => i.id)).toEqual([1, 2]);
  });
  it('trims the query', () => expect(ids('  gol  ')).toEqual([1, 2]));
  it('caps the result at the limit, 8 by default', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, code: `AB${i}`, name: `Item ${String(i).padStart(2, '0')}` }));
    expect(search(many, 'ab')).toHaveLength(8);
    expect(search(many, 'ab', undefined, 3).map(i => i.id)).toEqual([1, 2, 3]);
  });
  it('does not mutate the input array', () => {
    const copy = [...items];
    search(items, 'gol');
    expect(items).toEqual(copy);
  });
});
