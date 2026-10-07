import { describe, expect, it } from 'vitest';
import type { StarSystem } from '../../src/core/types';
import { terminalFullPlace, terminalPlace } from '../../src/ui/vm/terminal-place';
import { term } from '../helpers/factories';

const SYSTEMS: StarSystem[] = [
  { id: 68, name: 'Stanton', code: '', isAvailableLive: true },
  { id: 99, name: 'Pyro', code: '', isAvailableLive: true },
];

describe('terminalPlace: where a terminal is, in one short line', () => {
  it('is the system and the planet', () => {
    const everus = term(9, { displayname: 'Everus Harbor', starSystemName: 'Stanton', planetName: 'Hurston', spaceStationName: 'Everus Harbor' });
    expect(terminalPlace(everus)).toBe('Stanton · Hurston');
  });

  it('puts the moon before the planet, and says only one of them', () => {
    const grim = term(13, { displayname: 'GrimHEX', starSystemName: 'Stanton', planetName: 'Crusader', moonName: 'Yela', outpostName: 'GrimHEX' });
    expect(terminalPlace(grim)).toBe('Stanton · Yela');
  });

  it('is the system alone when nothing more is known', () => {
    expect(terminalPlace(term(1, { displayname: 'Somewhere', starSystemName: 'Nyx' }))).toBe('Nyx');
  });

  it('is empty when nothing at all is known', () => {
    expect(terminalPlace(term(1, { displayname: 'Somewhere' }))).toBe('');
  });

  it('takes the name of the system from the list when the terminal does not carry it', () => {
    expect(terminalPlace(term(1, { starSystemId: 99, planetName: 'Pyro IV' }), SYSTEMS)).toBe('Pyro · Pyro IV');
    expect(terminalPlace(term(1, { starSystemId: 99 }), SYSTEMS)).toBe('Pyro');
    expect(terminalPlace(term(1, { starSystemId: 1234 }), SYSTEMS)).toBe('');
  });
  it('prefers the name the terminal carries to the list', () => {
    expect(terminalPlace(term(1, { starSystemId: 99, starSystemName: 'Stanton' }), SYSTEMS)).toBe('Stanton');
  });

  describe('does not say again what the name of the terminal says', () => {
    it('skips a planet that is in the name', () => {
      const t = term(1, { displayname: 'ArcCorp Mining Area 141', starSystemName: 'Stanton', planetName: 'ArcCorp' });
      expect(terminalPlace(t)).toBe('Stanton');
    });
    it('skips a moon that is in the name and falls back to the planet', () => {
      const t = term(1, { displayname: 'Yela Outpost', starSystemName: 'Stanton', planetName: 'Crusader', moonName: 'Yela' });
      expect(terminalPlace(t)).toBe('Stanton · Crusader');
    });
    it('looks at every name of the terminal, whatever case it is written in', () => {
      const t = term(1, { displayname: 'Admin Office', nickname: 'HURSTON Admin', name: 'Admin - Hurston', starSystemName: 'Stanton', planetName: 'Hurston' });
      expect(terminalPlace(t)).toBe('Stanton');
    });
    it('does not say the system twice', () => {
      const ruin = term(14, { displayname: 'Ruin Station', starSystemName: 'Pyro', planetName: 'Pyro', spaceStationName: 'Ruin Station' });
      expect(terminalPlace(ruin)).toBe('Pyro');
    });
    it('does not call a part repeated when only the name is part of it', () => {
      // the name is shorter than the station: the station tells more than the name does
      const t = term(1, { displayname: 'Admin - ARC-L1', starSystemName: 'Stanton', spaceStationName: 'ARC-L1 Wide Forest Station' });
      expect(terminalPlace(t)).toBe('Stanton · ARC-L1 Wide Forest Station');
    });
  });

  describe('the city, the station and the outpost: the next best thing when there is no moon or planet to say', () => {
    it('says the city that is not in the name', () => {
      expect(terminalPlace(term(1, { displayname: 'Admin Office', starSystemName: 'Stanton', cityName: 'Lorville' }))).toBe('Stanton · Lorville');
    });
    it('says nothing of a city or a station that is in the name', () => {
      expect(terminalPlace(term(1, { displayname: 'Lorville TDD', starSystemName: 'Stanton', cityName: 'Lorville' }))).toBe('Stanton');
      expect(terminalPlace(term(1, { displayname: 'Seraphim Station', starSystemName: 'Stanton', spaceStationName: 'Seraphim Station' }))).toBe('Stanton');
    });
    it('prefers the city to the station and the station to the outpost', () => {
      const t = term(1, { displayname: 'Office', starSystemName: 'Stanton', cityName: 'Orison', spaceStationName: 'Seraphim Station', outpostName: 'Hut' });
      expect(terminalPlace(t)).toBe('Stanton · Orison');
      expect(terminalPlace({ ...t, cityName: null })).toBe('Stanton · Seraphim Station');
      expect(terminalPlace({ ...t, cityName: null, spaceStationName: null })).toBe('Stanton · Hut');
    });
    it('is a moon or a planet first when there is one', () => {
      const t = term(1, { displayname: 'Office', starSystemName: 'Stanton', planetName: 'Hurston', cityName: 'Lorville' });
      expect(terminalPlace(t)).toBe('Stanton · Hurston');
    });
  });

  it('skips empty and blank parts', () => {
    const t = term(1, { displayname: 'X', starSystemName: ' Stanton ', planetName: '   ', moonName: '', cityName: null });
    expect(terminalPlace(t)).toBe('Stanton');
  });
});

describe('terminalFullPlace: where a terminal is, whole', () => {
  it('goes from the system down: planet, moon, then the city, the station and the outpost', () => {
    const t = term(1, {
      displayname: 'Admin Office', starSystemName: 'Stanton', planetName: 'Crusader', moonName: 'Yela', cityName: 'Orison',
      spaceStationName: 'Seraphim Station', outpostName: 'Hut',
    });
    expect(terminalFullPlace(t)).toBe('Stanton · Crusader · Yela · Orison · Seraphim Station · Hut');
  });
  it('leaves out what the name says and what was said already', () => {
    const grim = term(13, { displayname: 'GrimHEX', starSystemName: 'Stanton', planetName: 'Crusader', moonName: 'Yela', outpostName: 'GrimHEX' });
    expect(terminalFullPlace(grim)).toBe('Stanton · Crusader · Yela');
    const ruin = term(14, { displayname: 'Ruin Station', starSystemName: 'Pyro', planetName: 'Pyro', spaceStationName: 'Ruin Station' });
    expect(terminalFullPlace(ruin)).toBe('Pyro');
    const same = term(1, { displayname: 'X', starSystemName: 'Stanton', planetName: 'Hurston', moonName: 'hurston' });
    expect(terminalFullPlace(same)).toBe('Stanton · Hurston');
  });
  it('is empty when nothing is known, and takes the system from the list', () => {
    expect(terminalFullPlace(term(1))).toBe('');
    expect(terminalFullPlace(term(1, { starSystemId: 68, planetName: 'Hurston' }), SYSTEMS)).toBe('Stanton · Hurston');
  });
  it('says every part of the short line', () => {
    const terminals = [
      term(1, { displayname: 'Office', starSystemName: 'Stanton', cityName: 'Lorville' }),
      term(2, { displayname: 'GrimHEX', starSystemName: 'Stanton', planetName: 'Crusader', moonName: 'Yela' }),
      term(3, { displayname: 'Somewhere', starSystemName: 'Nyx' }),
    ];
    for (const t of terminals) {
      const whole = terminalFullPlace(t).split(' · ');
      for (const part of terminalPlace(t).split(' · ').filter((p) => p !== '')) expect(whole).toContain(part);
    }
  });
});
