<script lang="ts">
  import Icon from './components/Icon.svelte';
  import { app } from './state.svelte';
</script>

<!--
  The two lines under the header of the expanded window: the question that waits for yes or no, and the message of the application.
  Both belong to the window, not to the main screen, so the main screen and the settings draw the same lines (a question asked by a
  button of the settings, like the clearing of the history, is answered right there). Each line exists only while there is something to say.
-->
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
    <span class="text">{app.notice.text}</span>
    <!-- a message may offer one thing to do about it (the hint about the keys: "Настроить"), next to the cross -->
    {#if app.notice.action}
      {@const action = app.notice.action}
      <button class="sc-btn sc-btn--act action" type="button" onclick={() => action.run()}>{action.label}</button>
    {/if}
    <button class="sc-btn sc-btn--ghost sc-btn--icon" type="button" aria-label="Скрыть сообщение" title="Скрыть" onclick={() => app.closeNotice()}>
      <Icon name="cross" size={12} />
    </button>
  </div>
{/if}

<style>
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

  .notice .text {
    min-width: 0;
    padding: 2px 0;
  }

  .notice .sc-btn {
    flex: none;
    color: var(--sc-label);
  }

  /* the one thing the message offers to do: a button of the accent, as the buttons of a question */
  .notice .sc-btn.action {
    margin-left: auto;
    border-color: var(--sc-accent);
    color: var(--sc-accent);
  }
</style>
