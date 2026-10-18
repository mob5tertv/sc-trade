<script lang="ts">
  import CollapseButton from './components/CollapseButton.svelte';
  import Icon from './components/Icon.svelte';
  import KeyboardBadge from './KeyboardBadge.svelte';
  import MessageLines from './MessageLines.svelte';
  import { app } from './state.svelte';
  import { storagePlaces } from './vm/storage';
  import { formatUec } from '../core/format';
  import { storageValue } from '../core/storage';
  import WindowGrip from './WindowGrip.svelte';
  import { tr } from '../i18n';

  // «Склад N» of the header (version 1.4): every storage, by place, with what lies there and what it cost. A place opens its terminal on the
  // tab «Склад», where its lines are loaded, corrected and written off. «Очистить всё» is for a wipe: everything is written off, as a loss.

  const places = $derived(storagePlaces(app.storage, app.reference, app.now));
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
          <span class="name">{place.place}</span>
          <span class="sc-num value">{place.value}</span>
        </button>
        {#each place.rows as row (row.key)}
          <div class="line">
            <span class="code">{row.code}</span>
            <span class="what" title={row.name}>{row.name}</span>
            <span class="sc-num strong">{row.scuText} SCU</span>
            <span class="sc-num muted">{tr('по {price}', { price: row.price })}</span>
            <span class="sc-num muted age">{row.age}</span>
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
