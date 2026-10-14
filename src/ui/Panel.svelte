<script lang="ts">
  import { boot } from './boot';
  import Icon from './components/Icon.svelte';
  import GuideView from './GuideView.svelte';
  import Header from './Header.svelte';
  import LanguageView from './LanguageView.svelte';
  import TutorialCard from './TutorialCard.svelte';
  import { bootStatusText } from './vm/boot-status';
  import MessageLines from './MessageLines.svelte';
  import OptionsSection from './sections/OptionsSection.svelte';
  import RouteBar from './RouteBar.svelte';
  import RoutesSection from './sections/RoutesSection.svelte';
  import RunSection from './sections/RunSection.svelte';
  import TerminalSection from './sections/TerminalSection.svelte';
  import SettingsView from './SettingsView.svelte';
  import { app } from './state.svelte';
  import { runSectionKind } from './vm/run-section';
  import WindowGrip from './WindowGrip.svelte';
  import { tr } from '../i18n';

  // "Рейс" is the first section: it is there while a run goes on or a target is set
  const showRun = $derived(runSectionKind(app.strip) !== null);
</script>

<!--
  The expanded window: the header and a column of sections, as tall as its content, up to what the root allows; then
  only the long sections shrink and scroll. The glass and the frame are the root's. While the application starts, or
  when the start failed, the window says so in the same frame instead.
-->
{#if app.view === 'language' && app.phase !== 'failed'}
  <LanguageView />
{:else if app.phase !== 'ready'}
  <header class="bar">
    <WindowGrip />
    <strong class="title sc-label">SC Trade</strong>
    <button class="sc-btn sc-btn--ghost sc-btn--icon" type="button" aria-label={tr('Свернуть')} title={tr('Свернуть')} onclick={() => app.collapse('close button')}>
      <Icon name="minus" />
    </button>
  </header>
  {#if app.phase === 'failed'}
    <div class="boot">
      <p class="message error" role="alert">{app.bootError}</p>
      <button class="sc-btn sc-btn--primary" type="button" onclick={() => { app.log.info('ui', 'retry start'); void boot(); }}>{tr('Повторить')}</button>
    </div>
  {:else}
    <div class="boot">
      <p class="message status" role="status">{bootStatusText(app.bootStage)}</p>
    </div>
    <!-- the first start: the tutorial begins (with the ship) while the reference of UEX is still coming -->
    {#if app.tutorialStep !== null}<TutorialCard />{/if}
  {/if}
{:else if app.view === 'settings'}
  <SettingsView />
{:else if app.view === 'guide'}
  <GuideView />
{:else}
  <Header />
  {#if app.tutorialStep !== null}<TutorialCard />{/if}
  {#if app.routeBar}<RouteBar />{/if}
  <MessageLines />
  <div class="sections">
    {#if showRun}<RunSection />{/if}
    <TerminalSection />
    {#if app.lookup.request !== null}<OptionsSection />{/if}
    <RoutesSection />
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

  .boot {
    display: flex;
    flex: none;
    align-items: center;
    gap: var(--sc-gap);
    padding: 4px var(--sc-pad-x);
  }

  .message {
    flex: 1;
    min-width: 0;
    margin: 0;
  }

  .error {
    color: var(--sc-bad);
  }

  .status {
    color: var(--sc-muted);
  }

  /* the sections share the height that is left; the long ones shrink and scroll inside themselves */
  .sections {
    display: flex;
    flex: 0 1 auto;
    flex-direction: column;
    min-height: 0;
  }
</style>
