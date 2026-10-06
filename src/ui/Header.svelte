<script lang="ts">
  import SearchBox from './components/SearchBox.svelte';
  import { app } from './state.svelte';
  import { terminalSearchItems } from './vm/header';
  import { locationModel } from './vm/location';

  let { onClose }: { onClose: () => void } = $props();

  let searchBox = $state<ReturnType<typeof SearchBox>>();

  /** Puts the cursor into the location search. */
  export function focusSearch(): void {
    searchBox?.focus();
  }

  const model = $derived(
    locationModel(app.reference, app.settings, app.viewTerminalId, app.pricesSyncedAt, app.uexOk, app.now),
  );
  const items = $derived(terminalSearchItems(app.reference, app.settings.starSystemId));
  const viewedId = $derived(app.viewTerminalId);
</script>

<header>
  <div class="location">
    <div class="where">
      <span class="label">Локация</span>
      <strong class="name" title={model.header.location}>{model.header.location}</strong>
    </div>
    {#if model.canSetCurrent && viewedId !== null}
      <button class="sc-btn" type="button" title="Корабль стоит здесь" onclick={() => app.setCurrentTerminal(viewedId)}>
        Я здесь
      </button>
    {/if}
    <button class="sc-btn sc-btn--ghost sc-btn--icon" type="button" aria-label="Закрыть" title="Закрыть (Esc)" onclick={onClose}>
      ×
    </button>
  </div>

  {#if model.currentLocation !== null}
    <div class="current" title={model.currentLocation}>Сейчас: {model.currentLocation}</div>
  {/if}

  <SearchBox
    bind:this={searchBox}
    {items}
    placeholder="Сменить локацию: три буквы и Enter"
    label="Поиск локации"
    onPick={(id) => app.setViewTerminal(id)}
  />

  <div class="meta">
    <span class="ship" title={model.header.ship}>{model.header.ship}</span>
    <span class="sep">·</span>
    <span class="system">{model.header.system}</span>
    <span class="sep">·</span>
    <span class="uex" class:stale={model.header.uexStale} title={model.header.uex}>{model.header.uex}</span>
    <button class="sc-btn server" type="button" title="Сервер игры сменился: свои цены до этого момента холодные" onclick={() => app.serverChanged()}>
      Сменил сервер
    </button>
  </div>
</header>

<style>
  header {
    display: flex;
    flex-direction: column;
    gap: var(--sc-gap);
    padding: var(--sc-gap) calc(var(--sc-gap) * 1.5);
    border-bottom: 1px solid var(--sc-border);
  }

  .location {
    display: flex;
    align-items: center;
    gap: var(--sc-gap);
  }

  .where {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
  }

  .label {
    color: var(--sc-muted);
    font-size: var(--sc-font-sm);
  }

  .name {
    overflow: hidden;
    font-size: 15px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .current {
    overflow: hidden;
    color: var(--sc-muted);
    font-size: var(--sc-font-sm);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .meta {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    font-size: var(--sc-font-sm);
  }

  .ship,
  .system,
  .uex {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ship {
    flex: 0 1 auto;
  }

  .uex {
    flex: 1 1 0;
    min-width: 0;
    color: var(--sc-muted);
  }

  .uex.stale {
    color: var(--sc-warn);
  }

  .sep {
    color: var(--sc-muted);
  }

  .server {
    flex: none;
    margin-left: auto;
    height: 26px;
    font-size: var(--sc-font-sm);
  }
</style>
