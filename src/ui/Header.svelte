<script lang="ts">
  import Icon from './components/Icon.svelte';
  import SearchBox from './components/SearchBox.svelte';
  import { app } from './state.svelte';
  import { searchTerminals, terminalSearchItems } from './vm/header';
  import { windowHeader } from './vm/window-header';
  import WindowGrip from './WindowGrip.svelte';

  const header = $derived(windowHeader(app.reference, app.settings, app.viewTerminalId, app.pricesSyncedAt, app.uexOk, app.now, app.priceSync, app.referenceOk));
  const items = $derived(terminalSearchItems(app.reference, app.settings.starSystemId));
  const locked = $derived(app.windowLocked);
  const lockTitle = $derived(locked ? 'Открепить окно' : 'Закрепить окно');

  // One misclick would make every price of mine cold: only a "yes" under the header writes it.
  const askServerChanged = (): void =>
    app.ask({ text: 'Сервер сменился? Свои цены до этой минуты станут холодными.', yes: 'Да, сменился' }, () => app.serverChanged());
</script>

<!-- One line: grip, the location (a search field that shows the viewed terminal), what the freshness of UEX is, the
     main button and the icons. The ship and the system are in the settings. -->
<header class="bar">
  <WindowGrip />
  <div class="location">
    <SearchBox
      {items}
      find={searchTerminals}
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
  <!-- how fresh the prices of UEX are; a click refreshes them now, and while that goes the text is its progress -->
  <button
    class="uex"
    class:stale={header.uex.stale}
    class:busy={header.uex.busy}
    type="button"
    aria-busy={header.uex.busy}
    title={header.uex.title}
    onclick={() => void app.refreshPrices()}
  >
    <span class="mark" aria-hidden="true"></span>{header.uex.text}
  </button>
  <button class="sc-btn sc-btn--primary route" type="button" title="Лучшие варианты из текущей локации" onclick={() => app.newRoute()}>
    Маршрут
  </button>
  <div class="icons">
    <button class="sc-btn sc-btn--ghost sc-btn--icon" type="button" aria-label="Сменил сервер" title="Сменил сервер: свои цены до этого момента считаются холодными" onclick={askServerChanged}>
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

  /* a button that reads as a quiet label: the colour changes only when the state does or the pointer is over it */
  .uex {
    display: flex;
    flex: none;
    align-items: center;
    align-self: stretch;
    gap: 5px;
    padding: 0 4px;
    border: 0;
    background: transparent;
    color: var(--sc-muted);
    font: inherit;
    font-size: var(--sc-font-sm);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    cursor: pointer;
  }

  .uex:hover {
    background: var(--sc-surface-2);
    color: var(--sc-text);
  }

  .uex:focus-visible {
    outline: 1px solid var(--sc-accent);
    outline-offset: -1px;
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

  /* a refresh is going: its progress in the colour of the accent, the mark filled; a second click does nothing */
  .uex.busy {
    color: var(--sc-accent);
    cursor: progress;
  }

  .uex.busy .mark {
    border-color: var(--sc-accent);
    background: var(--sc-accent);
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
