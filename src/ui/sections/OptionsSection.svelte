<script lang="ts">
  import { fillHold, pairGoods } from '../../core/pair';
  import type { RouteOption } from '../../core/routes';
  import { cargoOf } from '../../core/run';
  import type { Settings } from '../../core/settings';
  import RouteList from '../components/RouteList.svelte';
  import Section from '../components/Section.svelte';
  import TargetGoodsView from '../components/TargetGoodsView.svelte';
  import { app } from '../state.svelte';
  import { stats } from '../stats.svelte';
  import { isFavourite } from '../vm/favourites';
  import { LEGEND, legendTitle } from '../vm/legend';
  import { lookupEmptyText, lookupSteps } from '../vm/lookup';
  import { optionsSummary } from '../vm/options-summary';
  import { titlePieces } from '../vm/route-pieces';
  import { noGoodsText, targetGoods } from '../vm/target-goods';
  import { terminalLabel } from '../vm/terminal-name';
  import { uexRangeOf } from '../vm/terminal-rows';
  import { tr } from '../../i18n';

  const SECTION = 'options';
  // When the window has no height to spare the table above gives up its rows first: the answer the player asked for
  // stays whole as long as it can.
  const OPTIONS_SHRINK = 0.2;

  // The section is drawn only while there is a request (the owner checks), but a lookup that is closed in the same
  // moment must not break the render.
  const lookup = $derived(app.lookup);
  const request = $derived(lookup.request);
  const open = $derived(app.sectionOpen(SECTION));
  const needsCapacity = $derived(app.settings.scuCapacity <= 0);
  const summary = $derived(optionsSummary({ title: lookup.title, preliminary: lookup.preliminary, progress: lookup.progress }));
  // what is asked, and the terminal with what follows it, give way to each other equally in the header, each with its own ellipsis: the name of the terminal is not
  // the first thing a narrow window loses ('Где купить Gold для TDD Area …')
  const summaryPieces = $derived(
    summary === '' || request === null ? undefined : titlePieces(summary, terminalLabel(app.reference, request.terminalId)),
  );

  // «К цели» (spec 14.19, item 16): while a target is set and the options are those of ANOTHER terminal, the header offers the goods of
  // that one pair instead of the best trips to anywhere. The pair is counted from what is already loaded (prices and stocks), it asks
  // UEX for nothing, and again every 15 seconds on the slow clock of the table, which moves the stocks and the temperatures.
  // A target in two steps is the place of the PURCHASE (the sale comes after it): "here → target" is not the pair that is flown, so
  // the switch is not offered for it.
  const targetId = $derived(app.settings.targetTerminalId);
  const pairOffered = $derived(
    request !== null && request.kind === 'from' && targetId !== null && app.settings.targetThenId === null
      && targetId !== request.terminalId && app.reference.terminals.has(targetId),
  );
  const toTarget = $derived(pairOffered && app.settings.optionsToTarget);
  const pair = $derived.by(() => {
    if (!toTarget || request === null || targetId === null) return null;
    const aboard = app.activeRun === null ? 0 : cargoOf(app.activeRun.events).reduce((sum, line) => sum + line.scu, 0);
    const freeScu = Math.max(0, app.settings.scuCapacity - aboard);
    const goods = pairGoods(app.market, request.terminalId, targetId, app.routeCtx(freeScu, app.rowsNow));
    const view = targetGoods(goods, fillHold(goods, freeScu, app.settings.budget), app.reference, { freeScu, aboard: aboard > 0 });
    const origin = terminalLabel(app.reference, request.terminalId);
    const dest = terminalLabel(app.reference, targetId);
    return { ...view, title: `${origin} → ${dest}`, emptyText: noGoodsText(origin, dest) };
  });
  const setToTarget = (on: boolean): void => {
    app.log.info('ui', 'options to the target', { on });
    void app.updateSetting('optionsToTarget', on);
  };

  // which option a click opened, for the log: the ids of the trip, no prices
  const rowContext = (option: RouteOption) => ({ commodityId: option.commodityId, originId: option.originId, destId: option.destId });

  const setSort = (sort: Settings['sort']): void => void app.updateSetting('sort', sort);
  const setNearby = (): void => void app.updateSetting('nearby', !app.settings.nearby);

  // "все товары": the lookup of one commodity widened to everything the terminal trades
  function showAllCommodities(): void {
    if (request !== null) void app.runLookup({ ...request, commodityId: null, price: null });
  }
</script>

{#snippet actions()}
  {#if open && request !== null}
    {#if pairOffered}
      <div class="sc-seg" role="group" aria-label={tr('Куда везти')}>
        <button type="button" aria-pressed={!toTarget} title={tr('Лучшие рейсы отсюда в любую точку')} onclick={() => setToTarget(false)}>{tr('Куда угодно')}</button>
        <button type="button" aria-pressed={toTarget} title={tr('Товары, которые стоит везти отсюда в точку цели, и набор на трюм')} onclick={() => setToTarget(true)}>{tr('К цели')}</button>
      </div>
    {/if}
  {/if}
  {#if open && request !== null && !toTarget}
    {#if request.commodityId !== null}
      <button type="button" class="sc-btn sc-btn--act" title={tr('Искать по всем товарам точки')} onclick={showAllCommodities}>{tr('все товары')}</button>
    {/if}
    <div class="sc-seg" role="group" aria-label={tr('Сортировка')}>
      <button type="button" aria-pressed={app.settings.sort !== 'roi'} title={legendTitle(tr('Сначала то, что приносит больше за рейс'), LEGEND.profitTrip)} onclick={() => setSort('profit')}>{tr('Прибыль')}</button>
      <button type="button" aria-pressed={app.settings.sort === 'roi'} title={tr('Сначала то, что выгоднее по отношению прибыли к вложенному')} onclick={() => setSort('roi')}>ROI</button>
    </div>
    {#if request.kind === 'from'}
      <div class="sc-seg" role="group" aria-label={tr('Где искать')}>
        <button
          type="button"
          aria-pressed={app.settings.nearby}
          title={tr('Показать и варианты, где закупка рядом, в другом месте, приносит больше за рейс. Как далеко искать — «Закупка рядом» в настройках')}
          onclick={setNearby}
        >{tr('выгоднее')}</button>
      </div>
    {/if}
  {/if}
{/snippet}

{#if request !== null}
  {@const asked = request}
  <Section
    title={tr('Варианты')}
    summary={pair === null ? summary : pair.title}
    summaryPieces={pair === null ? summaryPieces : undefined}
    summaryTitle={pair === null && lookup.preliminary ? legendTitle(tr('Варианты: {summary}', { summary }), LEGEND.approxOptions) : undefined}
    {open}
    onToggle={() => void app.toggleSection(SECTION)}
    onClose={() => app.closeLookup()}
    {actions}
    scroll
    shrink={OPTIONS_SHRINK}
  >
    {#if needsCapacity}
      <div class="note">
        <span>{tr('Укажи корабль в настройках')}</span>
        <button type="button" class="sc-btn sc-btn--act" onclick={() => app.openSettings()}>{tr('Открыть настройки')}</button>
      </div>
    {:else if pair !== null}
      <TargetGoodsView rows={pair.rows} set={pair.set} emptyText={pair.emptyText} />
    {:else if lookup.error !== null}
      <p class="line failure" role="alert">{lookup.error}</p>
    {:else if lookup.loading && lookup.options.length === 0}
      <p class="line" role="status">{tr('Ищу варианты…')}</p>
    {:else}
      <RouteList
        options={lookup.options}
        reference={app.reference}
        runCounts={stats.runCounts}
        mode={asked.kind}
        showCommodity={asked.commodityId === null}
        emptyText={lookupEmptyText(asked, app.reference)}
        anchorTerminalId={asked.terminalId}
        targetTerminalId={app.settings.targetTerminalId}
        targetThenId={app.settings.targetThenId}
        vehicle={app.vehicle}
        budget={app.settings.budget}
        freeScu={app.settings.scuCapacity}
        onFavourite={(option) => void app.toggleFavourite(option)}
        isFavourite={(option) => isFavourite(app.settings.favouriteRoutes, option)}
        uexRange={(terminalId, commodityId, side) => uexRangeOf(app.market, terminalId, commodityId, side, app.routeCtx(undefined, app.rowsNow))}
        onTarget={(option) => {
          const steps = lookupSteps(option, asked.kind, asked.terminalId);
          void app.setTarget(steps.targetId, steps.thenId);
        }}
        onClearTarget={() => void app.setTarget(null)}
        onToggleRow={(option, opened) => app.log.info('ui', opened ? 'options row opened' : 'options row closed', rowContext(option))}
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
