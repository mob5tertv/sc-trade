<script lang="ts" module>
  import { DEFAULT_TERMINAL_SORT, type TerminalSort } from '../vm/terminal-order';

  // The header the table of the terminal is ordered by. It is kept here, in the module and not in the component: the section is gone
  // from the screen whenever the window folds to the mini line, and the choice lives until the program is closed (it is not a setting).
  const terminalSort = $state<TerminalSort>({ ...DEFAULT_TERMINAL_SORT });
</script>

<script lang="ts">
  import { untrack } from 'svelte';
  import { cargoOf } from '../../core/run';
  import type { Side } from '../../core/types';
  import Icon from '../components/Icon.svelte';
  import QuickEntry from '../components/QuickEntry.svelte';
  import Section from '../components/Section.svelte';
  import TerminalTable from '../components/TerminalTable.svelte';
  import TradeDialog from '../components/TradeDialog.svelte';
  import { app } from '../state.svelte';
  import { commoditySearchItems } from '../vm/header';
  import { rejectedFields } from '../vm/inputs';
  import { locationModel } from '../vm/location';
  import { kindForSide, lookupPrice } from '../vm/lookup';
  import { defaultSide } from '../vm/quick-entry';
  import { crossedRows, roiCells, type RoiSnapshot } from '../vm/row-roi';
  import { sideCounts, type TerminalRow } from '../vm/terminal-rows';
  import { terminalFullName } from '../vm/terminal-name';
  import { terminalFullPlace } from '../vm/terminal-place';
  import { clickedTerminalSort, type TerminalSortKey } from '../vm/terminal-order';
  import { selectedCommodity, type RowPick } from '../vm/terminal-side';
  import {
    goodsCameAboard, GOODS_ABOARD_NOTICE, INCOME_NOTE, knownScuOf, tradeDefaults, tradeLimit, tradeMode, type TradeDefaults, type TradeMode,
  } from '../vm/trade-form';

  const SECTION = 'terminal';
  const ENTRY = 'entry';

  const open = $derived(app.sectionOpen(SECTION));
  const entryOpen = $derived(app.sectionOpen(ENTRY));
  const viewedId = $derived(app.viewTerminalId);
  const rows = $derived(app.terminalRows);
  const side = $derived(app.terminalSide);
  const counts = $derived(sideCounts(rows));
  // what is in the hold while a run goes on: on the sell side the table puts these commodities first and marks them
  const cargo = $derived(cargoOf(app.activeRun?.events ?? []));

  // the name of the viewed terminal as the location field of the header names it (one name for a terminal everywhere)
  const name = $derived(
    viewedId !== null && app.reference.terminals.has(viewedId)
      ? locationModel(app.reference, app.settings, viewedId, app.pricesSyncedAt, app.uexOk, app.now).header.location
      : 'Локация не выбрана',
  );
  // the tooltip of the header has the official name and says where it is (there are many terminals of one name in different star
  // systems); the line itself is not changed
  const nameTitle = $derived.by(() => {
    const terminal = viewedId === null ? undefined : app.reference.terminals.get(viewedId);
    if (terminal === undefined) return undefined;
    const full = terminalFullName(terminal);
    const place = terminalFullPlace(terminal, app.reference.starSystems);
    return place === '' && full === name ? undefined : `Терминал: ${full}${place === '' ? '' : `\n${place}`}`;
  });

  // The rows that flash now (see `enteringPrice`): commodity ids, so they belong to the table that was drawn when they crossed the threshold
  const PULSE_MS = 1300;
  const NO_PULSE: ReadonlySet<number> = new Set();
  let pulse = $state.raw<ReadonlySet<number>>(NO_PULSE);
  let pulseTimer: ReturnType<typeof setTimeout> | undefined;

  // The open row belongs to the terminal and the side it was opened on: with a change of either it is gone.
  let pick = $state<RowPick | null>(null);
  const selectedCommodityId = $derived(selectedCommodity(pick, viewedId, side, rows));
  // ...and it is forgotten for good, not only hidden: coming back to the side or the terminal shows no open row. The flash goes
  // the same way: a row of the NEW table with the commodity of a row that was flashing must not flash in its place.
  $effect(() => {
    void side;
    void viewedId;
    untrack(() => {
      pick = null;
      clearTimeout(pulseTimer);
      pulse = NO_PULSE;
    });
  });

  const commodityItems = $derived(commoditySearchItems(app.reference));
  const boostIds = $derived(viewedId === null ? new Set<number>() : new Set(app.market.byTerminal.get(viewedId)));
  const sideFor = (commodityId: number): Side => defaultSide(rows.find((row) => row.commodityId === commodityId));

  function select(commodityId: number | null): void {
    if (commodityId === null) {
      pick = null;
      return;
    }
    app.log.debug('ui', 'select commodity', { terminalId: viewedId, side, commodityId });
    pick = { terminalId: viewedId, side, commodityId };
  }

  // A click on «Товар» or «ROI»: only the order of the rows changes (the table keeps its rows, so the open row and what was typed stay)
  function sortBy(key: TerminalSortKey): void {
    const next = clickedTerminalSort(terminalSort, key);
    app.log.info('ui', 'terminal sort', { key: next.key, dir: next.dir });
    terminalSort.key = next.key;
    terminalSort.dir = next.dir;
  }

  // An edit in a cell of the table belongs to the terminal that is viewed now; the table keeps what was typed
  // until its rows are refreshed, which `recordPrice` does whether or not the price was saved. Saving asks no lookup.
  async function savePrice(edit: { commodityId: number; side: Side; price: number; scu: number | null }): Promise<void> {
    const terminalId = viewedId;
    if (terminalId === null) return;
    const failure = await app.recordPrice({ terminalId, ...edit });
    if (failure !== null) app.notify(failure, 'error');
  }

  // "Где продать" / "Где купить" and the ROI of a row: the lookup for this commodity; it opens the "Варианты" section itself
  function lookupRow(row: { commodityId: number; side: Side }): void {
    if (viewedId === null) return;
    const price = lookupPrice(rows.find((r) => r.commodityId === row.commodityId), row.side);
    void app.runLookup({ kind: kindForSide(row.side), terminalId: viewedId, commodityId: row.commodityId, price });
  }

  // ---- the profit of the rows (spec 14.10) ---------------------------------------------------------------------------

  // The ROI of each row, in the words of the table; counted by the state on the slow clock of the table (`app.rowRoi`)
  const roiByRow = $derived(roiCells(app.rowRoi, side, app.reference, app.settings.roiHighlightPct));

  // The button of the header: the lookup over ALL the commodities of the viewed terminal, the side of the table says which one
  // (what to bring here / where to take things from here)
  const searchTitle = $derived(
    side === 'sell'
      ? 'Что везти сюда: лучшие варианты по всем товарам, которые здесь покупают'
      : 'Куда отсюда: лучшие варианты по всем товарам, которые можно купить здесь',
  );
  function searchAll(): void {
    if (viewedId === null) return;
    void app.runLookup({ kind: kindForSide(side), terminalId: viewedId, commodityId: null, price: null });
  }

  // A row that crosses the threshold because a price was entered flashes once. "Because a price was entered" is known
  // here and nowhere else: the entry is run between two looks at the ROI of the table, and the rows that were below the
  // threshold before and are at or above it now are the ones to flash. A table that was opened or switched flashes nothing.
  $effect(() => () => clearTimeout(pulseTimer));

  const roiSnapshot = (): RoiSnapshot => ({ terminalId: viewedId, side, roi: app.rowRoi });

  async function enteringPrice<T>(enter: () => Promise<T>): Promise<T> {
    const before = roiSnapshot();
    const result = await enter();
    const crossed = crossedRows(before, roiSnapshot(), app.settings.roiHighlightPct);
    if (crossed.length > 0) {
      app.log.debug('ui', 'rows crossed the ROI threshold', { terminalId: viewedId, side, commodityIds: crossed });
      pulse = new Set(crossed);
      clearTimeout(pulseTimer);
      pulseTimer = setTimeout(() => (pulse = NO_PULSE), PULSE_MS);
    }
    return result;
  }

  // ---- the form of a trade, under the open row ----------------------------------------------------------------------

  /**
   * The form belongs to the terminal, the side and the commodity it was opened under; `error` is what the write said. `id`
   * is the number of this very opening: the answer of a write that was started from it may only touch it, not a form that
   * was opened after the player went to another row (or the same row again). `mode` is what the form promises the player
   * when it opens, and what it writes: a sale of goods that are not in the hold is an `income`.
   */
  interface TradeFormState { id: number; terminalId: number; side: Side; mode: TradeMode; commodityId: number; defaults: TradeDefaults; error: string | null }
  let tradeState = $state.raw<TradeFormState | null>(null);
  let tradeFormCount = 0;
  const tradeFor = $derived(tradeState === null ? null : tradeState.commodityId);
  const tradeOpen = $derived(tradeState !== null);
  // The largest quantity the service takes for the open form, by the hold as it is now: a quantity above it is refused by the
  // service as before, and the form asks nothing about a price that is not mine before that refusal (`confirmStep`).
  const tradeMaxScu = $derived(
    tradeState === null
      ? null
      : tradeLimit({ mode: tradeState.mode, commodityId: tradeState.commodityId, cargo, capacity: app.settings.scuCapacity }),
  );

  /** Closes the open form; with `id` only that opening (it may be gone already, and another one open). */
  function closeTrade(why: string, id?: number): void {
    if (tradeState === null || (id !== undefined && tradeState.id !== id)) return;
    app.log.debug('ui', 'trade form closed', { why });
    tradeState = null;
  }

  // The form goes with its row: another row, side or terminal, or the section folded.
  $effect(() => {
    const form = tradeState;
    if (form === null) return;
    if (!(open && viewedId === form.terminalId && side === form.side && selectedCommodityId === form.commodityId)) {
      untrack(() => closeTrade('its row is gone'));
    }
  });

  // While the form is open the window does not fold by itself (the player is in the middle of a trade).
  $effect(() => {
    if (!tradeOpen) return;
    app.holdBusy('trade');
    return () => app.releaseBusy('trade');
  });

  // "Купил" / "Продал" of the open row. "Продал" for goods that are not in the hold opens the form of an income (spec 14.10):
  // the quantity is empty (the player types it), the form says in one line that it is written without a purchase.
  function openTrade(e: { commodityId: number; side: Side }): void {
    if (viewedId === null) return;
    if (tradeState !== null && tradeState.commodityId === e.commodityId && tradeState.side === e.side) return;
    const cell = rows.find((r) => r.commodityId === e.commodityId)?.[e.side];
    if (!cell) return;
    const mode = tradeMode(e.side, app.activeRun, e.commodityId);
    const defaults = tradeDefaults({
      side: e.side, commodityId: e.commodityId, cell,
      cargo: cargoOf(app.activeRun?.events ?? []), capacity: app.settings.scuCapacity, budget: app.settings.budget,
    });
    app.log.info('ui', 'trade form', { terminalId: viewedId, ...e, mode, ...defaults });
    tradeState = { id: ++tradeFormCount, terminalId: viewedId, side: e.side, mode, commodityId: e.commodityId, defaults, error: null };
  }

  // The error of the form is cleared when the write starts, so that the same refusal twice in a row is a change for the form.
  // The quantity the player sees at the terminal is the one of the row at this moment (knownScu): the diary keeps "was minus
  // bought" after a purchase and "was plus sold" after a sale.
  async function confirmTrade(trade: { scu: number; price: number }): Promise<void> {
    const form = tradeState;
    if (form === null) return;
    tradeState = { ...form, error: null };
    const cell = app.terminalRows.find((r) => r.commodityId === form.commodityId)?.[form.side] ?? null;
    const input = { terminalId: form.terminalId, commodityId: form.commodityId, ...trade, knownScu: knownScuOf(cell) };
    const failure = await (form.side === 'buy' ? app.buy(input) : app.sell(input, form.mode === 'income'));
    // the answer belongs to the form the write was started from: the player may have gone to another row meanwhile
    if (failure === null) closeTrade('written', form.id);
    else if (goodsCameAboard(form.mode, app.activeRun, form.commodityId)) {
      // an income form whose goods were bought meanwhile: its line "нет в трюме" would contradict the refusal, so it goes
      // and the notice line says what to do (the next "Продал" opens the ordinary sale)
      closeTrade('the goods are in the hold now', form.id);
      app.notify(GOODS_ABOARD_NOTICE, 'info');
    } else if (tradeState !== null && tradeState.id === form.id) tradeState = { ...tradeState, error: failure };
  }

  // A number the form refused (nothing was written): the line says which field it was, never what was typed.
  function tradeRejected(fields: { scu: boolean; price: boolean }): void {
    if (tradeState === null) return;
    const { terminalId, side: formSide, commodityId, mode } = tradeState;
    app.log.info('ui', 'trade form rejected', { terminalId, side: formSide, commodityId, mode, fields: rejectedFields(fields) });
  }

  // The form was confirmed with a price that is not mine and that nobody touched: nothing was written, the form asks to check it.
  // A refusal of an earlier confirmation is answered by now (the quantity was put right, or the form would not ask): it goes, as it
  // does when a write starts, so that the question does not stand next to a refusal that is no longer true.
  function tradePriceCheck(): void {
    if (tradeState === null) return;
    const { terminalId, side: formSide, commodityId, mode } = tradeState;
    app.log.info('ui', 'trade form asks to check a price that is not mine', { terminalId, side: formSide, commodityId, mode });
    if (tradeState.error !== null) tradeState = { ...tradeState, error: null };
  }
</script>

{#snippet actions()}
  {#if open}
    <div class="sc-seg" role="group" aria-label="Какую сторону терминала показать">
      <button type="button" aria-pressed={side === 'buy'} title="Что можно купить здесь" onclick={() => app.setTerminalSide('buy')}>Купить · {counts.buy}</button>
      <button type="button" aria-pressed={side === 'sell'} title="Что можно продать здесь" onclick={() => app.setTerminalSide('sell')}>Продать · {counts.sell}</button>
    </div>
    <button type="button" class="sc-btn sc-btn--act sc-btn--icon search" aria-label={searchTitle} title={searchTitle} onclick={searchAll}>
      <Icon name="search" />
    </button>
    <!-- `data-opens-entry`: while the quick entry is closed the button opens it, and the cursor goes into its commodity field
         (ui/keyboard.ts: such a button takes the keyboard like a field). Open, the button closes it and is a plain button. -->
    <button
      type="button"
      class="sc-btn sc-btn--act entry"
      aria-pressed={entryOpen}
      title="Ввести цену, которую ты видишь в игре"
      data-opens-entry={entryOpen ? undefined : 'quick'}
      onclick={() => void app.toggleSection(ENTRY)}
    >+ цена</button>
  {/if}
{/snippet}

{#snippet entry()}
  <QuickEntry
    terminalId={viewedId}
    {commodityItems}
    {boostIds}
    {sideFor}
    onSave={(input) => enteringPrice(() => app.recordPrice(input))}
    onReject={(e) => app.log.info('ui', 'quick entry rejected', { terminalId: viewedId, ...e })}
    onFailure={(err, input) => app.log.error('ui', 'quick entry save failed', { ...input, err })}
  />
{/snippet}

{#snippet tradeForm(row: TerminalRow)}
  {#if tradeState !== null}
    <TradeDialog
      title="{tradeState.side === 'buy' ? 'Купил' : 'Продал'} {row.code}"
      side={tradeState.side}
      defaultScu={tradeState.defaults.scu}
      defaultPrice={tradeState.defaults.price}
      defaultPriceIsOwn={tradeState.defaults.priceIsOwn}
      maxScu={tradeMaxScu}
      note={tradeState.mode === 'income' ? INCOME_NOTE : null}
      error={tradeState.error}
      onConfirm={(trade) => void confirmTrade(trade)}
      onCancel={() => closeTrade('cancelled')}
      onReject={tradeRejected}
      onPriceCheck={tradePriceCheck}
    />
  {/if}
{/snippet}

<Section
  title="Терминал"
  summary={name}
  summaryTitle={nameTitle}
  {open}
  onToggle={() => void app.toggleSection(SECTION)}
  {actions}
  lead={entryOpen ? entry : undefined}
  scroll
>
  {#if viewedId === null}
    <p class="empty">Выбери локацию в шапке окна.</p>
  {:else}
    <TerminalTable
      {rows}
      {side}
      {selectedCommodityId}
      scope={viewedId}
      onSelect={select}
      onSavePrice={(edit) => void enteringPrice(() => savePrice(edit))}
      onReject={({ commodityId, side: cellSide, ...flags }) => app.log.info('ui', 'price cell rejected', {
        terminalId: viewedId, commodityId, side: cellSide, fields: rejectedFields(flags),
      })}
      onLookup={lookupRow}
      onTrade={openTrade}
      {tradeFor}
      {tradeForm}
      roi={roiByRow}
      {pulse}
      noCapacity={app.settings.scuCapacity <= 0}
      {cargo}
      sort={terminalSort}
      onSort={sortBy}
    />
  {/if}
</Section>

<style>
  .entry[aria-pressed='true'] {
    background: var(--sc-border);
  }

  .empty {
    margin: 0;
    padding: 0 var(--sc-pad-x);
    height: var(--sc-row-h);
    color: var(--sc-muted);
    line-height: var(--sc-row-h);
  }
</style>
