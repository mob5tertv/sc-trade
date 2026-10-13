<script lang="ts">
  import { bestPlaces } from '../core/places';
  import { cargoOf } from '../core/run';
  import type { Side } from '../core/types';
  import Icon from './components/Icon.svelte';
  import SearchBox from './components/SearchBox.svelte';
  import TempBadge from './components/TempBadge.svelte';
  import KeyboardBadge from './KeyboardBadge.svelte';
  import MessageLines from './MessageLines.svelte';
  import { app } from './state.svelte';
  import { GUIDE_SCU_HEAD, guideEmptyText, guideRows } from './vm/guide';
  import { commoditySearchItems } from './vm/header';
  import { estimate } from '../core/estimate';
  import { isOwnPrice } from './vm/terminal-rows';
  import WindowGrip from './WindowGrip.svelte';

  // The commodity reference (spec 14.19, item 9): the ten best places to buy or to sell one commodity, by the prices that are
  // already loaded. A screen of its own in the same window, as the settings are; the header button, a button of a table row
  // and the notice of a price that is worse than expected open it.

  const guide = $derived(app.guide);
  const commodity = $derived(guide.commodityId === null ? undefined : app.reference.commodities.get(guide.commodityId));
  const items = $derived(commoditySearchItems(app.reference));
  const systemId = $derived(app.settings.starSystemId);
  const mySystem = $derived(app.settings.guideMySystem && systemId !== null);
  const onlyStock = $derived(app.settings.guideOnlyStock);
  const ctx = $derived(app.routeCtx(undefined, app.rowsNow));

  const places = $derived(
    guide.commodityId === null
      ? []
      : bestPlaces(app.market, guide.commodityId, guide.side, ctx, app.reference.terminals, { starSystemId: mySystem ? systemId : null, onlyStock }),
  );

  // Asked while the commodity is aboard and the player has typed in what THIS place pays for it: each place then says what flying
  // there would add to selling here (spec 14.19, item 8).
  const cargo = $derived.by(() => {
    if (guide.side !== 'sell' || guide.commodityId === null || app.activeRun === null || app.viewTerminalId === null) return null;
    const line = cargoOf(app.activeRun.events).find((l) => l.commodityId === guide.commodityId);
    if (line === undefined) return null;
    const here = estimate(app.market, app.viewTerminalId, guide.commodityId, 'sell', ctx);
    return here !== null && isOwnPrice(here) ? { scu: line.scu, herePrice: here.price } : null;
  });

  const rows = $derived(guideRows(places, app.reference, {
    targetId: app.settings.targetTerminalId, hereId: app.settings.currentTerminalId, cargo, side: guide.side, vehicle: app.vehicle,
  }));
  const filtered = $derived(mySystem || (guide.side === 'buy' && onlyStock));
  const setSide = (side: Side): void => app.openGuide(guide.commodityId, side);
</script>

<header class="bar">
  <WindowGrip />
  <button class="sc-btn sc-btn--ghost sc-btn--icon back" type="button" aria-label="Назад" title="Назад" onclick={() => app.closeGuide()}>
    <Icon name="back" />
  </button>
  <strong class="title">Справочная</strong>
  <KeyboardBadge />
  <button class="sc-btn sc-btn--ghost sc-btn--icon collapse" type="button" aria-label="Свернуть" title="Свернуть" onclick={() => app.collapse('close button')}>
    <Icon name="minus" />
  </button>
</header>

<MessageLines />

<div class="pick">
  <div class="search">
    <SearchBox
      {items}
      value={commodity ? `${commodity.code} ${commodity.name}` : ''}
      placeholder="Товар: три буквы и Enter"
      label="Товар справочной"
      onPick={(id) => app.openGuide(id, guide.side)}
    />
  </div>
  <div class="sc-seg" role="group" aria-label="Что показать">
    <button type="button" aria-pressed={guide.side === 'buy'} title="Где дешевле купить" onclick={() => setSide('buy')}>Купить</button>
    <button type="button" aria-pressed={guide.side === 'sell'} title="Где дороже продать" onclick={() => setSide('sell')}>Продать</button>
  </div>
</div>
<div class="filters">
  <label title={systemId === null ? 'Система не выбрана в настройках: показаны все' : 'Только терминалы системы из настроек'}>
    <input
      class="check"
      type="checkbox"
      checked={mySystem}
      disabled={systemId === null}
      onchange={(event) => void app.updateSetting('guideMySystem', event.currentTarget.checked)}
    />
    моя система
  </label>
  {#if guide.side === 'buy'}
    <label title="Только места, где запас известен и он не пуст">
      <input class="check" type="checkbox" checked={onlyStock} onchange={(event) => void app.updateSetting('guideOnlyStock', event.currentTarget.checked)} />
      есть запас
    </label>
  {/if}
  {#if cargo !== null}<span class="for">для твоего груза: {cargo.scu} SCU</span>{/if}
</div>
{#if app.targetUndo !== null}
  {@const before = app.targetUndo.targetId}
  <p class="undo">
    <span>Цель изменена</span>
    <button type="button" class="sc-btn" title="Вернуть цель, которая стояла до этого клика" onclick={() => void app.undoRetarget()}>
      {before !== null && app.reference.terminals.has(before) ? `Вернуть: ${app.reference.terminals.get(before)?.nickname || app.reference.terminals.get(before)?.name}` : 'Снять цель'}
    </button>
  </p>
{/if}

{#if guide.commodityId === null}
  <p class="line">Выбери товар: покажу десять лучших мест</p>
{:else if rows.length === 0}
  <p class="line">{guideEmptyText(guide.side, filtered)}</p>
{:else}
  <div class="table" class:with-extra={cargo !== null} role="table" aria-label="Лучшие места">
    <div class="grid head sc-label" role="row">
      <span role="columnheader">Место</span>
      <span role="columnheader" class="r">Цена</span>
      <span role="columnheader" class="r" title={GUIDE_SCU_HEAD[guide.side].title}>{GUIDE_SCU_HEAD[guide.side].label}</span>
      {#if cargo !== null}<span role="columnheader" class="r" title="Сколько добавит продажа там к продаже здесь, за весь твой груз">Добавка</span>{/if}
      <span role="columnheader"></span>
    </div>
    {#each rows as row (row.terminalId)}
      <div class="grid row" role="row">
        <button type="button" class="where" title="{row.terminal}{row.place ? `\n${row.place}` : ''}\nКлик — открыть таблицу этого терминала" onclick={() => app.showFromGuide(row.terminalId)}>
          <span class="name">{row.terminal}</span>
          {#if row.isHere}<span class="mark">ты здесь</span>{/if}
          {#if row.loadBar}<span class="bar" title="Твой корабль здесь не загрузится: {row.loadBar}">док</span>{/if}
          {#if row.place}<span class="place">{row.place}</span>{/if}
        </button>
        <span class="cell sc-num"><span>{row.price}</span><TempBadge compact text={row.badge.text} kind={row.badge.kind} /></span>
        <span class="sc-num">{row.scu}</span>
        {#if row.extra !== null}<span class="sc-num" class:good={!row.extraLoss} class:loss={row.extraLoss}>{row.extra}</span>{/if}
        {#if row.isTarget}
          <span class="goal" title="Цель рейса">цель</span>
        {:else}
          <button type="button" class="sc-btn sc-btn--act" title="Сделать этот терминал целью рейса" onclick={() => void app.retarget(row.terminalId)}>цель</button>
        {/if}
      </div>
    {/each}
  </div>
{/if}

<style>
  .bar {
    display: flex;
    flex: none;
    align-items: center;
    gap: 4px;
    height: var(--sc-bar-h);
    padding-right: 3px;
    border-bottom: 1px solid var(--sc-border);
  }

  .bar .sc-btn {
    color: var(--sc-label);
  }

  .bar .sc-btn:hover {
    color: var(--sc-accent);
  }

  .title {
    flex: 1;
  }

  .pick,
  .filters {
    display: flex;
    flex: none;
    align-items: center;
    gap: var(--sc-gap);
    padding: 3px var(--sc-pad-x);
  }

  .search {
    flex: 1 1 auto;
    min-width: 0;
  }

  .filters {
    gap: 12px;
    color: var(--sc-label);
    border-bottom: 1px solid var(--sc-border);
  }

  .filters label {
    display: flex;
    align-items: center;
    gap: 5px;
    white-space: nowrap;
  }

  .for {
    margin-left: auto;
    color: var(--sc-accent);
    white-space: nowrap;
  }

  .undo {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sc-gap);
    margin: 0;
    padding: 2px var(--sc-pad-x);
    color: var(--sc-accent);
  }

  .line {
    margin: 0;
    padding: 0 var(--sc-pad-x);
    min-height: var(--sc-row-h);
    color: var(--sc-muted);
    line-height: var(--sc-row-h);
  }

  .grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 74px 50px 46px;
    column-gap: var(--sc-gap);
    align-items: center;
    padding: 0 var(--sc-pad-x);
  }

  .with-extra .grid {
    grid-template-columns: minmax(0, 1fr) 74px 50px 66px 46px;
  }

  .head {
    height: 18px;
    border-bottom: 1px solid var(--sc-border);
    color: var(--sc-muted);
    white-space: nowrap;
  }

  .r,
  .row > .sc-num {
    text-align: right;
  }

  .row {
    height: calc(var(--sc-row-h) + 2px);
    border-bottom: 1px solid var(--sc-surface-2);
  }

  .where {
    display: flex;
    gap: 6px;
    min-width: 0;
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    white-space: nowrap;
    cursor: pointer;
  }

  .where:hover .name {
    color: var(--sc-accent);
  }

  .name {
    flex: none;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .place {
    overflow: hidden;
    color: var(--sc-muted);
    font-size: var(--sc-font-sm);
    text-overflow: ellipsis;
  }

  .mark,
  .goal {
    flex: none;
    color: var(--sc-good);
    font-size: var(--sc-font-sm);
  }

  .goal {
    text-align: center;
  }

  .bar {
    flex: none;
    color: var(--sc-bad);
    font-size: var(--sc-font-sm);
  }

  .cell {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 4px;
    min-width: 0;
  }

  .good {
    color: var(--sc-good);
  }

  .loss {
    color: var(--sc-bad);
  }
</style>
