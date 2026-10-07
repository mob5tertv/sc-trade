<script lang="ts">
  import type { Settings } from '../../core/settings';
  import RouteList from '../components/RouteList.svelte';
  import Section from '../components/Section.svelte';
  import { app } from '../state.svelte';
  import { lookupEmptyText, lookupTarget } from '../vm/lookup';
  import { optionsSummary } from '../vm/options-summary';
  import { uexRangeOf } from '../vm/terminal-rows';

  // My finished runs per pair: there are none to count until the trade runs exist in the interface.
  const NO_RUNS = new Map<string, number>();
  const SECTION = 'options';

  // The section is drawn only while there is a request (the owner checks), but a lookup that is closed in the same
  // moment must not break the render.
  const lookup = $derived(app.lookup);
  const request = $derived(lookup.request);
  const open = $derived(app.sectionOpen(SECTION));
  const needsCapacity = $derived(app.settings.scuCapacity <= 0);
  const summary = $derived(optionsSummary({ title: lookup.title, preliminary: lookup.preliminary, progress: lookup.progress }));

  const setSort = (sort: Settings['sort']): void => void app.updateSetting('sort', sort);
  const setNearby = (): void => void app.updateSetting('nearby', !app.settings.nearby);

  // "все товары": the lookup of one commodity widened to everything the terminal trades
  function showAllCommodities(): void {
    if (request !== null) void app.runLookup({ ...request, commodityId: null, price: null });
  }
</script>

{#snippet actions()}
  {#if open && request !== null}
    {#if request.commodityId !== null}
      <button type="button" class="sc-btn sc-btn--act" title="Искать по всем товарам точки" onclick={showAllCommodities}>все товары</button>
    {/if}
    <div class="sc-seg" role="group" aria-label="Сортировка">
      <button type="button" aria-pressed={app.settings.sort === 'uecPerHour'} title="Сначала то, что приносит больше UEC в час" onclick={() => setSort('uecPerHour')}>UEC/ч</button>
      <button type="button" aria-pressed={app.settings.sort === 'roi'} title="Сначала то, что выгоднее по отношению прибыли к вложенному" onclick={() => setSort('roi')}>ROI</button>
    </div>
    {#if request.kind === 'from'}
      <div class="sc-seg" role="group" aria-label="Где искать">
        <button type="button" aria-pressed={app.settings.nearby} title="Искать закупку и на других точках той же планеты" onclick={setNearby}>и рядом</button>
      </div>
    {/if}
  {/if}
{/snippet}

{#if request !== null}
  {@const asked = request}
  <Section
    title="Варианты"
    {summary}
    {open}
    onToggle={() => void app.toggleSection(SECTION)}
    onClose={() => app.closeLookup()}
    {actions}
    scroll
  >
    {#if needsCapacity}
      <div class="note">
        <span>Укажи корабль в настройках</span>
        <button type="button" class="sc-btn sc-btn--act" onclick={() => app.openSettings()}>Открыть настройки</button>
      </div>
    {:else if lookup.error !== null}
      <p class="line failure" role="alert">{lookup.error}</p>
    {:else if lookup.loading && lookup.options.length === 0}
      <p class="line" role="status">Ищу варианты…</p>
    {:else}
      <RouteList
        options={lookup.options}
        reference={app.reference}
        runCounts={NO_RUNS}
        mode={asked.kind}
        showCommodity={asked.commodityId === null}
        emptyText={lookupEmptyText(asked, app.reference)}
        anchorTerminalId={asked.terminalId}
        targetTerminalId={app.settings.targetTerminalId}
        uexRange={(terminalId, commodityId, side) => uexRangeOf(app.market, terminalId, commodityId, side, app.routeCtx())}
        onTarget={(option) => void app.setTarget(lookupTarget(option, asked.kind))}
      />
    {/if}
  </Section>
{/if}

<style>
  .line {
    margin: 0;
    padding: 0 var(--sc-pad-x);
    height: var(--sc-row-h);
    color: var(--sc-muted);
    line-height: var(--sc-row-h);
  }

  .failure {
    color: var(--sc-bad);
  }

  .note {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sc-gap);
    height: calc(var(--sc-row-h) + 4px);
    padding: 0 var(--sc-pad-x);
    color: var(--sc-warn);
  }
</style>
