import { describe, expect, it } from 'vitest';
import { terminalFullName, terminalLabel, terminalName } from '../../src/ui/vm/terminal-name';
import { ref, term } from '../helpers/factories';

// The terminal of the trader's complaint: the nickname and the display name say the same words in another order.
const AREA_18 = term(5, { nickname: 'TDD Area 18', displayname: 'Area 18 TDD', name: 'TDD - Area 18' });
const WITH_REFERENCE = { ...ref, terminals: new Map([...ref.terminals, [5, AREA_18]]) };

describe('terminalName: the one short name of a terminal, the one players know it by', () => {
  it('is the nickname, not the display name', () => {
    expect(terminalName(AREA_18)).toBe('TDD Area 18');
    expect(terminalName(ref.terminals.get(1)!)).toBe('ARC-L1');
  });

  it('falls back to the display name, then to the name, where UEX leaves the nickname empty', () => {
    expect(terminalName(term(7, { nickname: '', displayname: 'Area 18 TDD', name: 'TDD - Area 18' }))).toBe('Area 18 TDD');
    expect(terminalName(term(7, { nickname: '', displayname: '', name: 'TDD - Area 18' }))).toBe('TDD - Area 18');
  });
});

describe('terminalFullName: the official name, for a tooltip', () => {
  it('is the display name, which names the station in full', () => {
    expect(terminalFullName(ref.terminals.get(1)!)).toBe('ARC-L1 Wide Forest Station');
    expect(terminalFullName(AREA_18)).toBe('Area 18 TDD');
  });

  it('falls back to the nickname, then to the name', () => {
    expect(terminalFullName(ref.terminals.get(3)!)).toBe('CRU-L1');
    expect(terminalFullName(term(7, { nickname: '', displayname: '', name: 'TDD - Area 18' }))).toBe('TDD - Area 18');
  });
});

describe('terminalLabel: a terminal of the reference by its id', () => {
  it('is the short name, the same one wherever a terminal is named', () => {
    expect(terminalLabel(WITH_REFERENCE, 5)).toBe(terminalName(AREA_18));
    expect(terminalLabel(WITH_REFERENCE, 1)).toBe('ARC-L1');
  });

  it('shows the id of a terminal that left the reference', () => {
    expect(terminalLabel(ref, 777)).toBe('#777');
  });
});
