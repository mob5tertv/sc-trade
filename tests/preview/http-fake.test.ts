import { fetch as pluginFetch } from '@tauri-apps/plugin-http';
import { clearMocks, mockIPC, mockWindows } from '@tauri-apps/api/mocks';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLogger, memorySink } from '../../src/data/logger';
import { createUexClient, UexError } from '../../src/data/uex-client';
import { tauriFetchJson } from '../../src/platform/tauri-http';
import { installPriceFake, priceRow, terminalsOfPriceRequest, type PriceFake } from '../../src/preview/fake-prices';
import { currentHttpFake, installHttpFake } from '../../src/preview/http-fake';
import { createIpcHandler } from '../../src/preview/ipc';
import { DEFAULT_MONITOR } from '../../src/preview/monitor';
import { createPreviewWindow } from '../../src/preview/window-state';
import { px } from '../helpers/factories';
import { installFakeBrowser } from '../helpers/preview-fixtures';

// The network a scene can put in place (`http-fake.ts`) and the price requests of the scenes of the UEX indicator
// (`fake-prices.ts`), run through the REAL `fetch` of `@tauri-apps/plugin-http` and the REAL UEX client against the
// mocked boundary. The default (no fake installed) must stay what it was: UEX is unreachable at once.

let restoreBrowser: () => void;

beforeEach(() => {
  restoreBrowser = installFakeBrowser();
  const handler = createIpcHandler({
    monitor: DEFAULT_MONITOR,
    window: createPreviewWindow({ onFocus: () => {} }),
    sql: async () => null,
    log: () => {},
    onUnknown: () => {},
    http: currentHttpFake,
  });
  mockWindows('main');
  mockIPC((command, payload) => handler(command, payload as Record<string, unknown> | undefined), { shouldMockEvents: true });
});

afterEach(() => {
  installHttpFake(null);
  clearMocks();
  restoreBrowser();
});

const URL_A = 'https://api.uexcorp.uk/2.0/star_systems';
const settle = (ms = 20): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('the network of the preview', () => {
  it('is still none by default: UEX is unreachable at once', async () => {
    await expect(tauriFetchJson(URL_A)).rejects.toThrow(/star_systems/);
  });

  it('is none again when the scene takes its network away', async () => {
    installHttpFake(() => ({ status: 200, body: { status: 'ok', data: [] } }));
    await expect(tauriFetchJson(URL_A)).resolves.toMatchObject({ status: 200 });
    installHttpFake(null);
    await expect(tauriFetchJson(URL_A)).rejects.toThrow(/star_systems/);
  });

  it('answers a request of the application the way tauri-plugin-http does: status, then the body in pieces', async () => {
    const asked: string[] = [];
    installHttpFake((url) => {
      asked.push(url);
      return { status: 200, body: { status: 'ok', data: [{ id: 1, name: 'Стэнтон' }] } };
    });
    const reply = await tauriFetchJson(URL_A);
    expect(reply).toEqual({ status: 200, body: { status: 'ok', data: [{ id: 1, name: 'Стэнтон' }] } });
    expect(asked).toEqual([URL_A]);
  });

  it('carries an HTTP error status through', async () => {
    installHttpFake(() => ({ status: 503, body: { status: 'error' } }));
    await expect(tauriFetchJson(URL_A)).resolves.toMatchObject({ status: 503 });
  });

  it('lets the scene hold a request and answer it later', async () => {
    let answer: () => void = () => {};
    installHttpFake(() => new Promise((resolve) => { answer = () => resolve({ status: 200, body: { status: 'ok', data: [] } }); }));
    let done = false;
    const request = tauriFetchJson(URL_A).then((reply) => { done = true; return reply; });
    await settle();
    expect(done).toBe(false);
    answer();
    await expect(request).resolves.toMatchObject({ status: 200 });
  });

  it('fails a request that the scene fails, as a network that stalled', async () => {
    installHttpFake(() => { throw new Error('the request stalled'); });
    await expect(tauriFetchJson(URL_A)).rejects.toThrow(/stalled/);
  });

  it('cancels a request that waits when the application gives up on it', async () => {
    installHttpFake(() => new Promise(() => {}));
    const controller = new AbortController();
    const request = pluginFetch(URL_A, { method: 'GET', signal: controller.signal });
    await settle();
    controller.abort();
    await expect(request).rejects.toThrow(/cancel/i);
  });
});

describe('the price requests of the scenes', () => {
  const rows = [
    px(1, 10, { sell: { last: 6900, minWeek: 6400, maxWeek: 7100, avgWeek: 6800 }, scuSell: 120, scuSellMax: 400, dateModified: 1700 }),
    px(1, 20, { buy: { last: 3000, avg: 2950 }, scuBuy: 55, scuBuyMax: 90 }),
    px(2, 10, { sell: { last: 7000 } }),
    px(3, 10, { sell: { last: 7100 } }),
  ];
  const client = () => createUexClient(tauriFetchJson, createLogger(memorySink()));
  let fake: PriceFake;

  describe('the rows', () => {
    it('are answered back as the client reads them: the table does not change under the picture', async () => {
      fake = installPriceFake({ rows: () => rows });
      expect(await client().prices([1, 2])).toEqual([rows[0], rows[1], rows[2]]);
      expect(await client().prices([3])).toEqual([rows[3]]);
    });

    it('make a row of the API of a price, and the terminals of a request of its address', () => {
      expect(priceRow(rows[0])).toMatchObject({ id_terminal: 1, id_commodity: 10, price_sell: 6900, price_sell_min_week: 6400, scu_sell: 120, scu_sell_max_week: 400, date_modified: 1700 });
      expect(terminalsOfPriceRequest('https://api.uexcorp.uk/2.0/commodities_prices?id_terminal=3,4')).toEqual([3, 4]);
      expect(terminalsOfPriceRequest('https://api.uexcorp.uk/2.0/commodities_prices?id_terminal=7')).toEqual([7]);
      expect(terminalsOfPriceRequest('https://api.uexcorp.uk/2.0/commodities')).toBeNull();
      expect(terminalsOfPriceRequest('https://api.uexcorp.uk/2.0/commodities_prices?id_terminal=3,x')).toBeNull();
    });

    it('are not given for anything but a price request: that fails at once, as without a network', async () => {
      fake = installPriceFake({ rows: () => rows });
      await expect(client().starSystems()).rejects.toBeInstanceOf(UexError);
      expect(fake.asked()).toBe(0);
    });
  });

  describe('the gate', () => {
    it('lets the first requests through and holds the next until the scene lets it go', async () => {
      fake = installPriceFake({ rows: () => rows, passes: 2 });
      await client().prices([1]);
      await client().prices([2]);
      let third = false;
      const held = client().prices([3]).then((list) => { third = true; return list; });
      await settle();
      expect(fake.asked()).toBe(3);
      expect(third).toBe(false);
      fake.release(1);
      expect(await held).toEqual([rows[3]]);
    });

    it('is taken away by openAll: the held request and the next ones go through', async () => {
      fake = installPriceFake({ rows: () => rows, passes: 0 });
      const held = client().prices([1]);
      await settle();
      fake.openAll();
      expect(await held).toHaveLength(2);
      expect(await client().prices([2])).toHaveLength(1);
    });
  });

  describe('the failing terminals', () => {
    it('fail the request that has one of them, and only that one', async () => {
      fake = installPriceFake({ rows: () => rows, failTerminals: new Set([2]) });
      await expect(client().prices([1, 2])).rejects.toBeInstanceOf(UexError);
      expect(await client().prices([1])).toHaveLength(2);
      // refused by the server, not stalled: the application repeats such a batch terminal by terminal
      await expect(client().prices([2])).rejects.toMatchObject({ kind: 'http' });
    });
  });
});
