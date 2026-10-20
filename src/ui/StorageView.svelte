<script lang="ts">
  import CollapseButton from './components/CollapseButton.svelte';
  import Icon from './components/Icon.svelte';
  import KeyboardBadge from './KeyboardBadge.svelte';
  import MessageLines from './MessageLines.svelte';
  import { app } from './state.svelte';
  import { storagePlaces } from './vm/storage';
  import { formatUec } from '../core/format';
  import { cargoOf } from '../core/run';
  import { storageValue } from '../core/storage';
  import WindowGrip from './WindowGrip.svelte';
  import { tr } from '../i18n';

  // «Склад N» of the header (version 1.4): every storage, by place, with what lies there and what it cost. A place opens its terminal on the
  // tab «Склад», where its lines are loaded, corrected and written off. «Очистить всё» is for a wipe: everything is written off, as a loss.

  const places = $derived(storagePlaces(app.storage, app.reference, app.now, app.settings.currentTerminalId));
  // the free space of the hold, for the load in one click at the place where the ship stands (version 1.4.1); `null`: no ship chosen
  const free = $derived.by(() => {
    if (app.settings.scuCapacity <= 0) return null;
    const held = cargoOf(app.activeRun?.events ?? []).reduce((sum, line) => sum + line.scu, 0);
    return Math.max(0, app.settings.scuCapacity - held);
  });
  const loadable = (scu: number): number => (free === null ? scu : Math.min(free, scu));
  let busy = $state(false);

  async function load(terminalId: number, commodityId: number, scu: number): Promise<void> {
    if (busy) return;
    busy = true;
    error = await app.loadStorage({ terminalId, commodityId, scu });
    busy = false;
  }
  const total = $derived(formatUec(Math.round(storageValue(app.storage))));

  // «Очистить всё» asks in its own place, as «Сменил сервер» does: the first click turns it into «Точно?», the second writes
  let sure = $state(false);
  let sureTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => () => clearTimeout(sureTimer));
  let error = $state<string | null>(null);

  async function clearAll(): Promise<void> {
    if (!sure) {
      sure = true;
      clearTimeout(sureTimer);
      sureTimer = setTimeout(() => (sure = false), 4000);
      return;
    }
    sure = false;
    clearTimeout(sureTimer);
    error = await app.clearStorage();
  }
</script>

<header class="bar">
  <WindowGrip />
  <button class="sc-btn sc-btn--ghost sc-btn--icon back" type="button" aria-label={tr('Назад')} title={tr('Назад')} onclick={() => app.closeStorage()}>
    <Icon name="back" />
  </button>
  <strong class="title">{tr('Склад')}</strong>
  <KeyboardBadge />
  <CollapseButton extra="collapse" />
</header>

<MessageLines />

<div class="body">
  {#if places.length === 0}
    <p class="empty">{tr('На складах ничего не лежит. Купи больше трюма — остаток ляжет на склад той станции.')}</p>
  {:else}
    <p class="sum">
      <span class="sc-label">{tr('По цене закупки')}</span> <span class="sc-num">{total} UEC</span>
      <span class="hint">{tr('· в заработок не входит, пока не продано')}</span>
    </p>
    {#each places as place (place.key)}
      <section class="place">
        <button type="button" class="head" title={tr('Открыть склад этой станции')} onclick={() => app.showStorageAt(place.terminalId)}>
          <span class="name">{place.place}{#if place.here}<span class="here">{tr('ты здесь')}</span>{/if}</span>
          <span class="sc-num value">{place.value}</span>
          {#if !place.here}<span class="open">{tr('Открыть ›')}</span>{/if}
        </button>
        {#each place.rows as row (row.key)}
          <div class="line">
            <span class="code">{row.code}</span>
            <span class="what" title={row.name}>{row.name}</span>
            <span class="sc-num strong">{row.scuText} SCU</span>
            <span class="sc-num muted">{tr('по {price}', { price: row.price })}</span>
            <span class="sc-num muted age">{row.age}</span>
            {#if place.here}
              <!-- the ship stands here: the line is loaded from the list (elsewhere a click would start a run at the wrong place) -->
              <button type="button" class="sc-btn sc-btn--primary load" disabled={busy || loadable(row.scu) === 0} title={loadable(row.scu) === 0 ? tr('Трюм полон: места нет') : tr('Погрузил в трюм {n} SCU — сколько влезет; ошибся — «на склад» в карточке рейса', { n: loadable(row.scu) })} onclick={() => void load(row.terminalId, row.commodityId, loadable(row.scu))}>{tr('Погрузил {n}', { n: loadable(row.scu) })}</button>
            {/if}
          </div>
        {/each}
      </section>
    {/each}
    <div class="foot">
      <button
        type="button"
        class="sc-btn sc-btn--act"
        class:sure
        title={sure ? tr('Нажми ещё раз: всё со складов спишется убытком в сессию') : tr('Вайп или всё пропало: списать всё со складов')}
        onclick={() => void clearAll()}
      >{sure ? tr('Точно?') : tr('Очистить всё')}</button>
      {#if error}<span class="bad" role="alert">{error}</span>{/if}
    </div>
  {/if}
</div>

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

  .bar :global(.sc-btn) {
    color: var(--sc-label);
  }

  .bar :global(.sc-btn:hover) {
    color: var(--sc-accent);
  }

  .title {
    flex: 1;
  }

  .body {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    min-height: 0;
    overflow-y: auto;
  }

  .sum,
  .empty {
    margin: 0;
    padding: 4px var(--sc-pad-x);
  }

  .empty,
  .hint,
  .muted {
    color: var(--sc-muted);
  }

  .place {
    border-top: 1px solid var(--sc-border);
  }

  .head {
    display: flex;
    align-items: center;
    width: 100%;
    height: var(--sc-row-h);
    padding: 0 var(--sc-pad-x);
    border: 0;
    background: transparent;
    color: var(--sc-accent);
    font: inherit;
    font-weight: 600;
    text-align: left;
    cursor: pointer;
  }

  .head:hover {
    background: var(--sc-surface-2);
  }

  .name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .value {
    color: var(--sc-label);
  }

  .here {
    margin-left: 8px;
    color: var(--sc-warn);
    font-size: var(--sc-font-sm);
    font-weight: 400;
  }

  .open {
    margin-left: 10px;
    color: var(--sc-accent);
    font-size: var(--sc-font-sm);
    font-weight: 400;
  }

  .load {
    height: 22px;
    padding: 0 6px;
  }

  .line {
    display: flex;
    align-items: center;
    gap: 8px;
    height: var(--sc-row-h);
    padding: 0 var(--sc-pad-x) 0 calc(var(--sc-pad-x) + 10px);
    white-space: nowrap;
  }

  .code {
    flex: none;
    color: var(--sc-label);
    font-weight: 600;
  }

  .what {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .strong {
    font-weight: 600;
  }

  .age {
    min-width: 40px;
    text-align: right;
  }

  .foot {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px var(--sc-pad-x);
    border-top: 1px solid var(--sc-border);
  }

  .sure {
    border-color: var(--sc-bad);
    color: var(--sc-bad);
  }

  .bad {
    color: var(--sc-bad);
    font-size: var(--sc-font-sm);
  }
</style>
