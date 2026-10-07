import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/core/settings';
import { parseOpenSections, serializeOpenSections, toggledSection } from '../../src/ui/vm/sections';

describe('parseOpenSections', () => {
  it('reads ids separated by commas', () => {
    expect(parseOpenSections('terminal,options,settings:ship')).toEqual(new Set(['terminal', 'options', 'settings:ship']));
  });

  it('reads the default of the setting', () => {
    expect(parseOpenSections(DEFAULT_SETTINGS.openSections)).toEqual(new Set(['terminal', 'options', 'settings:ship']));
  });

  it('reads an empty text as no open section', () => {
    expect(parseOpenSections('')).toEqual(new Set());
    expect(parseOpenSections('   ')).toEqual(new Set());
  });

  it('drops empty pieces and trims the rest', () => {
    expect(parseOpenSections(',,terminal,, options ,  ,')).toEqual(new Set(['terminal', 'options']));
  });

  it('keeps one of the repeated ids', () => {
    const open = parseOpenSections('run,run,terminal,run');
    expect(open.size).toBe(2);
    expect(open.has('run')).toBe(true);
  });

  it('survives what a hand-edited or corrupt database may hold', () => {
    expect(parseOpenSections(undefined as unknown as string)).toEqual(new Set());
    expect(parseOpenSections(null as unknown as string)).toEqual(new Set());
    expect(parseOpenSections(42 as unknown as string)).toEqual(new Set());
    expect(parseOpenSections(['terminal'] as unknown as string)).toEqual(new Set());
  });

  it('does not know which ids exist: an unknown id is kept, the screens ignore it', () => {
    expect(parseOpenSections('no-such-section')).toEqual(new Set(['no-such-section']));
  });
});

describe('serializeOpenSections', () => {
  it('writes the ids alphabetically, separated by commas', () => {
    expect(serializeOpenSections(new Set(['terminal', 'options', 'settings:ship']))).toBe('options,settings:ship,terminal');
  });

  it('writes the same text whatever the order the set was filled in', () => {
    expect(serializeOpenSections(new Set(['b', 'a', 'c']))).toBe(serializeOpenSections(new Set(['c', 'a', 'b'])));
  });

  it('writes an empty set as an empty text', () => {
    expect(serializeOpenSections(new Set())).toBe('');
  });

  it('leaves out empty ids', () => {
    expect(serializeOpenSections(new Set(['', 'a', '  ']))).toBe('a');
  });

  it('round-trips through parse', () => {
    const open = new Set(['terminal', 'run', 'settings:ship']);
    expect(parseOpenSections(serializeOpenSections(open))).toEqual(open);
    expect(parseOpenSections(serializeOpenSections(new Set()))).toEqual(new Set());
  });
});

describe('toggledSection', () => {
  it('opens a closed section', () => {
    expect(toggledSection(new Set(['terminal']), 'run')).toEqual(new Set(['terminal', 'run']));
  });

  it('closes an open section', () => {
    expect(toggledSection(new Set(['terminal', 'run']), 'run')).toEqual(new Set(['terminal']));
  });

  it('toggles twice back to where it was', () => {
    const open = new Set(['terminal']);
    expect(toggledSection(toggledSection(open, 'run'), 'run')).toEqual(open);
  });

  it('does not change the set it was given', () => {
    const open = new Set(['terminal']);
    toggledSection(open, 'run');
    toggledSection(open, 'terminal');
    expect(open).toEqual(new Set(['terminal']));
  });

  it('leaves the set as it is for an id that cannot be stored (empty, or with a comma)', () => {
    const open = new Set(['terminal']);
    expect(toggledSection(open, '')).toEqual(open);
    expect(toggledSection(open, '  ')).toEqual(open);
    expect(toggledSection(open, 'a,b')).toEqual(open);
  });
});
