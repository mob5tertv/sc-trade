import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/core/settings';
import { locationModel } from '../../src/ui/vm/location';
import { windowHeader } from '../../src/ui/vm/window-header';
import { ref, term } from '../helpers/factories';

const NOW = 1_790_000_000;
const settings = (currentTerminalId: number | null) => ({ ...DEFAULT_SETTINGS, currentTerminalId, vehicleId: 7, scuCapacity: 696, starSystemId: 68 });

describe('locationModel', () => {
  it('shows the viewed terminal as the location and the current one on a second line', () => {
    const m = locationModel(ref, settings(1), 2, NOW - 1500, true, NOW);
    expect(m.header.location).toBe('TDD Area 18');
    expect(m.currentLocation).toBe('ARC-L1');
    expect(m.canSetCurrent).toBe(true);
  });

  it('names a terminal as the field of the location does: one name wherever it stands (the nickname, not the display name)', () => {
    const area18 = term(5, { nickname: 'TDD Area 18', displayname: 'Area 18 TDD', starSystemId: 68 });
    const named = { ...ref, terminals: new Map([...ref.terminals, [5, area18]]) };
    expect(locationModel(named, settings(1), 5, NOW, true, NOW).header.location).toBe('TDD Area 18');
    expect(locationModel(named, settings(5), 1, NOW, true, NOW).currentLocation).toBe('TDD Area 18');
    expect(windowHeader(named, settings(1), 5, NOW, true, NOW).location).toBe('TDD Area 18');
  });

  it('has no second line and no "I am here" when the viewed terminal is the current one', () => {
    const m = locationModel(ref, settings(1), 1, NOW, true, NOW);
    expect(m.header.location).toBe('ARC-L1');
    expect(m.currentLocation).toBeNull();
    expect(m.canSetCurrent).toBe(false);
  });

  it('offers "I am here" for a viewed terminal when no location is current yet', () => {
    const m = locationModel(ref, settings(null), 3, NOW, true, NOW);
    expect(m.header.location).toBe('CRU-L1');
    expect(m.currentLocation).toBeNull();
    expect(m.canSetCurrent).toBe(true);
  });

  it('survives nothing viewed', () => {
    const m = locationModel(ref, settings(1), null, NOW, true, NOW);
    expect(m.header.location).toBe('Локация не выбрана');
    expect(m.currentLocation).toBe('ARC-L1');
    expect(m.canSetCurrent).toBe(false);
  });

  it('survives a viewed terminal that left the reference', () => {
    const m = locationModel(ref, settings(1), 777, NOW, true, NOW);
    expect(m.header.location).toBe('Локация не выбрана');
    expect(m.canSetCurrent).toBe(false);
  });

  it('keeps ship, system and the UEX age of the header model', () => {
    const m = locationModel(ref, settings(1), 1, NOW - 1500, true, NOW);
    expect(m.header).toEqual({
      location: 'ARC-L1', ship: 'C2 Hercules · 696 SCU', system: 'Stanton', uex: 'UEX 25 мин назад', uexStale: false,
    });
  });
});
