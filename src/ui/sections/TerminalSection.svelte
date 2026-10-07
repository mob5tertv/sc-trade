<script lang="ts">
  import { untrack } from 'svelte';
  import { cargoOf } from '../../core/run';
  import type { Side } from '../../core/types';
  import QuickEntry from '../components/QuickEntry.svelte';
  import Section from '../components/Section.svelte';
  import TerminalTable from '../components/TerminalTable.svelte';
  import TradeDialog from '../components/TradeDialog.svelte';
  import { app } from '../state.svelte';
  import { commoditySearchItems } from '../vm/header';
  import { locationModel } from '../vm/location';
  import { kindForSide, lookupPrice } from '../vm/lookup';
  import { defaultSide } from '../vm/quick-entry';
  import { sideCounts, type TerminalRow } from '../vm/terminal-rows';
  import { selectedCommodity, type RowPick } from '../vm/terminal-side';
  import { knownScuOf, tradeDefaults, tradeRefusal, type TradeDefaults } from '../vm/trade-form';

  const SECTION = 'terminal';
  const ENTRY = 'entry';

  const open = $derived(app.sectionOpen(SECTION));
  const entryOpen = $derived(app.sectionOpen(ENTRY));
  const viewedId = $derived(app.viewTerminalId);
  const rows = $derived(app.terminalRows);
  const side = $derived(app.terminalSide);
  const counts = $derived(sideCounts(rows));

  // the full name of the viewed terminal (the location field of the header shows the short one)
  const name = $derived(
    viewedId !== null && app.reference.terminals.has(viewedId)
      ? locationModel(app.reference, app.settings, viewedId, app.pricesSyncedAt, app.uexOk, app.now).header.location
      : 'Локация не выбрана',
  );

  // The open row belongs to the terminal and the side it was opened on: with a change of either it is gone.
  let pick = $state<RowPick | null>(null);
  const selectedCommodityId = $derived(selectedCommodity(pick, viewedId, side, rows));
  // ...and it is forgotten for good, not only hidden: coming back to the side or the terminal shows no open row
  $effect(() => {
    void side;
    void viewedId;
    untrack(() => {
      pick = null;
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

  // An edit in a cell of the table belongs to the terminal that is viewed now; the table keeps what was typed
  // until its rows are refreshed, which `recordPrice` does whether or not the price was saved. Saving asks no lookup.
  async function savePrice(edit: { commodityId: number; side: Side; price: number; scu: number | null }): Promise<void> {
    const terminalId = viewedId;
    if (terminalId === null) return;
    const failure = await app.recordPrice({ terminalId, ...edit });
    if (failure !== null) app.notify(failure, 'error');
  }

  // "Где продать" / "Где купить": the lookup for this commodity; it opens the "Варианты" section itself
  function lookupRow(row: { commodityId: number; side: Side }): void {
    if (viewedId === null) return;
    const price = lookupPrice(rows.find((r) => r.commodityId === row.commodityId), row.side);
    void app.runLookup({ kind: kindForSide(row.side), terminalId: viewedId, commodityId: row.commodityId, price });
  }

  // ---- the form of a trade, under the open row ----------------------------------------------------------------------

  /** The form belongs to the terminal, the side and the commodity it was opened under; `error` is what the write said. */
  interface TradeFormState { terminalId: number; side: Side; commodityId: number; defaults: TradeDefaults; error: string | null }
  let tradeState = $state.raw<TradeFormState | null>(null);
  const tradeFor = $derived(tradeState === null ? null : tradeState.commodityId);
  const tradeOpen = $derived(tradeState !== null);

  function closeTrade(why: string): void {
    if (tradeState === null) return;
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

  // "Купил" / "Продал" of the open row. A sale of what is not on board is refused here, in a sentence, instead of opening a form that cannot be written.
  function openTrade(e: { commodityId: number; side: Side }): void {
    if (viewedId === null) return;
    const refusal = tradeRefusal(e.side, app.activeRun, e.commodityId);
    if (refusal !== null) {
      app.log.info('ui', 'trade not offered', { terminalId: viewedId, ...e, refusal });
      app.notify(refusal, 'info');
      return;
    }
    if (tradeState !== null && tradeState.commodityId === e.commodityId && tradeState.side === e.side) return;
    const cell = rows.find((r) => r.commodityId === e.commodityId)?.[e.side];
    if (!cell) return;
    const defaults = tradeDefaults({
      side: e.side, commodityId: e.commodityId, cell,
      cargo: cargoOf(app.activeRun?.events ?? []), capacity: app.settings.scuCapacity, budget: app.settings.budget,
    });
    app.log.info('ui', 'trade form', { terminalId: viewedId, ...e, ...defaults });
    tradeState = { terminalId: viewedId, side: e.side, commodityId: e.commodityId, defaults, error: null };
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
    const failure = await (form.side === 'buy' ? app.buy(input) : app.sell(input));
    if (failure === null) closeTrade('written');
    else if (tradeState !== null) tradeState = { ...tradeState, error: failure };
  }
</script>

{#snippet actions()}
  {#if open}
    <div class="sc-seg" role="group" aria-label="Какую сторону терминала показать">
      <button type="button" aria-pressed={side === 'buy'} title="Что можно купить здесь" onclick={() => app.setTerminalSide('buy')}>Купить · {counts.buy}</button>
      <button type="button" aria-pressed={side === 'sell'} title="Что можно продать здесь" onclick={() => app.setTerminalSide('sell')}>Продать · {counts.sell}</button>
    </div>
    <button
      type="button"
      class="sc-btn sc-btn--act entry"
      aria-pressed={entryOpen}
      title="Ввести цену, которую ты видишь в игре"
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
    onSave={(input) => app.recordPrice(input)}
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
      error={tradeState.error}
      onConfirm={(trade) => void confirmTrade(trade)}
      onCancel={() => closeTrade('cancelled')}
    />
  {/if}
{/snippet}

<Section
  title="Терминал"
  summary={name}
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
      onSavePrice={(edit) => void savePrice(edit)}
      onLookup={lookupRow}
      onTrade={openTrade}
      {tradeFor}
      {tradeForm}
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
