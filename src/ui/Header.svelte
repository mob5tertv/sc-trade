<script lang="ts">
  import Icon from './components/Icon.svelte';
  import SearchBox from './components/SearchBox.svelte';
  import { app } from './state.svelte';
  import { terminalSearchItems } from './vm/header';
  import { windowHeader } from './vm/window-header';
  import WindowGrip from './WindowGrip.svelte';

  const header = $derived(windowHeader(app.reference, app.settings, app.viewTerminalId, app.pricesSyncedAt, app.uexOk, app.now));
  const items = $derived(terminalSearchItems(app.reference, app.settings.starSystemId));
  const locked = $derived(app.windowLocked);
  const lockTitle = $derived(locked ? 'Открепить окно' : 'Закрепить окно');
</script>

<!-- One line: grip, the location (a search field that shows the viewed terminal), what the freshness of UEX is, the
     main button and the icons. The ship and the system are in the settings. -->
<header class="bar">
  <WindowGrip />
  <div class="location">
    <SearchBox
      {items}
      value={header.location ?? undefined}
      title={header.locationTitle}
      placeholder="Локация…"
      label="Локация: три буквы и Enter"
      onPick={(id) => app.setViewTerminal(id)}
    />
  </div>
  {#if header.hereTerminalId !== null}
    {@const here = header.hereTerminalId}
    <button class="sc-btn sc-btn--act here" type="button" title="Корабль стоит здесь: сделать это место текущей локацией" onclick={() => app.setCurrentTerminal(here)}>
      Я здесь
    </button>
  {/if}
  <span class="uex" class:stale={header.uex.stale} title={header.uex.title}>
    <span class="mark" aria-hidden="true"></span>{header.uex.text}
  </span>
  <button class="sc-btn sc-btn--primary route" type="button" title="Лучшие варианты из текущей локации" onclick={() => app.newRoute()}>
    Маршрут
  </button>
  <div class="icons">
    <button class="sc-btn sc-btn--ghost sc-btn--icon" type="button" aria-label="Сменил сервер" title="Сменил сервер: свои цены до этого момента считаются холодными" onclick={() => app.serverChanged()}>
      <Icon name="swap" />
    </button>
    <button
      class="sc-btn sc-btn--ghost sc-btn--icon"
      type="button"
      aria-pressed={locked}
      aria-label={lockTitle}
      title={lockTitle}
      onclick={() => app.toggleWindowLock()}
    >
      <Icon name={locked ? 'lock' : 'unlock'} />
    </button>
    <button class="sc-btn sc-btn--ghost sc-btn--icon" type="button" aria-label="Настройки" title="Настройки" onclick={() => app.openSettings()}>
      <Icon name="gear" />
    </button>
    <button class="sc-btn sc-btn--ghost sc-btn--icon" type="button" aria-label="Свернуть" title="Свернуть" onclick={() => app.collapse('close button')}>
      <Icon name="minus" />
    </button>
  </div>
</header>

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

  /* takes what the other parts leave */
  .location {
    flex: 1 1 0;
    min-width: 60px;
  }

  .here,
  .route {
    flex: none;
  }

  .uex {
    display: flex;
    flex: none;
    align-items: center;
    gap: 5px;
    color: var(--sc-muted);
    font-size: var(--sc-font-sm);
    white-space: nowrap;
  }

  /* data of UEX is nobody's reading of mine: an empty square, as in the tables */
  .mark {
    flex: none;
    width: 6px;
    height: 6px;
    border: 1px solid var(--sc-cold);
  }

  .uex.stale {
    color: var(--sc-warn);
  }

  .uex.stale .mark {
    border-color: var(--sc-warn);
    background: var(--sc-warn);
  }

  .icons {
    display: flex;
    flex: none;
    align-items: center;
  }

  .icons .sc-btn {
    color: var(--sc-label);
  }

  .icons .sc-btn:hover:not(:disabled),
  .icons .sc-btn[aria-pressed='true'] {
    color: var(--sc-accent);
  }
</style>
