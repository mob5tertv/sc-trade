import { describe, expect, it } from 'vitest';
import { optionsSummary } from '../../src/ui/vm/options-summary';

const TITLE = 'Куда везти с HUR-L1';

describe('optionsSummary', () => {
  it('is the title of the request for a final answer', () => {
    expect(optionsSummary({ title: TITLE, preliminary: false, progress: null })).toBe(TITLE);
  });

  it('marks a preliminary answer with ≈ before the title', () => {
    expect(optionsSummary({ title: TITLE, preliminary: true, progress: null })).toBe(`≈ ${TITLE}`);
  });

  it('adds the count of distances while they are being fetched', () => {
    expect(optionsSummary({ title: TITLE, preliminary: true, progress: { done: 7, total: 15 } })).toBe(`≈ ${TITLE} · расстояния 7/15`);
    expect(optionsSummary({ title: TITLE, preliminary: true, progress: { done: 0, total: 15 } })).toBe(`≈ ${TITLE} · расстояния 0/15`);
  });

  it('shows the count even when the answer is not marked (the count alone is the sign that it is moving)', () => {
    expect(optionsSummary({ title: TITLE, preliminary: false, progress: { done: 3, total: 4 } })).toBe(`${TITLE} · расстояния 3/4`);
  });

  it('says nothing of a count that is not one (nothing to fetch)', () => {
    expect(optionsSummary({ title: TITLE, preliminary: true, progress: { done: 0, total: 0 } })).toBe(`≈ ${TITLE}`);
  });

  it('is empty for a request without a title', () => {
    expect(optionsSummary({ title: '', preliminary: false, progress: null })).toBe('');
  });
});
