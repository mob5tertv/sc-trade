<script lang="ts">
  import type { Side } from '../../core/types';
  import QuickEntry from '../components/QuickEntry.svelte';
  import Section from '../components/Section.svelte';
  import TerminalTable from '../components/TerminalTable.svelte';
  import { app } from '../state.svelte';
  import { commoditySearchItems } from '../vm/header';
  import { locationModel } from '../vm/location';
  import { kindForSide, lookupPrice } from '../vm/lookup';
  import { defaultSide } from '../vm/quick-entry';
  import { sideCounts } from '../vm/terminal-rows';
  import { selectedCommodity, type RowPick } from '../vm/terminal-side';

  const TRADES_LATER = 'Сделки появятся в следующем обновлении';
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

  function trade(row: { commodityId: number; side: Side }): void {
    app.log.info('ui', 'trade asked for, not wired yet', { terminalId: viewedId, ...row });
    app.notify(TRADES_LATER, 'info');
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
      onTrade={trade}
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
