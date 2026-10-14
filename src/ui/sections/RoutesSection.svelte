<script lang="ts" module>
  import { DEFAULT_ROUTE_SORT, type RouteSort } from '../vm/route-sort';

  // The column the table of routes is sorted by. It is kept here, in the module and not in the component: the section is gone from
  // the screen whenever the window folds to the mini line, and the choice lives until the program is closed (it is not a setting).
  const routeSort = $state<RouteSort>({ ...DEFAULT_ROUTE_SORT });
  // «Записи»: all of them, or only the ones worth a second look. Kept like the sort, until the program is closed.
  const recordsFilter = $state({ onlyDoubt: false });
</script>

<script lang="ts">
  import ConfirmButton from '../components/ConfirmButton.svelte';
  import HistoryList from '../components/HistoryList.svelte';
  import RecordsList from '../components/RecordsList.svelte';
  import RoutesTable from '../components/RoutesTable.svelte';
  import Section from '../components/Section.svelte';
  import SessionsList from '../components/SessionsList.svelte';
  import { app } from '../state.svelte';
  import { stats } from '../stats.svelte';
  import { clickedSort, sortRoutes, type RouteSortKey } from '../vm/route-sort';
  import { doubtfulRecords, recordRows } from '../vm/records';
  import { LIST_MAX_HEIGHT, STATS_VIEWS, routesSinceLine } from '../vm/stats-view';
  import { tr } from '../../i18n';

  const SECTION = 'routes';
  // When the window has no height to spare, this section gives way before the terminal table does: the table is what
  // the player works in, the lists here are read. A larger factor takes more of the missing height (the options use a
  // small one for the opposite reason, see `OptionsSection`).
  const STATS_SHRINK = 4;

  const open = $derived(app.sectionOpen(SECTION));
  const view = $derived(stats.view);

  // The summary of a folded section is about the best route of the core's order (`stats.summary`); the table is in the order that was clicked.
  const routes = $derived(sortRoutes(stats.routes, routeSort));

  function toggle(): void {
    const opening = !open;
    void app.toggleSection(SECTION);
    if (opening) stats.opened();
  }

  const since = $derived(app.settings.routesSince);

  // «Записи»: the player's own prices as the estimates read them; counted only while the tab is on
  const records = $derived(open && view === 'records' ? recordRows(app.market, app.reference, app.routeCtx(undefined, app.rowsNow)) : []);
  const doubtful = $derived(doubtfulRecords(records));
  // the favourites that are full now, by their keys: the star of such a route is lit
  const ready = $derived(new Map(app.favouritesReady.map((alert) => [alert.key, alert.text])));

  function sortBy(key: RouteSortKey): void {
    const next = clickedSort(routeSort, key);
    app.log.info('ui', 'routes sort', { key: next.key, dir: next.dir });
    routeSort.key = next.key;
    routeSort.dir = next.dir;
  }
</script>

{#snippet actions()}
  {#if open}
    <div class="sc-seg" role="group" aria-label={tr('Что показать')}>
      {#each STATS_VIEWS as item (item.id)}
        <button type="button" aria-pressed={view === item.id} title={item.title} onclick={() => stats.setView(item.id)}>{item.label}</button>
      {/each}
    </div>
  {/if}
{/snippet}

<!--
  The summary is what a folded section says. Open, the list under the header says it (its first row is the best route),
  and the switch takes the room the summary would be cut in.
  The body shows `LIST_ROWS` rows and scrolls beyond that, whichever list is on (the line of heads of each list stays in place),
  and goes back to its top when the list is switched; when the window has no height to spare it shrinks below that as before.
-->
<Section
  title={tr('Мои маршруты')}
  summary={open ? undefined : stats.summary}
  {open}
  onToggle={toggle}
  {actions}
  scroll
  shrink={STATS_SHRINK}
  bodyMaxHeight={LIST_MAX_HEIGHT}
  resetScrollOn={view}
>
  {#if view === 'routes'}
    <RoutesTable
      rows={routes}
      sort={routeSort}
      onSort={sortBy}
      favourites={app.settings.favouriteRoutes}
      {ready}
      onFavourite={(route) => void app.toggleFavourite(route)}
    />
    <!-- the reset of the rating: the history is not touched (it is cleared in «Настройки» → «Данные»), so it can be taken back -->
    {#if since !== null}
      <p class="reset">
        <span class="since">{routesSinceLine(since)}</span>
        <button type="button" class="sc-btn" title={tr('Считать маршруты снова по всей истории рейсов')} onclick={() => void stats.restoreRoutes()}>{tr('Вернуть прежние')}</button>
      </p>
    {:else if routes.length > 0}
      <p class="reset">
        <ConfirmButton
          label={tr('Обнулить маршруты')}
          sureLabel={tr('Точно обнулить?')}
          title={tr('Начать рейтинг маршрутов, твои времена по парам и обычный темп заново. История рейсов и сессии останутся; обнуление можно вернуть')}
          onConfirm={() => void stats.resetRoutes()}
        />
      </p>
    {/if}
  {:else if view === 'history'}
    <HistoryList
      rows={stats.historyList}
      tradesOf={(runId) => stats.tradesOf(runId)}
      onEditTrade={(edit) => app.editTrade(edit)}
      onRemoveRun={(runId) => void app.removeRun(runId)}
    />
  {:else if view === 'records'}
    <RecordsList
      rows={recordsFilter.onlyDoubt ? doubtful : records}
      emptyText={recordsFilter.onlyDoubt ? tr('Сомнительных записей нет') : undefined}
      onEdit={(edit) => app.editRecord(edit)}
      onRemove={(row) => void app.removePrice({ terminalId: row.terminalId, commodityId: row.commodityId, side: row.side })}
    />
    {#if records.length > 0}
      <p class="reset">
        <span class="since">{tr('Клик по строке — исправить или убрать')}</span>
        <span class="sc-seg" role="group" aria-label={tr('Какие записи показать')}>
          <button type="button" aria-pressed={!recordsFilter.onlyDoubt} title={tr('Все твои записи цен')} onclick={() => (recordsFilter.onlyDoubt = false)}>{tr('Все · {length}', { length: records.length })}</button>
          <button
            type="button"
            aria-pressed={recordsFilter.onlyDoubt}
            title={tr('Записи, которые стоит проверить: UEX этого товара на станции не знает, или цена далеко от его истории')}
            onclick={() => (recordsFilter.onlyDoubt = true)}
          >{tr('Сомнительные · {length}', { length: doubtful.length })}</button>
        </span>
      </p>
    {/if}
  {:else}
    <SessionsList rows={stats.sessionList} />
  {/if}
</Section>

<style>
  .reset {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--sc-gap);
    margin: 0;
    padding: 0 var(--sc-pad-x);
    height: var(--sc-row-h);
    /* stays at the bottom of the body while a long list scrolls above it, as the line of heads stays at its top */
    position: sticky;
    bottom: 0;
    background: var(--sc-bg-solid);
  }

  .since {
    margin-right: auto;
    overflow: hidden;
    color: var(--sc-muted);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
