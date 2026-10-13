import { beforeEach, describe, expect, it } from 'vitest';
import { cargoOf, runTotals } from '../../src/core/run';
import type { Db } from '../../src/data/db';
import { latestObservations } from '../../src/data/repo/diary';
import { getActiveRun, getRun, listRuns } from '../../src/data/repo/runs';
import { editTrade, loseCargo, recordBuy, recordIncome, recordSell, removeRunRecord } from '../../src/data/trade';
import type { TradeDeps } from '../../src/data/trade';
import { buyIn, NOW, sellIn, tradeFixture } from '../helpers/trade-fixtures';
import type { Clock } from '../helpers/trade-fixtures';

// Spec 14.19, item 5: a purchase or a sale that was typed in wrong is corrected, and one finished run can be taken out of the
// history. What happened in the group's test: a wrong purchase price was typed in, the cargo was written off to enter it again,
// and the session ended in the minus. The hold and the money of a run are counted from its events, so they must follow the
// correction by themselves; the observation the trade wrote into the diary must follow it too.

let db: Db;
let clock: Clock;
let deps: TradeDeps;

beforeEach(async () => {
  ({ db, clock, deps } = await tradeFixture());
});

const buyObservation = async () => (await latestObservations(db)).find(o => o.side === 'buy');
const sellObservation = async () => (await latestObservations(db)).find(o => o.side === 'sell');

describe('editTrade: a purchase while the cargo is in the hold', () => {
  it('corrects the price: the hold, what was put in and the diary all read the new one', async () => {
    const bought = await recordBuy(deps, { ...buyIn(300), knownScu: 340 });      // 300 SCU at 6000, 340 were there
    const event = bought.events[0];
    const fixed = await editTrade(deps, { eventId: event.id, scu: 300, price: 6120 });

    expect(fixed.run.status).toBe('active');
    expect(cargoOf(fixed.events)).toEqual([{ commodityId: 10, scu: 300, avgBuyPrice: 6120 }]);
    expect(runTotals(fixed.run, fixed.events, NOW).invested).toBe(300 * 6120);
    expect(await buyObservation()).toMatchObject({ price: 6120, scu: 40, ts: NOW });   // the stock left is as it was
  });

  it('corrects the quantity: the hold and the stock left at the seller move together', async () => {
    const bought = await recordBuy(deps, { ...buyIn(300), knownScu: 340 });
    const fixed = await editTrade(deps, { eventId: bought.events[0].id, scu: 250, price: 6000 });
    expect(cargoOf(fixed.events)[0]).toMatchObject({ scu: 250 });
    expect(await buyObservation()).toMatchObject({ price: 6000, scu: 90 });            // 340 were there, 250 were taken
  });

  it('leaves a quantity that was never recorded unrecorded, and never makes the stock negative', async () => {
    const bought = await recordBuy(deps, buyIn(300));                               // nobody said how much was there
    await editTrade(deps, { eventId: bought.events[0].id, scu: 100, price: 6000 });
    expect((await buyObservation())!.scu).toBeNull();

    const fresh = await tradeFixture();
    const again = await recordBuy(fresh.deps, { ...buyIn(300), knownScu: 300 });    // the stock left is 0
    await editTrade(fresh.deps, { eventId: again.events[0].id, scu: 400, price: 6000 });
    expect((await latestObservations(fresh.db))[0].scu).toBe(0);
  });

  it('refuses a purchase that no longer fits the hold, and writes nothing', async () => {
    const bought = await recordBuy(deps, buyIn(300));                               // the hold is 696 SCU
    await expect(editTrade(deps, { eventId: bought.events[0].id, scu: 700, price: 6000 })).rejects.toMatchObject({ code: 'no_space' });
    expect(cargoOf((await getActiveRun(db))!.events)[0].scu).toBe(300);
  });

  it('refuses a quantity or a price that is not above zero, and an event that is no trade', async () => {
    const bought = await recordBuy(deps, buyIn(300));
    const id = bought.events[0].id;
    await expect(editTrade(deps, { eventId: id, scu: 0, price: 6000 })).rejects.toMatchObject({ code: 'bad_input' });
    await expect(editTrade(deps, { eventId: id, scu: 300, price: -1 })).rejects.toMatchObject({ code: 'bad_input' });
    await expect(editTrade(deps, { eventId: 9999, scu: 300, price: 6000 })).rejects.toMatchObject({ code: 'no_trade' });
  });
});

describe('editTrade: sales, and runs that are over', () => {
  it('corrects the price of a sale in a finished run: its profit follows, the run stays finished', async () => {
    await recordBuy(deps, buyIn(300)); clock.advance(600);
    const { run: sold } = await recordSell(deps, { ...sellIn(300, 7000), knownScu: 0 });
    expect(sold.run.status).toBe('done');
    const sale = sold.events.find(e => e.type === 'sell')!;

    const fixed = await editTrade(deps, { eventId: sale.id, scu: 300, price: 6900 });
    expect(fixed.run).toMatchObject({ status: 'done', endedAt: sold.run.endedAt });
    expect(runTotals(fixed.run, fixed.events, NOW).profit).toBe(300 * (6900 - 6000));
    expect(await sellObservation()).toMatchObject({ price: 6900, scu: 300 });          // the buyer held 0 and took 300
  });

  it('moves what the buyer holds with the quantity of a corrected sale', async () => {
    await recordBuy(deps, buyIn(300)); clock.advance(600);
    const { run: sold } = await recordSell(deps, { ...sellIn(200, 7000), knownScu: 50 });       // the buyer had 50, now 250
    const sale = sold.events.find(e => e.type === 'sell')!;
    await editTrade(deps, { eventId: sale.id, scu: 150, price: 7000 });
    expect(await sellObservation()).toMatchObject({ scu: 200 });
  });

  it('refuses a correction after which more would be sold than was bought', async () => {
    const bought = await recordBuy(deps, buyIn(300)); clock.advance(600);
    const { run: sold } = await recordSell(deps, sellIn(200, 7000));
    const sale = sold.events.find(e => e.type === 'sell')!;
    await expect(editTrade(deps, { eventId: sale.id, scu: 301, price: 7000 })).rejects.toMatchObject({ code: 'oversell' });
    await expect(editTrade(deps, { eventId: bought.events[0].id, scu: 199, price: 6000 })).rejects.toMatchObject({ code: 'oversell' });
    expect(cargoOf((await getActiveRun(db))!.events)[0].scu).toBe(100);
  });

  it('closes the run that is going when the correction empties its hold, at the time of its last sale', async () => {
    const bought = await recordBuy(deps, buyIn(300)); clock.advance(600);
    await recordSell(deps, sellIn(200, 7000)); clock.advance(300);
    const fixed = await editTrade(deps, { eventId: bought.events[0].id, scu: 200, price: 6000 });   // 200 were bought after all
    expect(fixed.run).toMatchObject({ status: 'done', endedAt: NOW + 600 });
    expect(await getActiveRun(db)).toBeNull();
  });

  it('repairs a session that a wrong price spoiled: a lost run whose purchase is corrected keeps its loss honest', async () => {
    const bought = await recordBuy(deps, buyIn(300)); clock.advance(500);
    const lost = await loseCargo(deps);
    const fixed = await editTrade(deps, { eventId: bought.events[0].id, scu: 300, price: 600 });   // one zero too many was typed
    expect(fixed.run.status).toBe('lost');
    expect(runTotals(fixed.run, fixed.events, NOW).profit).toBe(-300 * 600);
    expect(lost.run.id).toBe(fixed.run.id);
  });
});

describe('removeRunRecord: one finished run out of the history', () => {
  it('removes the run and its events, and leaves the other runs and the diary', async () => {
    await recordBuy(deps, buyIn(300)); clock.advance(500);
    const lost = await loseCargo(deps); clock.advance(100);
    await recordBuy(deps, buyIn(100)); clock.advance(600);
    const { run: kept } = await recordSell(deps, sellIn(100, 7000));
    const observations = (await db.select('SELECT id FROM observation')).length;

    expect(await removeRunRecord(deps, lost.run.id)).toEqual({ events: 1 });
    expect((await listRuns(db)).map(r => r.run.id)).toEqual([kept.run.id]);
    expect(await getRun(db, lost.run.id)).toBeNull();
    expect((await db.select('SELECT id FROM observation')).length).toBe(observations);
    expect(await db.select('SELECT run_id FROM run_event WHERE run_id = ?', [lost.run.id])).toEqual([]);
  });

  it('takes the recorded target of a lost run with it', async () => {
    await recordBuy(deps, buyIn(300));
    const lost = await loseCargo({ ...deps, settings: { ...deps.settings, targetTerminalId: 2 } });
    await removeRunRecord(deps, lost.run.id);
    expect(await db.select('SELECT run_id FROM run_target')).toEqual([]);
  });

  it('refuses the run that is going, and a run that is not there', async () => {
    const going = await recordBuy(deps, buyIn(300));
    await expect(removeRunRecord(deps, going.run.id)).rejects.toMatchObject({ code: 'run_active' });
    expect((await getActiveRun(db))!.events).toHaveLength(1);
    await expect(removeRunRecord(deps, 9999)).rejects.toMatchObject({ code: 'no_trade' });
  });
});

// What the review of 14.10.2026 found in the correction of a trade.
describe('editTrade: what the status of the run follows', () => {
  it('corrects a sale of goods that were never bought: an income has no purchase to compare with', async () => {
    const income = await recordIncome(deps, sellIn(50, 7000));
    const sale = income.events.find(e => e.type === 'sell')!;
    const fixed = await editTrade(deps, { eventId: sale.id, scu: 60, price: 7100 });
    expect(fixed.run.status).toBe('done');
    expect(fixed.events.find(e => e.id === sale.id)).toMatchObject({ scu: 60, price: 7100 });
    expect(await getActiveRun(db)).toBeNull();
  });

  it('makes a finished run the run that is going again when the correction leaves cargo aboard', async () => {
    await recordBuy(deps, buyIn(300)); clock.advance(600);
    const { run: sold } = await recordSell(deps, sellIn(300, 7000));
    expect(sold.run.status).toBe('done');
    const sale = sold.events.find(e => e.type === 'sell')!;

    const fixed = await editTrade(deps, { eventId: sale.id, scu: 250, price: 7000 });      // 50 SCU were not sold after all
    expect(fixed.run).toMatchObject({ id: sold.run.id, status: 'active', endedAt: null });
    expect(cargoOf((await getActiveRun(db))!.events)).toEqual([{ commodityId: 10, scu: 50, avgBuyPrice: 6000 }]);

    clock.advance(300);                                                                    // and the rest is sold as in any run
    const { run: done, finished } = await recordSell(deps, sellIn(50, 7000));
    expect(finished).toBe(true);
    expect(done.run).toMatchObject({ id: sold.run.id, status: 'done', endedAt: NOW + 900 });
  });

  it('refuses that correction while another run is going, and writes nothing', async () => {
    await recordBuy(deps, buyIn(300)); clock.advance(600);
    const { run: sold } = await recordSell(deps, sellIn(300, 7000)); clock.advance(100);
    const going = await recordBuy(deps, buyIn(100));
    const sale = sold.events.find(e => e.type === 'sell')!;

    await expect(editTrade(deps, { eventId: sale.id, scu: 250, price: 7000 })).rejects.toMatchObject({ code: 'run_active' });
    const kept = (await getRun(db, sold.run.id))!;
    expect(kept.run.status).toBe('done');
    expect(kept.events.find(e => e.id === sale.id)).toMatchObject({ scu: 300, price: 7000 });
    expect((await getActiveRun(db))!.run.id).toBe(going.run.id);
  });

  it('asks only a purchase that grows whether it fits, by the hold the run started with', async () => {
    const bought = await recordBuy(deps, buyIn(300));                                      // the run started with 696 SCU
    const smaller: TradeDeps = { ...deps, settings: { ...deps.settings, scuCapacity: 100 } };   // another ship is in the settings now
    const id = bought.events[0].id;
    const fixed = await editTrade(smaller, { eventId: id, scu: 300, price: 6120 });        // a price is always corrected
    expect(cargoOf(fixed.events)[0]).toMatchObject({ scu: 300, avgBuyPrice: 6120 });
    await editTrade(smaller, { eventId: id, scu: 250, price: 6120 });                      // and so is a smaller quantity
    await expect(editTrade(smaller, { eventId: id, scu: 700, price: 6120 })).rejects.toMatchObject({ code: 'no_space' });
  });

  it('records the place of the SALE as the target of a lost run when the target has two steps', async () => {
    await recordBuy(deps, buyIn(300));
    const lost = await loseCargo({ ...deps, settings: { ...deps.settings, targetTerminalId: 1, targetThenId: 2 } });
    expect(lost.run.targetId).toBe(2);
  });
});
