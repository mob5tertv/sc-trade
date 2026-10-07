import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/core/settings';
import { PRICE_SYNC_IDLE, windowHeader, type PriceSync } from '../../src/ui/vm/window-header';
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
  const uex = (synced: number | null, ok: boolean, sync?: PriceSync) => windowHeader(ref, settings(1), 1, synced, ok, NOW, sync).uex;
  const HINT = 'Нажми, чтобы обновить цены сейчас';

  it('is the age alone, quiet', () => {
    expect(uex(NOW - 12 * 60, true)).toEqual({ text: 'UEX 12 мин', title: `UEX 12 мин назад\n${HINT}`, stale: false, busy: false });
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
    expect(uex(when, false)).toEqual({ text: 'UEX недоступен', title: `UEX недоступен, данные от 05.01 09:07\n${HINT}`, stale: true, busy: false });
    expect(uex(null, false)).toEqual({ text: 'UEX недоступен', title: `UEX недоступен\n${HINT}`, stale: true, busy: false });
  });

  it('offers the refresh in the tooltip of every state that is not a refresh', () => {
    for (const [synced, ok] of [[NOW - 60, true], [NOW - 30, true], [null, true], [null, false]] as const) {
      expect(uex(synced, ok).title.endsWith(HINT)).toBe(true);
    }
  });
});

describe('windowHeader: the price sync that is going', () => {
  const sync = (over: Partial<PriceSync>): PriceSync => ({ ...PRICE_SYNC_IDLE, running: true, ...over });
  const uex = (s: PriceSync, synced: number | null = NOW - 12 * 60, ok = true) => windowHeader(ref, settings(1), 1, synced, ok, NOW, s).uex;

  it('shows how many batches are done of how many, in place of the age', () => {
    expect(uex(sync({ done: 23, total: 57 }))).toEqual({ text: 'UEX 23/57', title: 'Цены UEX обновляются: 23 из 57', stale: false, busy: true });
    expect(uex(sync({ done: 0, total: 57 })).text).toBe('UEX 0/57');
    expect(uex(sync({ done: 57, total: 57 })).text).toBe('UEX 57/57');
  });

  it('says the click was heard before the first batch is counted: the sync waits for its turn in the queue', () => {
    expect(uex(sync({ done: 0, total: 0 }))).toEqual({ text: 'UEX …', title: 'Цены UEX обновляются: ждут своей очереди', stale: false, busy: true });
  });

  it('shows the progress instead of the warning too: a sync that is going is not "недоступен"', () => {
    expect(uex(sync({ done: 3, total: 9, unfetched: 2 }), NOW - 12 * 60, false)).toMatchObject({ text: 'UEX 3/9', stale: false, busy: true });
    expect(uex(sync({ done: 3, total: 9 }), null, true)).toMatchObject({ text: 'UEX 3/9', busy: true });
  });

  it('does not offer a second refresh while one runs', () => {
    expect(uex(sync({ done: 3, total: 9 })).title).not.toContain('Нажми');
  });

  it('forgets the count when it is over: the age is back', () => {
    const over = { ...PRICE_SYNC_IDLE, done: 57, total: 57 };
    expect(uex(over, NOW)).toMatchObject({ text: 'UEX сейчас', stale: false, busy: false });
  });
});

describe('windowHeader: after a sync that did not fetch everything', () => {
  const when = new Date(2026, 0, 5, 9, 7).getTime() / 1000;
  const failed = (unfetched: number): PriceSync => ({ ...PRICE_SYNC_IDLE, unfetched });

  it('stays "недоступен" in the warning colour and says in the tooltip how many terminals were not updated', () => {
    expect(windowHeader(ref, settings(1), 1, when, false, NOW, failed(3)).uex).toEqual({
      text: 'UEX недоступен',
      title: 'UEX недоступен, данные от 05.01 09:07\nНе обновилось терминалов: 3\nНажми, чтобы обновить цены сейчас',
      stale: true,
      busy: false,
    });
  });

  it('says nothing about terminals when every one was updated', () => {
    expect(windowHeader(ref, settings(1), 1, NOW, true, NOW, failed(0)).uex.title).not.toContain('терминал');
  });
});
