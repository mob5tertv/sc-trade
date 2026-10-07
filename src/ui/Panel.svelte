<script lang="ts">
  import { boot } from './boot';
  import Icon from './components/Icon.svelte';
  import Header from './Header.svelte';
  import OptionsSection from './sections/OptionsSection.svelte';
  import RoutesSection from './sections/RoutesSection.svelte';
  import RunSection from './sections/RunSection.svelte';
  import TerminalSection from './sections/TerminalSection.svelte';
  import SettingsView from './SettingsView.svelte';
  import { app } from './state.svelte';
  import { runSectionKind } from './vm/run-section';
  import WindowGrip from './WindowGrip.svelte';

  // "Рейс" is the first section: it is there while a run goes on or a target is set
  const showRun = $derived(runSectionKind(app.strip) !== null);
</script>

<!--
  The expanded window: the header and a column of sections, as tall as its content, up to what the root allows; then
  only the long sections shrink and scroll. The glass and the frame are the root's. While the application starts, or
  when the start failed, the window says so in the same frame instead.
-->
{#if app.phase !== 'ready'}
  <header class="bar">
    <WindowGrip />
    <strong class="title sc-label">SC Trade</strong>
    <button class="sc-btn sc-btn--ghost sc-btn--icon" type="button" aria-label="Свернуть" title="Свернуть" onclick={() => app.collapse('close button')}>
      <Icon name="minus" />
    </button>
  </header>
  {#if app.phase === 'failed'}
    <div class="boot">
      <p class="message error" role="alert">{app.bootError}</p>
      <button class="sc-btn sc-btn--primary" type="button" onclick={() => { app.log.info('ui', 'retry start'); void boot(); }}>Повторить</button>
    </div>
  {:else}
    <div class="boot">
      <p class="message status" role="status">{app.bootStatus}</p>
    </div>
  {/if}
{:else if app.view === 'settings'}
  <SettingsView />
{:else}
  <Header />
  {#if app.confirm !== null}
    <!-- the one question of the window: a line with two buttons, no dialog; it takes no keyboard and goes away with the answer -->
    <div class="ask" role="group" aria-label="Подтверждение">
      <span class="question">{app.confirm.text}</span>
      <span class="answers">
        <button class="sc-btn sc-btn--act yes" type="button" onclick={() => app.answer(true)}>{app.confirm.yes}</button>
        <button class="sc-btn sc-btn--act" type="button" onclick={() => app.answer(false)}>Отмена</button>
      </span>
    </div>
  {/if}
  {#if app.notice !== null}
    <div class="notice" class:error={app.notice.kind === 'error'} role="status">
      <span>{app.notice.text}</span>
      <button class="sc-btn sc-btn--ghost sc-btn--icon" type="button" aria-label="Скрыть сообщение" title="Скрыть" onclick={() => app.closeNotice()}>
        <Icon name="cross" size={12} />
      </button>
    </div>
  {/if}
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

  /* the question: the text takes what the two buttons leave and wraps rather than being cut; the line exists only while it is asked */
  .ask {
    display: flex;
    flex: none;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 2px var(--sc-gap);
    padding: 3px var(--sc-pad-x);
    border-bottom: 1px solid var(--sc-border);
    background: var(--sc-surface);
  }

  .question {
    flex: 1 1 200px;
    min-width: 0;
  }

  .answers {
    display: flex;
    flex: none;
    gap: 4px;
    margin-left: auto;
  }

  .yes {
    border-color: var(--sc-accent);
    color: var(--sc-accent);
  }

  /* the line exists only while there is a message */
  .notice {
    display: flex;
    flex: none;
    align-items: center;
    justify-content: space-between;
    gap: var(--sc-gap);
    padding: 0 0 0 var(--sc-pad-x);
    border-bottom: 1px solid var(--sc-border);
    background: var(--sc-surface);
  }

  .notice.error {
    color: var(--sc-bad);
  }

  .notice .sc-btn {
    flex: none;
    color: var(--sc-label);
  }

  /* the sections share the height that is left; the long ones shrink and scroll inside themselves */
  .sections {
    display: flex;
    flex: 0 1 auto;
    flex-direction: column;
    min-height: 0;
  }
</style>
