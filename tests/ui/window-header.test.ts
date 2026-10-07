import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/core/settings';
import { PRICE_SYNC_IDLE, windowHeader, type PriceSync } from '../../src/ui/vm/window-header';
import { ref, term } from '../helpers/factories';

const NOW = 1_790_000_000;
/** '05.01 09:07': the date of the data in the tooltip, in the time zone of the machine. */
function stampOf(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  const two = (n: number): string => String(n).padStart(2, '0');
  return `${two(d.getDate())}.${two(d.getMonth() + 1)} ${two(d.getHours())}:${two(d.getMinutes())}`;
}

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

  it('keeps the full name in the tooltip, then where the terminal is, then where the ship stands when that is another place', () => {
    // these terminals know their star system only by its id: the name comes from the list of the reference
    expect(windowHeader(ref, settings(1), 1, NOW, true, NOW).locationTitle).toBe('ARC-L1 Wide Forest Station\nStanton');
    expect(windowHeader(ref, settings(1), 2, NOW, true, NOW).locationTitle).toBe('TDD Area 18\nStanton\nСейчас: ARC-L1 Wide Forest Station');
  });

  it('says the whole place of the viewed terminal in the tooltip: system, planet, moon, city or station', () => {
    const grim = term(13, {
      displayname: 'GrimHEX', nickname: 'GrimHEX', starSystemId: 68, starSystemName: 'Stanton', planetName: 'Crusader', moonName: 'Yela', outpostName: 'GrimHEX',
    });
    const withGrim = { ...ref, terminals: new Map([...ref.terminals, [13, grim]]) };
    expect(windowHeader(withGrim, settings(13), 13, NOW, true, NOW).locationTitle).toBe('GrimHEX\nStanton · Crusader · Yela');
    expect(windowHeader(withGrim, settings(1), 13, NOW, true, NOW).locationTitle).toBe('GrimHEX\nStanton · Crusader · Yela\nСейчас: ARC-L1 Wide Forest Station');
  });

  it('adds no line for a place that is not known', () => {
    const nowhere = term(14, { displayname: 'Nowhere', nickname: 'Nowhere' });
    const withNowhere = { ...ref, terminals: new Map([...ref.terminals, [14, nowhere]]) };
    expect(windowHeader(withNowhere, settings(14), 14, NOW, true, NOW).locationTitle).toBe('Nowhere');
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

  it('warns when UEX does not answer, says how old the data it has are, and keeps the date of them in the tooltip', () => {
    const when = NOW - 3 * 3600;
    expect(uex(when, false)).toEqual({ text: 'UEX офлайн 3 ч', title: `UEX недоступен, данные от ${stampOf(when)}\n${HINT}`, stale: true, busy: false });
    // the age is written the way the age of the data that are fresh is
    expect(uex(NOW - 12 * 60, false).text).toBe('UEX офлайн 12 мин');
    expect(uex(NOW - 5400, false).text).toBe('UEX офлайн 1,5 ч');
    expect(uex(NOW - 2 * 86_400, false).text).toBe('UEX офлайн 2 д');
    expect(uex(NOW - 12 * 60, true).text).toBe('UEX 12 мин');
  });

  it('says only that UEX is not available when there are no data at all', () => {
    expect(uex(null, false)).toEqual({ text: 'UEX недоступен', title: `UEX недоступен\n${HINT}`, stale: true, busy: false });
  });

  it('writes an age under a minute as 0 мин (the data are there, UEX is not)', () => {
    expect(uex(NOW - 20, false).text).toBe('UEX офлайн 0 мин');
    expect(uex(NOW + 600, false).text).toBe('UEX офлайн 0 мин');
  });


  it('offers the refresh in the tooltip of every state that is not a refresh', () => {
    for (const [synced, ok] of [[NOW - 60, true], [NOW - 30, true], [null, true], [null, false]] as const) {
      expect(uex(synced, ok).title.endsWith(HINT)).toBe(true);
    }
  });
});

describe('windowHeader: the reference that did not update', () => {
  const when = NOW - 3 * 3600;
  const failed = (referenceOk: boolean) => windowHeader(ref, settings(1), 1, when, false, NOW, PRICE_SYNC_IDLE, referenceOk).uex;

  it('says so in the tooltip, and offers to refresh the reference with the prices, not the prices alone', () => {
    expect(failed(false)).toEqual({
      text: 'UEX офлайн 3 ч',
      title: `UEX недоступен, данные от ${stampOf(when)}\nСправочник UEX не обновился\nНажми, чтобы обновить справочник и цены сейчас`,
      stale: true,
      busy: false,
    });
  });

  it('leaves the tooltip as it was when the reference is fine (the prices alone did not update)', () => {
    expect(failed(true).title).toBe(`UEX недоступен, данные от ${stampOf(when)}\nНажми, чтобы обновить цены сейчас`);
  });

  it('keeps the line about the terminals that were not fetched, between the two', () => {
    const lines = windowHeader(ref, settings(1), 1, when, false, NOW, { ...PRICE_SYNC_IDLE, unfetched: 2 }, false).uex.title.split('\n');
    expect(lines.slice(1)).toEqual(['Справочник UEX не обновился', 'Не обновилось терминалов: 2', 'Нажми, чтобы обновить справочник и цены сейчас']);
  });

  it('shows the progress of a refresh that is going as it always does', () => {
    expect(windowHeader(ref, settings(1), 1, when, false, NOW, { ...PRICE_SYNC_IDLE, running: true }, false).uex)
      .toMatchObject({ text: 'UEX …', busy: true, stale: false });
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
  const when = NOW - 3 * 3600;
  const failed = (unfetched: number): PriceSync => ({ ...PRICE_SYNC_IDLE, unfetched });

  it('says "офлайн" with the age in the warning colour and says in the tooltip how many terminals were not updated', () => {
    expect(windowHeader(ref, settings(1), 1, when, false, NOW, failed(3)).uex).toEqual({
      text: 'UEX офлайн 3 ч',
      title: `UEX недоступен, данные от ${stampOf(when)}\nНе обновилось терминалов: 3\nНажми, чтобы обновить цены сейчас`,
      stale: true,
      busy: false,
    });
  });

  it('says nothing about terminals when every one was updated', () => {
    expect(windowHeader(ref, settings(1), 1, NOW, true, NOW, failed(0)).uex.title).not.toContain('терминал');
  });
});
