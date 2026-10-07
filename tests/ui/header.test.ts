import { describe, expect, it } from 'vitest';
import { commoditySearchItems, headerModel, searchTerminals, terminalSearchItems } from '../../src/ui/vm/header';
import { DEFAULT_SETTINGS } from '../../src/core/settings';
import { search } from '../../src/core/search';
import type { Terminal } from '../../src/core/types';
import { ref, term } from '../helpers/factories';

const NOW = 1_790_000_000;   // fixed Unix seconds

describe('headerModel', () => {
  it('describes location, ship and system', () => {
    const h = headerModel(ref, { ...DEFAULT_SETTINGS, currentTerminalId: 1, vehicleId: 7, scuCapacity: 696, starSystemId: 68 }, NOW - 1500, true, NOW);
    expect(h).toEqual({ location: 'ARC-L1 Wide Forest Station', ship: 'C2 Hercules · 696 SCU', system: 'Stanton', uex: 'UEX 25 мин назад', uexStale: false });
  });
  it('covers unset values', () => {
    const h = headerModel(ref, DEFAULT_SETTINGS, null, true, NOW);
    expect(h).toMatchObject({ location: 'Локация не выбрана', ship: 'Корабль не выбран', system: 'Все системы', uex: 'UEX ещё не загружен' });
  });
  it('flags an unreachable UEX with the cache date', () => {
    const h = headerModel(ref, DEFAULT_SETTINGS, Date.UTC(2026, 9, 6, 14, 5) / 1000, false, NOW);
    expect(h.uexStale).toBe(true); expect(h.uex).toMatch(/^UEX недоступен, данные от 06\.10 \d\d:05$/);
  });
  it('survives a current terminal that left the reference', () => {
    expect(headerModel(ref, { ...DEFAULT_SETTINGS, currentTerminalId: 777 }, NOW, true, NOW).location).toBe('Локация не выбрана');
  });
  it('prints the cache date in local time, zero-padded', () => {
    const local = new Date(2026, 0, 5, 9, 7).getTime() / 1000;
    expect(headerModel(ref, DEFAULT_SETTINGS, local, false, NOW).uex).toBe('UEX недоступен, данные от 05.01 09:07');
  });
  it('flags an unreachable UEX that never synced', () => {
    const h = headerModel(ref, DEFAULT_SETTINGS, null, false, NOW);
    expect(h.uexStale).toBe(true); expect(h.uex).toBe('UEX недоступен');
  });
  it('words a fresh and an old sync', () => {
    expect(headerModel(ref, DEFAULT_SETTINGS, NOW - 30, true, NOW).uex).toBe('UEX сейчас');
    expect(headerModel(ref, DEFAULT_SETTINGS, NOW, true, NOW).uex).toBe('UEX сейчас');
    expect(headerModel(ref, DEFAULT_SETTINGS, NOW - 5400, true, NOW).uex).toBe('UEX 1,5 ч назад');
    expect(headerModel(ref, DEFAULT_SETTINGS, NOW - 2 * 86_400, true, NOW).uex).toBe('UEX 2 д назад');
  });
  it('treats a sync stamp from the future as just now', () => {
    expect(headerModel(ref, DEFAULT_SETTINGS, NOW + 600, true, NOW).uex).toBe('UEX сейчас');
  });
  it('falls back to nickname when a terminal has no display name', () => {
    expect(headerModel(ref, { ...DEFAULT_SETTINGS, currentTerminalId: 3 }, NOW, true, NOW).location).toBe('CRU-L1');
  });
  it('keeps the editable SCU of the settings, not the catalogue one', () => {
    const s = { ...DEFAULT_SETTINGS, vehicleId: 7, scuCapacity: 500 };
    expect(headerModel(ref, s, NOW, true, NOW).ship).toBe('C2 Hercules · 500 SCU');
  });
  it('survives a ship that left the reference or has no SCU set', () => {
    expect(headerModel(ref, { ...DEFAULT_SETTINGS, vehicleId: 999, scuCapacity: 0 }, NOW, true, NOW).ship).toBe('Корабль не выбран');
    expect(headerModel(ref, { ...DEFAULT_SETTINGS, vehicleId: 999, scuCapacity: 120 }, NOW, true, NOW).ship).toBe('120 SCU');
    expect(headerModel(ref, { ...DEFAULT_SETTINGS, vehicleId: 7, scuCapacity: 0 }, NOW, true, NOW).ship).toBe('C2 Hercules');
  });
  it('survives a star system that left the reference', () => {
    expect(headerModel(ref, { ...DEFAULT_SETTINGS, starSystemId: 12345 }, NOW, true, NOW).system).toBe('Все системы');
  });
});

describe('terminalSearchItems', () => {
  it('filters terminals by system and exposes aliases', () => {
    const items = terminalSearchItems(ref, 68);
    expect(items.every(i => ref.terminals.get(i.id)!.starSystemId === 68)).toBe(true);
    expect(items.find(i => i.id === 1)!.aliases).toContain('ARC-L1');
  });
  it('lists every system when none is chosen', () => {
    expect(terminalSearchItems(ref, null).map(i => i.id)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(terminalSearchItems(ref, 99).map(i => i.id)).toEqual([4]);
  });
  it('names an item after its display name and keeps the other names as aliases; the system is kept apart, not among them', () => {
    const t = { ...ref.terminals.get(1)!, name: 'Wide Forest', code: 'ARCL1', planetName: 'ArcCorp' };
    const item = terminalSearchItems({ ...ref, terminals: new Map([[1, t]]) }, null)[0];
    expect(item).toEqual({
      id: 1, code: 'ARCL1', name: 'ARC-L1 Wide Forest Station', aliases: ['ARC-L1', 'Wide Forest', 'ArcCorp'],
      system: 'Stanton', place: 'Stanton · ArcCorp', title: 'ARC-L1 Wide Forest Station\nStanton · ArcCorp',
    });
  });
  it('drops empty aliases and falls back to the nickname without a display name', () => {
    const item = terminalSearchItems(ref, null).find(i => i.id === 3)!;
    expect(item.name).toBe('CRU-L1');
    expect(item.aliases).toEqual(['CRU-L1']);
  });

  describe('where a terminal is', () => {
    const gateway = (id: number, starSystemId: number, partial: Partial<Terminal> = {}): Terminal =>
      term(id, { displayname: 'Stanton Gateway', nickname: 'Stanton Gateway', code: `SG${id}`, starSystemId, ...partial });
    const gateways = {
      ...ref,
      terminals: new Map([
        [20, gateway(20, 99, { planetName: 'Pyro', spaceStationName: 'Stanton Gateway' })],
        [21, gateway(21, 99, { moonName: 'Ignis', planetName: 'Pyro' })],
        [22, gateway(22, 68)],
      ]),
    };

    it('says it beside every item: the system and the planet or the moon, the same short line as the place of the terminal', () => {
      const items = terminalSearchItems(gateways, null);
      expect(items.map(i => [i.id, i.place])).toEqual([[20, 'Pyro'], [21, 'Pyro · Ignis'], [22, 'Stanton']]);
    });
    it('keeps the whole place and the whole name for the tooltip of the item', () => {
      const items = terminalSearchItems(gateways, null);
      expect(items.find(i => i.id === 21)!.title).toBe('Stanton Gateway\nPyro · Ignis');
    });
    it('leaves the place out when nothing is known of it', () => {
      const item = terminalSearchItems({ ...ref, terminals: new Map([[7, term(7, { nickname: 'Nowhere', code: 'NW' })]]), starSystems: [] }, null)[0];
      expect(item).toEqual({ id: 7, code: 'NW', name: 'Nowhere', aliases: ['Nowhere'], title: 'Nowhere' });
    });
    it('is searchable by the name of the system (see searchTerminals), but not by the plain search: the system is no alias', () => {
      expect(searchTerminals(terminalSearchItems(ref, null), 'pyro', undefined, 8).map(i => i.id)).toEqual([4]);
      expect(searchTerminals(terminalSearchItems(gateways, null), 'pyro', undefined, 8).map(i => i.id)).toEqual([20, 21]);
      expect(search(terminalSearchItems(ref, null), 'pyro').map(i => i.id)).toEqual([]);
    });
    it('keeps the place on the items the search returns, so that the box can draw it', () => {
      const found = searchTerminals(terminalSearchItems(gateways, null), 'stanton g', undefined, 8);
      expect(found.map(i => i.id)).toEqual([20, 21, 22]);
      expect(found.map(i => i.place)).toEqual(['Pyro', 'Pyro · Ignis', 'Stanton']);
    });
  });

  // The system is a way to find a terminal, but a weaker one than its own name: typing "stanton" must show the terminals named
  // "Stanton Gateway" before the first few of the many terminals that merely stand in Stanton.
  describe('searchTerminals: a terminal found by its name comes before one found by its star system', () => {
    const LIMIT = 8;
    const STANTON_NAMES = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'India', 'Juliet'];
    const systems = {
      ...ref,
      starSystems: [...ref.starSystems, { id: 100, name: 'Nyx', code: '', isAvailableLive: true }],
    };
    // ten terminals that stand in Stanton and say nothing of it in their names, two "Stanton Gateway" in Pyro and Nyx, and two more
    // in Pyro: one whose name has "sta" inside a word ("Mustang"), one with a word that starts with it ("Station")
    const world = {
      ...systems,
      terminals: new Map<number, Terminal>([
        ...STANTON_NAMES.map((name, i): [number, Terminal] => [i + 1, term(i + 1, { nickname: `${name} Depot`, code: `D${i + 1}`, starSystemId: 68 })]),
        [30, term(30, { nickname: 'Stanton Gateway', code: 'SGP', starSystemId: 99 })],
        [31, term(31, { nickname: 'Stanton Gateway', code: 'SGN', starSystemId: 100 })],
        [40, term(40, { nickname: 'Ruin Station', code: 'RUIN', starSystemId: 99 })],
        [41, term(41, { nickname: 'Mustang Base', code: 'MUST', starSystemId: 99 })],
      ]),
    };
    const items = terminalSearchItems(world, null);
    const ids = (found: Array<{ id: number }>): number[] => found.map(i => i.id);

    it('puts both "Stanton Gateway" first when the name of the system is typed, then the terminals that only stand there', () => {
      const found = ids(searchTerminals(items, 'stanton', undefined, LIMIT));
      expect(found.slice(0, 2)).toEqual([30, 31]);
      expect(found).toHaveLength(LIMIT);
      expect(found.slice(2)).toEqual([1, 2, 3, 4, 5, 6]); // the first of the system by name
      // the plain search (the system among the aliases) would have pushed the gateways out of the eight
      const naive = search(items.map(i => ({ ...i, aliases: [...(i.aliases ?? []), i.system ?? ''] })), 'stanton', undefined, LIMIT);
      expect(ids(naive)).not.toContain(30);
    });
    const byNumber = (a: number, b: number): number => a - b;
    it('does the same with three letters of it: the terminals that have them in their names, then the ones that stand in the system', () => {
      const found = ids(searchTerminals(items, 'sta', undefined, LIMIT));
      expect(found.slice(0, 4).sort(byNumber)).toEqual([30, 31, 40, 41]);
      expect(found.slice(4).every(id => id <= 10)).toBe(true);
      expect(found).toHaveLength(LIMIT);
    });
    it('puts a match by the name of any rank before one by the system alone', () => {
      // "stan" starts the word "Stanton" (a system: the strongest rank) and is only inside "Mustang" (a name: the weakest rank)
      const found = ids(searchTerminals(items, 'stan', undefined, LIMIT));
      expect(found.slice(0, 3)).toEqual([30, 31, 41]);
      expect(found.slice(3)).toEqual([1, 2, 3, 4, 5]);
    });
    it('still finds the terminals of a system by its name', () => {
      expect(ids(searchTerminals(items, 'pyro', undefined, LIMIT))).toEqual([41, 40, 30]); // by name: Mustang Base, Ruin Station, Stanton Gateway
      expect(ids(searchTerminals(items, 'nyx', undefined, LIMIT))).toEqual([31]);
    });
    it('keeps the order of the boosted terminals inside each of the two groups', () => {
      const found = ids(searchTerminals(items, 'stanton', new Set([10, 9]), LIMIT));
      expect(found.slice(0, 2).sort(byNumber)).toEqual([30, 31]);
      expect(found.slice(2, 4)).toEqual([9, 10]);
    });
    it('is the plain search for a query that matches nothing by the system', () => {
      for (const query of ['alpha', 'ruin', 'sg', 'stati', 'zzz']) {
        expect(ids(searchTerminals(items, query, new Set([5]), LIMIT)), query).toEqual(ids(search(items, query, new Set([5]), LIMIT)));
      }
    });
    it('is empty for an empty query', () => {
      expect(searchTerminals(items, '  ', undefined, LIMIT)).toEqual([]);
    });
    it('respects the limit and names no terminal twice', () => {
      for (const limit of [1, 2, 3, 8, 12, 50]) {
        const found = ids(searchTerminals(items, 'stanton', undefined, limit));
        expect(found.length).toBeLessThanOrEqual(limit);
        expect(new Set(found).size).toBe(found.length);
      }
      expect(ids(searchTerminals(items, 'stanton', undefined, 1)).length).toBe(1);
      expect(searchTerminals(items, 'stanton', undefined, 50)).toHaveLength(12); // every one of them, once
      // a terminal that matches by name AND stands in the system is found once, as a match by name
      const both = ids(searchTerminals(items, 'sta', undefined, 50));
      expect(new Set(both).size).toBe(both.length);
    });
    it('returns the items themselves, with the place the box draws', () => {
      const found = searchTerminals(items, 'stanton', undefined, LIMIT);
      for (const item of found) expect(items).toContain(item);
    });
    it('is the plain search for items that have no system, a list of commodities say', () => {
      const commodities = commoditySearchItems(ref);
      for (const query of ['tit', 'g', 'u', 'x']) expect(searchTerminals(commodities, query, undefined, LIMIT)).toEqual(search(commodities, query, undefined, LIMIT));
    });
  });
  it('is searchable by the nickname the player knows', () => {
    expect(search(terminalSearchItems(ref, null), 'arc-l').map(i => i.id)).toEqual([1]);
    expect(search(terminalSearchItems(ref, null), 'wide').map(i => i.id)).toEqual([1]);
  });
});

describe('commoditySearchItems', () => {
  it('lists every commodity with code and name', () => {
    expect(commoditySearchItems(ref)).toEqual([
      { id: 10, code: 'GOLD', name: 'Gold' },
      { id: 20, code: 'TITA', name: 'Titanium' },
      { id: 30, code: 'TUNG', name: 'Tungsten' },
    ]);
  });
  it('is searchable by code prefix', () => {
    expect(search(commoditySearchItems(ref), 'tit').map(i => i.id)).toEqual([20]);
  });
});
