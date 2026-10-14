<script lang="ts">
  import Icon from './components/Icon.svelte';
  import SearchBox from './components/SearchBox.svelte';
  import { app } from './state.svelte';
  import { searchTerminals, terminalSearchItems, headerCompact } from './vm/header';
  import { indicatorClick, indicatorFace } from './vm/keyboard-badge';
  import { locationFieldTitle, locationPlaceholder } from './vm/terminal-pick';
  import { windowHeader } from './vm/window-header';
  import WindowGrip from './WindowGrip.svelte';
  import { tr } from '../i18n';

  const header = $derived(windowHeader(app.reference, app.settings, app.viewTerminalId, app.pricesSyncedAt, app.uexOk, app.now, app.priceSync, app.referenceOk));
  const items = $derived(terminalSearchItems(app.reference, app.settings.starSystemId));
  // While the window holds the keyboard the slot of the UEX indicator says «Esc — в игру» instead, and for a few seconds after the keyboard
  // went back by itself it says «Клавиатура у игры», muted (nothing else of the header moves or shrinks)
  const face = $derived(indicatorFace(app.keyboardHeld, header.uex, app.keyboardGoneSign));
  // After an arrival with no target the field asks "Где прилетел?": it shows no old name, only the question, and the next terminal chosen is the answer
  const asking = $derived(app.askingWhere);
  const locationTitle = $derived(locationFieldTitle(header.locationTitle, { runGoing: app.activeRun !== null, askingWhere: asking }));

  /**
   * The click on the slot: the sign «Esc — в игру» gives the keyboard back, the indicator refreshes the prices; right after that sign went away,
   * and while «Клавиатура у игры» stands in the slot, it does nothing.
   */
  function clickSlot(): void {
    const now = performance.now();
    const what = indicatorClick(app.keyboardHeld, now, app.keysSignGoneAt, app.keyboardGoneSign);
    if (what === 'give-back') void app.giveKeyboardBack();
    else if (what === 'refresh') void app.refreshPrices();
    // an ignored click is silent on the screen: the log is where "UEX did not refresh when I clicked" is explained
    else if (app.keyboardGoneSign) app.log.debug('ui', 'indicator click ignored: the sign "the keyboard is with the game" stands in the slot');
    else app.log.debug('ui', 'indicator click ignored: the sign "Esc to the game" went away just now', { agoMs: Math.round(now - app.keysSignGoneAt) });
  }

  const locked = $derived(app.windowLocked);
  const lockTitle = $derived(locked ? tr('Открепить окно') : tr('Закрепить окно'));

  // One misclick would make every price of mine cold, so the button asks, and in its own place (the author, 14.10.2026): the first
  // click turns the icon into «Точно?», the second one on the same button writes it; left alone for four seconds it is the icon again.
  const SERVER_SURE_MS = 4000;
  let serverSure = $state(false);
  let serverTimer: ReturnType<typeof setTimeout> | undefined;
  function serverClick(): void {
    clearTimeout(serverTimer);
    if (serverSure) {
      serverSure = false;
      void app.serverChanged();
      return;
    }
    serverSure = true;
    serverTimer = setTimeout(() => { serverSure = false; }, SERVER_SURE_MS);
  }
</script>

<!-- One line: grip, the location (a search field that shows the viewed terminal), what the freshness of UEX is, the
     main button and the icons. The ship and the system are in the settings. -->
<header class="bar" class:compact={headerCompact(app.settings.panelWidth)}>
  <WindowGrip />
  <div class="location">
    <SearchBox
      {items}
      find={searchTerminals}
      value={asking ? undefined : header.location ?? '' /* never without a value: with no place viewed the box still drops an unpicked query when it is left */}
      title={locationTitle}
      placeholder={locationPlaceholder(asking)}
      label={tr('Локация: три буквы и Enter')}
      {asking}
      onPick={(id, { ctrl }) => void app.pickTerminal(id, ctrl)}
    />
  </div>
  {#if header.hereTerminalId !== null}
    {@const here = header.hereTerminalId}
    <button class="sc-btn sc-btn--act here" type="button" title={tr('Корабль стоит здесь: сделать это место текущей локацией')} onclick={() => app.setCurrentTerminal(here)}>
      {tr('Я здесь')}
    </button>
  {/if}
  <!-- how fresh the prices of UEX are; a click refreshes them now, and while that goes the text is its progress. While the window holds
       the keyboard the same button is the sign «Esc — в игру» (a click gives the keyboard back and refreshes nothing): the indicator stays
       under it, unseen, so the slot keeps the width of its text, and a refresh that is going keeps going. For a few seconds after the
       keyboard went back by itself the slot is the muted sign «Клавиатура у игры»: it only tells, a click does nothing then, and the
       button says so (`aria-disabled`). -->
  <button
    class="uex"
    class:sign={face.sign}
    class:gone={face.muted}
    class:stale={face.stale}
    class:busy={face.busy}
    type="button"
    aria-busy={face.busy}
    aria-disabled={face.muted ? 'true' : undefined}
    title={face.title}
    onclick={clickSlot}
  >
    <span class="face" class:ghost={face.sign}><span class="mark" aria-hidden="true"></span>{header.uex.text}</span>
    {#if face.sign}<span class="keys">{face.text}</span>{/if}
  </button>
  <button class="sc-btn sc-btn--primary route" type="button" title={tr('Лучшие рейсы из текущей локации')} onclick={() => app.bestRoutes()}>
    {tr('Лучшее')}
  </button>
  <button
    class="sc-btn sc-btn--act plan"
    type="button"
    aria-pressed={app.routeBar}
    title={tr('Свой маршрут: введи, откуда и куда, — и «Варианты» покажут товары для этой пары')}
    onclick={() => app.toggleRouteBar()}
  >
    {tr('Маршрут')}
  </button>
  <div class="icons">
    <button
      class="sc-btn sc-btn--ghost sc-btn--icon"
      type="button"
      aria-label={tr('Справочная по товарам')}
      title={tr('Справочная: десять лучших мест купить или продать товар')}
      onclick={() => app.openGuide()}
    >
      <Icon name="book" />
    </button>
    <button
      class="sc-btn sc-btn--ghost"
      class:sc-btn--icon={!serverSure}
      class:sure={serverSure}
      type="button"
      aria-label={serverSure ? tr('Точно сменил сервер? Нажми ещё раз') : tr('Сменил сервер')}
      title={serverSure ? tr('Нажми ещё раз: свои цены до этой минуты станут холодными. Не нажмёшь — кнопка вернётся сама') : tr('Сменил сервер: свои цены до этого момента считаются холодными')}
      onclick={serverClick}
    >
      {#if serverSure}{tr('Точно?')}{:else}<Icon name="swap" />{/if}
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
    <button class="sc-btn sc-btn--ghost sc-btn--icon" type="button" aria-label={tr('Настройки')} title={tr('Настройки')} onclick={() => app.openSettings()}>
      <Icon name="gear" />
    </button>
    <button class="sc-btn sc-btn--ghost sc-btn--icon" type="button" aria-label={tr('Свернуть')} title={tr('Свернуть')} onclick={() => app.collapse('close button')}>
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

  /* «Клавиатура у игры» only tells: muted, no hand, nothing lights under the pointer. It stands in two lines, «Клавиатура» over «у игры»
     (its one breaking space is after the first word), so the slot is no wider for it than for «Esc — в игру» and the header does not move. */
  .uex.sign.gone,
  .uex.sign.gone:hover {
    background: transparent;
    color: var(--sc-muted);
    cursor: default;
  }

  .uex.gone .keys {
    line-height: 11px;
    text-align: center;
    white-space: normal;
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

  /* A window narrower than the header at its full size (`headerCompact`; the default 440 px is one): the parts stand closer, which
     is enough for everything to fit at the default width, «Я здесь» included. Narrower still, the freshness of UEX is what gives
     way (its text is cut), never the icons: the last of them collapses the window. */
  .bar.compact {
    gap: 3px;
  }

  .bar.compact .location {
    min-width: 52px;
  }

  .bar.compact .here,
  .bar.compact .route,
  .bar.compact .plan {
    padding: 0 6px;
  }

  .bar.compact .icons .sc-btn {
    width: 22px;
  }

  .bar.compact .uex {
    flex: 0 1 auto;
    min-width: 16px;
    overflow: hidden;
  }

  /* «Сменил сервер» asked once more: the question stands in the place of the icon, in the colour of a thing that cannot be taken back */
  .icons .sc-btn.sure,
  .bar.compact .icons .sc-btn.sure {
    width: auto;
    padding: 0 6px;
    border-color: var(--sc-bad);
    color: var(--sc-bad);
  }

  .icons .sc-btn:hover:not(:disabled),
  .icons .sc-btn[aria-pressed='true'] {
    color: var(--sc-accent);
  }
</style>
