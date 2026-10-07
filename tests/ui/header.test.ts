import { describe, expect, it } from 'vitest';
import { commoditySearchItems, headerModel, terminalSearchItems } from '../../src/ui/vm/header';
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
  it('names an item after its display name and keeps the other names, and the system, as aliases', () => {
    const t = { ...ref.terminals.get(1)!, name: 'Wide Forest', code: 'ARCL1', planetName: 'ArcCorp' };
    const item = terminalSearchItems({ ...ref, terminals: new Map([[1, t]]) }, null)[0];
    expect(item).toEqual({
      id: 1, code: 'ARCL1', name: 'ARC-L1 Wide Forest Station', aliases: ['ARC-L1', 'Wide Forest', 'ArcCorp', 'Stanton'],
      place: 'Stanton · ArcCorp', title: 'ARC-L1 Wide Forest Station\nStanton · ArcCorp',
    });
  });
  it('drops empty aliases and falls back to the nickname without a display name', () => {
    const item = terminalSearchItems(ref, null).find(i => i.id === 3)!;
    expect(item.name).toBe('CRU-L1');
    expect(item.aliases).toEqual(['CRU-L1', 'Stanton']);
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
    it('is searchable by the name of the system', () => {
      expect(search(terminalSearchItems(ref, null), 'pyro').map(i => i.id)).toEqual([4]);
      expect(search(terminalSearchItems(gateways, null), 'pyro').map(i => i.id)).toEqual([20, 21]);
    });
    it('keeps the place on the items the search returns, so that the box can draw it', () => {
      const found = search(terminalSearchItems(gateways, null), 'stanton g');
      expect(found.map(i => i.id)).toEqual([20, 21, 22]);
      expect(found.map(i => i.place)).toEqual(['Pyro', 'Pyro · Ignis', 'Stanton']);
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
