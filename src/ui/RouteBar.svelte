<script lang="ts">
  import Icon from './components/Icon.svelte';
  import SearchBox from './components/SearchBox.svelte';
  import { app } from './state.svelte';
  import { searchTerminals, terminalSearchItems } from './vm/header';
  import { terminalLabel } from './vm/terminal-name';
  import { tr } from '../i18n';

  // «Маршрут» (the author's word of 13.10.2026): the two ends of a route of the player's own, typed in. "Where from" starts as the
  // place he stands at; "where to" is the station he wants to fly to. With both known the options below are the goods of that pair
  // and the set that fills the hold (spec 14.19, item 16). The line stands under the header while its button is pressed.

  const items = $derived(terminalSearchItems(app.reference, app.settings.starSystemId));
  const fromId = $derived(app.routeFromId ?? app.settings.currentTerminalId ?? app.viewTerminalId);
  const toId = $derived(app.settings.targetThenId ?? app.settings.targetTerminalId);
  const name = (id: number | null): string => (id !== null && app.reference.terminals.has(id) ? terminalLabel(app.reference, id) : '');

  function pickFrom(id: number): void {
    app.routeFromId = id;
    if (toId !== null) void app.planRoute(id, toId);
  }

  function pickTo(id: number): void {
    void app.planRoute(fromId, id);
  }
</script>

<div class="route-bar" role="group" aria-label={tr('Свой маршрут: откуда и куда')}>
  <div class="end">
    <SearchBox
      {items}
      find={searchTerminals}
      value={name(fromId)}
      placeholder={tr('Откуда')}
      label={tr('Откуда: три буквы и Enter')}
      title={tr('Откуда везти. По умолчанию — место, где ты стоишь')}
      onPick={(id) => pickFrom(id)}
    />
  </div>
  <span class="arrow" aria-hidden="true">→</span>
  <div class="end">
    <SearchBox
      {items}
      find={searchTerminals}
      value={name(toId)}
      placeholder={tr('Куда: три буквы и Enter')}
      label={tr('Куда: три буквы и Enter')}
      title={tr('Куда везти: станция станет целью, а «Варианты» покажут товары для этой пары')}
      onPick={(id) => pickTo(id)}
    />
  </div>
  <button class="sc-btn sc-btn--ghost sc-btn--icon" type="button" aria-label={tr('Скрыть строку маршрута')} title={tr('Скрыть строку. Цель при этом остаётся')} onclick={() => app.toggleRouteBar()}>
    <Icon name="cross" />
  </button>
</div>

<style>
  .route-bar {
    display: flex;
    flex: none;
    align-items: center;
    gap: var(--sc-gap);
    padding: 3px 3px 3px var(--sc-pad-x);
    border-bottom: 1px solid var(--sc-border);
  }

  .end {
    flex: 1 1 0;
    min-width: 0;
  }

  .arrow {
    flex: none;
    color: var(--sc-muted);
  }

  .route-bar .sc-btn {
    color: var(--sc-label);
  }

  .route-bar .sc-btn:hover {
    color: var(--sc-accent);
  }
</style>
