import { describe, expect, it } from 'vitest';
import type { StorageLine } from '../../src/core/storage';
import type { Reference, Terminal } from '../../src/core/types';
import { storageButton, storageElsewhere, storageLeftText, storagePlaces, stripStorageText } from '../../src/ui/vm/storage';

// Version 1.4: the storage of a place in the words of the window.

const terminal = (id: number, nickname: string, station: string | null): Terminal => ({
  id, nickname, name: nickname, displayname: nickname, code: nickname, starSystemId: 68, planetId: 1, orbitId: 1,
  starSystemName: 'Stanton', planetName: null, orbitName: null, moonName: null, spaceStationName: station, outpostName: null, cityName: null,
  hasFreightElevator: true, hasLoadingDock: false, isAutoLoad: false, isAvailableLive: true,
});
const ref: Reference = {
  starSystems: [],
  terminals: new Map([[3, terminal(3, 'HUR-L1', 'HUR-L1')], [4, terminal(4, 'MIC-L1', 'MIC-L1')], [5, terminal(5, 'HUR-L1 TDD', 'HUR-L1')]]),
  commodities: new Map([[8, { id: 8, name: 'Stims', code: 'STIM', isIllegal: false, isBuyable: true, isSellable: true, isAvailableLive: true }]]),
  vehicles: [],
};
const line = (terminalId: number, scu: number): StorageLine => ({ terminalId, commodityId: 8, scu, cost: scu * 2860, price: 2860, since: 0 });

describe('the storage in words', () => {
  it('says in the mini line what lies at the place, one line or several', () => {
    expect(stripStorageText([], ref)).toBeNull();
    expect(stripStorageText([line(3, 488)], ref)).toBe('склад 488 STIM');
    expect(stripStorageText([line(3, 488), line(5, 12)], ref)).toBe('склад: 2 товара · 500 SCU');
  });

  it('names the button of the header only while something lies anywhere', () => {
    expect(storageButton([])).toBeNull();
    expect(storageButton([line(3, 10)])?.label).toBe('Склад 1');
  });

  it('guesses the storage of a sale from another place only, the largest line first', () => {
    const lines = [line(3, 100), line(4, 300)];
    expect(storageElsewhere(lines, ref.terminals, 5, 8)?.terminalId).toBe(4); // terminal 5 stands at HUR-L1: its own storage is not sold from
    expect(storageElsewhere([line(3, 100)], ref.terminals, 5, 8)).toBeUndefined();
  });

  it('adds to the notice of a closed run what of its goods still lies at a storage', () => {
    expect(storageLeftText([8], [line(3, 488)], ref)).toBe(' · на складе HUR-L1 ещё 488 STIM');
    expect(storageLeftText([9], [line(3, 488)], ref)).toBeNull();
  });

  it('groups the list of every storage by station', () => {
    const places = storagePlaces([line(3, 10), line(5, 20), line(4, 30)], ref, 60);
    expect(places.map((p) => [p.place, p.rows.length])).toEqual([['HUR-L1', 2], ['MIC-L1', 1]]);
  });
});
