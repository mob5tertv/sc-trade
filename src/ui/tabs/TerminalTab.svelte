<script lang="ts">
  import type { Settings } from '../../core/settings';
  import type { Side } from '../../core/types';
  import QuickEntry from '../components/QuickEntry.svelte';
  import RouteList from '../components/RouteList.svelte';
  import TerminalTable from '../components/TerminalTable.svelte';
  import { app } from '../state.svelte';
  import { commoditySearchItems, terminalSearchItems } from '../vm/header';
  import { kindForSide, lookupEmptyText, lookupPrice, lookupTarget } from '../vm/lookup';
  import type { LookupKind } from '../vm/lookup';
  import { locationModel } from '../vm/location';
  import { defaultSide } from '../vm/quick-entry';
  import { uexRangeOf } from '../vm/terminal-rows';

  // My finished runs per pair: there are none to count until the trade runs exist in the interface.
  const NO_RUNS = new Map<string, number>();
  const TRADES_LATER = 'Сделки появятся в следующем обновлении';

  const viewedId = $derived(app.viewTerminalId);
  const rows = $derived(app.terminalRows);
  const lookup = $derived(app.lookup);
  const kind = $derived<LookupKind>(lookup.request?.kind ?? 'from');
  const needsCapacity = $derived(app.settings.scuCapacity <= 0);

  const terminalItems = $derived(terminalSearchItems(app.reference, app.settings.starSystemId));
  const commodityItems = $derived(commoditySearchItems(app.reference));
  const boostIds = $derived(viewedId === null ? new Set<number>() : new Set(app.market.byTerminal.get(viewedId)));
  // The same name as the header gives to the viewed terminal; none when the reference lacks it.
  const viewedName = $derived(
    viewedId !== null && app.reference.terminals.has(viewedId)
      ? locationModel(app.reference, app.settings, viewedId, app.pricesSyncedAt, app.uexOk, app.now).header.location
      : null,
  );

  // The selected row only narrows "Отсюда" to its commodity. It belongs to the terminal that was viewed when it
  // was chosen, and goes away with the row.
  let selection = $state<{ terminalId: number | null; commodityId: number } | null>(null);
  const selectedCommodityId = $derived.by(() => {
    const picked = selection;
    if (picked === null || picked.terminalId !== viewedId) return null;
    return rows.some((row) => row.commodityId === picked.commodityId) ? picked.commodityId : null;
  });

  let block = $state<HTMLElement>();

  /** After a lookup was asked from a place far from the block: brings the block into view, no further than needed. */
  const reveal = (): void => block?.scrollIntoView({ block: 'nearest' });

  const sideFor = (commodityId: number): Side => defaultSide(rows.find((row) => row.commodityId === commodityId));

  function select(commodityId: number): void {
    app.log.debug('ui', 'select commodity', { terminalId: viewedId, commodityId });
    selection = { terminalId: viewedId, commodityId };
  }

  // An edit in a cell of the table belongs to the terminal that is viewed now; the table keeps what was typed
  // until its rows are refreshed, which `recordPrice` does whether or not the price was saved.
  async function savePrice(edit: { commodityId: number; side: Side; price: number; scu: number | null }): Promise<void> {
    const terminalId = viewedId;
    if (terminalId === null) return;
    const failure = await app.recordPrice({ terminalId, ...edit });
    if (failure !== null) app.notify(failure, 'error');
  }

  function lookupRow(row: { commodityId: number; side: Side }): void {
    if (viewedId === null) return;
    const price = lookupPrice(rows.find((r) => r.commodityId === row.commodityId), row.side);
    void app.runLookup({ kind: kindForSide(row.side), terminalId: viewedId, commodityId: row.commodityId, price });
    reveal();
  }

  function trade(row: { commodityId: number; side: Side }): void {
    app.log.info('ui', 'trade asked for, not wired yet', { terminalId: viewedId, ...row });
    app.notify(TRADES_LATER, 'info');
  }

  function showKind(next: LookupKind): void {
    if (viewedId === null) {
      app.notify('Сначала выбери локацию.', 'info');
      return;
    }
    void app.runLookup({ kind: next, terminalId: viewedId, commodityId: next === 'from' ? selectedCommodityId : null, price: null });
    reveal();
  }

  function showAllCommodities(): void {
    const { request } = lookup;
    if (request === null) return;
    void app.runLookup({ ...request, commodityId: null, price: null });
  }

  const setSort = (sort: Settings['sort']): void => void app.updateSetting('sort', sort);

  // The checkbox is the player's own click until the setting says otherwise: when it was not saved it shows the stored state again.
  async function setNearby(box: HTMLInputElement): Promise<void> {
    await app.updateSetting('nearby', box.checked);
    box.checked = app.settings.nearby;
  }

  function newRoute(): void {
    void app.newRoute();
    reveal();
  }
</script>

<section class="tab">
  <QuickEntry
    terminalId={viewedId}
    {commodityItems}
    {boostIds}
    {sideFor}
    onSave={(entry) => app.recordPrice(entry)}
    onReject={(e) => app.log.info('ui', 'quick entry rejected', { terminalId: viewedId, ...e })}
    onFailure={(err, entry) => app.log.error('ui', 'quick entry save failed', { ...entry, err })}
  />

  <section class="lookup" bind:this={block} aria-label="Подсказки по маршрутам" aria-busy={lookup.loading}>
    <div class="bar">
      <div class="group" role="group" aria-label="Что искать">
        <button type="button" class="seg" aria-pressed={kind === 'from'} title="Куда везти товары отсюда" onclick={() => showKind('from')}>Отсюда</button>
        <button type="button" class="seg" aria-pressed={kind === 'to'} title="Откуда везти товары сюда" onclick={() => showKind('to')}>Сюда</button>
      </div>
      <div class="group" role="group" aria-label="Сортировка">
        <button type="button" class="seg" aria-pressed={app.settings.sort === 'uecPerHour'} title="Сначала то, что приносит больше UEC в час" onclick={() => setSort('uecPerHour')}>UEC/ч</button>
        <button type="button" class="seg" aria-pressed={app.settings.sort === 'roi'} title="Сначала то, что выгоднее по отношению прибыли к вложенному" onclick={() => setSort('roi')}>ROI</button>
      </div>
      <label
        class="check"
        class:off={kind === 'to'}
        title={kind === 'to'
          ? 'Относится к «Отсюда»: в «Сюда» закупка и так ищется на всех точках'
          : 'Искать закупку и на других точках той же планеты'}
      >
        <input type="checkbox" checked={app.settings.nearby} disabled={kind === 'to'} onchange={(event) => void setNearby(event.currentTarget)} />
        <span>искать и рядом</span>
      </label>
      <button type="button" class="sc-btn" title="Что везти из текущей локации" onclick={newRoute}>Новый маршрут</button>
    </div>

    {#if needsCapacity}
      <div class="note">
        <p>Укажи корабль или объём трюма в настройках</p>
        <button type="button" class="sc-btn" onclick={() => app.setTab('settings')}>Открыть настройки</button>
      </div>
    {:else if lookup.request === null}
      <p class="hint">Введи цену выше, нажми «Где купить» или «Где продать» у товара, либо «Новый маршрут».</p>
    {:else}
      <div class="heading">
        <p class="title" title={lookup.title}>{lookup.title}</p>
        {#if lookup.request.commodityId !== null}
          <button type="button" class="sc-btn" title="Искать по всем товарам точки" onclick={showAllCommodities}>Все товары</button>
        {/if}
      </div>
      {#if lookup.loading}
        <p class="hint" role="status">Ищу варианты…</p>
      {:else if lookup.error !== null}
        <p class="failure" role="alert">{lookup.error}</p>
      {:else}
        <RouteList
          options={lookup.options}
          reference={app.reference}
          runCounts={NO_RUNS}
          mode={lookup.request.kind}
          showCommodity={lookup.request.commodityId === null}
          emptyText={lookupEmptyText(lookup.request, app.reference)}
          anchorTerminalId={viewedId}
          targetTerminalId={app.settings.targetTerminalId}
          uexRange={(terminalId, commodityId, side) => uexRangeOf(app.market, terminalId, commodityId, side, app.routeCtx())}
          onTarget={(option) => void app.setTarget(lookupTarget(option, kind))}
        />
      {/if}
    {/if}
  </section>

  {#if viewedId === null}
    <p class="empty">Выбери локацию в поиске, чтобы увидеть её цены.</p>
  {:else}
    <!-- until the section header holds the switch of the two sides, both tables are drawn one under the other -->
    {#each ['buy', 'sell'] as const as side (side)}
      <TerminalTable
        {rows}
        {side}
        {selectedCommodityId}
        scope={viewedId}
        onSelect={(id) => (id === null ? (selection = null) : select(id))}
        onSavePrice={(edit) => void savePrice(edit)}
        onLookup={lookupRow}
        onTrade={trade}
      />
    {/each}
  {/if}
</section>

<style>
  .lookup {
    border-bottom: 1px solid var(--sc-border);
  }

  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px var(--sc-gap);
    padding: 6px calc(var(--sc-gap) * 1.5);
  }

  .group {
    display: flex;
    overflow: hidden;
    border: 1px solid var(--sc-border);
    border-radius: var(--sc-radius);
  }

  .seg {
    height: 26px;
    padding: 0 10px;
    border: 0;
    background: transparent;
    color: var(--sc-muted);
    font: inherit;
    font-size: var(--sc-font-sm);
    cursor: pointer;
  }

  .seg:hover {
    color: var(--sc-text);
  }

  .seg[aria-pressed='true'] {
    background: var(--sc-surface-2);
    color: var(--sc-text);
  }

  .seg:focus-visible {
    outline: 2px solid var(--sc-accent);
    outline-offset: -2px;
  }

  .check {
    display: flex;
    align-items: center;
    gap: 4px;
    color: var(--sc-muted);
    font-size: var(--sc-font-sm);
    cursor: pointer;
  }

  .check.off {
    opacity: 0.6;
    cursor: default;
  }

  .bar .sc-btn {
    height: 26px;
    margin-left: auto;
    font-size: var(--sc-font-sm);
  }

  .heading {
    display: flex;
    align-items: center;
    gap: var(--sc-gap);
    padding: 2px calc(var(--sc-gap) * 1.5);
  }

  .heading .sc-btn {
    flex: none;
    height: 26px;
    font-size: var(--sc-font-sm);
  }

  .title {
    flex: 1;
    min-width: 0;
    margin: 0;
    display: -webkit-box;
    overflow: hidden;
    font-weight: 600;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
  }

  .hint,
  .empty,
  .note p {
    margin: 0;
    padding: var(--sc-gap) calc(var(--sc-gap) * 1.5);
    color: var(--sc-muted);
  }

  .note {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--sc-gap);
    padding-right: calc(var(--sc-gap) * 1.5);
  }

  .note p {
    color: var(--sc-warn);
  }

  .failure {
    margin: 0;
    padding: var(--sc-gap) calc(var(--sc-gap) * 1.5);
    color: var(--sc-bad);
  }
</style>
