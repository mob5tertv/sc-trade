import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/core/settings';
import { windowHeader } from '../../src/ui/vm/window-header';
import { ref } from '../helpers/factories';

const NOW = 1_790_000_000;
const settings = (currentTerminalId: number | null) => ({ ...DEFAULT_SETTINGS, currentTerminalId, vehicleId: 7, scuCapacity: 696, starSystemId: 68 });

describe('windowHeader: the location field', () => {
  it('shows the short name of the viewed terminal', () => {
    expect(windowHeader(ref, settings(1), 1, NOW, true, NOW).location).toBe('ARC-L1');
    expect(windowHeader(ref, settings(1), 2, NOW, true, NOW).location).toBe('TDD Area 18');
  });

  it('shows nothing (the field asks for a location) when no terminal is viewed or it left the reference', () => {
    expect(windowHeader(ref, settings(1), null, NOW, true, NOW).location).toBeNull();
    expect(windowHeader(ref, settings(1), 777, NOW, true, NOW).location).toBeNull();
  });

  it('keeps the full name in the tooltip, and where the ship stands when that is another place', () => {
    expect(windowHeader(ref, settings(1), 1, NOW, true, NOW).locationTitle).toBe('ARC-L1 Wide Forest Station');
    expect(windowHeader(ref, settings(1), 2, NOW, true, NOW).locationTitle).toBe('TDD Area 18\nСейчас: ARC-L1 Wide Forest Station');
  });

  it('has a tooltip for the empty field too', () => {
    expect(windowHeader(ref, settings(1), null, NOW, true, NOW).locationTitle).toBe('Выбери локацию: три буквы и Enter');
  });
});

describe('windowHeader: "Я здесь"', () => {
  it('names the viewed terminal when it is not the current location', () => {
    expect(windowHeader(ref, settings(1), 2, NOW, true, NOW).hereTerminalId).toBe(2);
    expect(windowHeader(ref, settings(null), 3, NOW, true, NOW).hereTerminalId).toBe(3);
  });

  it('names nothing (no button at all) when the viewed terminal is the current one', () => {
    expect(windowHeader(ref, settings(1), 1, NOW, true, NOW).hereTerminalId).toBeNull();
  });

  it('names nothing when there is no real terminal to name', () => {
    expect(windowHeader(ref, settings(1), null, NOW, true, NOW).hereTerminalId).toBeNull();
    expect(windowHeader(ref, settings(1), 777, NOW, true, NOW).hereTerminalId).toBeNull();
  });
});

describe('windowHeader: the freshness of UEX', () => {
  const uex = (synced: number | null, ok: boolean) => windowHeader(ref, settings(1), 1, synced, ok, NOW).uex;

  it('is the age alone, quiet', () => {
    expect(uex(NOW - 12 * 60, true)).toEqual({ text: 'UEX 12 мин', title: 'UEX 12 мин назад', stale: false });
    expect(uex(NOW - 5400, true)).toMatchObject({ text: 'UEX 1,5 ч', stale: false });
    expect(uex(NOW - 2 * 86_400, true)).toMatchObject({ text: 'UEX 2 д', stale: false });
  });

  it('says "сейчас" for a fresh sync and for a stamp from the future', () => {
    expect(uex(NOW - 30, true).text).toBe('UEX сейчас');
    expect(uex(NOW + 600, true).text).toBe('UEX сейчас');
  });

  it('says that the prices were never loaded', () => {
    expect(uex(null, true)).toMatchObject({ text: 'UEX не загружен', stale: false });
  });

  it('warns when UEX does not answer, and keeps the date of the data it has in the tooltip', () => {
    const when = new Date(2026, 0, 5, 9, 7).getTime() / 1000;
    expect(uex(when, false)).toEqual({ text: 'UEX недоступен', title: 'UEX недоступен, данные от 05.01 09:07', stale: true });
    expect(uex(null, false)).toEqual({ text: 'UEX недоступен', title: 'UEX недоступен', stale: true });
  });
});
