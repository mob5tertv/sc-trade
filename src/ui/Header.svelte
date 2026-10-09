<script lang="ts">
  import Icon from './components/Icon.svelte';
  import SearchBox from './components/SearchBox.svelte';
  import { app } from './state.svelte';
  import { searchTerminals, terminalSearchItems } from './vm/header';
  import { BADGE_TEXT, indicatorClick, indicatorFace } from './vm/keyboard-badge';
  import { windowHeader } from './vm/window-header';
  import WindowGrip from './WindowGrip.svelte';

  const header = $derived(windowHeader(app.reference, app.settings, app.viewTerminalId, app.pricesSyncedAt, app.uexOk, app.now, app.priceSync, app.referenceOk));
  const items = $derived(terminalSearchItems(app.reference, app.settings.starSystemId));
  // While the window holds the keyboard the slot of the UEX indicator says «Esc — в игру» instead (nothing else of the header moves or shrinks)
  const face = $derived(indicatorFace(app.keyboardHeld, header.uex));

  /** The click on the slot: the sign gives the keyboard back, the indicator refreshes the prices; right after the sign went away it does nothing. */
  function clickSlot(): void {
    const what = indicatorClick(app.keyboardHeld, performance.now(), app.keysSignGoneAt);
    if (what === 'give-back') void app.giveKeyboardBack();
    else if (what === 'refresh') void app.refreshPrices();
  }

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
  <!-- how fresh the prices of UEX are; a click refreshes them now, and while that goes the text is its progress. While the window holds
       the keyboard the same button is the sign «Esc — в игру» (a click gives the keyboard back and refreshes nothing): the indicator stays
       under it, unseen, so the slot keeps the width of its text, and a refresh that is going keeps going. -->
  <button
    class="uex"
    class:sign={face.sign}
    class:stale={face.stale}
    class:busy={face.busy}
    type="button"
    aria-busy={face.busy}
    title={face.title}
    onclick={clickSlot}
  >
    <span class="face" class:ghost={face.sign}><span class="mark" aria-hidden="true"></span>{header.uex.text}</span>
    {#if face.sign}<span class="keys">{BADGE_TEXT}</span>{/if}
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
  /* The slot is never narrower than the sign that stands in it ('Esc — в игру' needs 63,1 px with the padding, measured in the preview), so the
     sign never makes it wider: the header is the same with the sign and without it. The usual texts are wider than that already ('UEX сейчас'
     68,5 px, 'UEX 12 мин' 67,5), only a short one ('UEX 23/57' 62) gains a pixel or two; a longer text ('UEX офлайн 12 мин') keeps its width under the sign. */
  .uex {
    position: relative;
    display: flex;
    flex: none;
    align-items: center;
    align-self: stretch;
    min-width: 64px;
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

  /* the mark and the text of the indicator, as they were the content of the button itself */
  .face {
    display: flex;
    align-items: center;
    gap: 5px;
  }

  /* under the sign the indicator is not seen, but it keeps its place: the slot is as wide as its text (and no narrower than the sign) */
  .face.ghost {
    visibility: hidden;
  }

  /* the sign «Esc — в игру» stands over the slot, in the accent colour, and takes no room of its own */
  .keys {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .uex.sign,
  .uex.sign:hover {
    color: var(--sc-accent);
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
