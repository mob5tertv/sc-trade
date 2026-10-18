<script lang="ts">
  import CollapseButton from './components/CollapseButton.svelte';
  import { LANG_NAMES, LANGS, LANGUAGE_SCREEN, langOf, tr, type Lang } from '../i18n';
  import { app } from './state.svelte';
  import WindowGrip from './WindowGrip.svelte';

  // The first start of version 1.3, and the first start after an update from 1.2: one click picks the language of the window.
  // The language of Windows comes first and is already marked; the choice can be changed later in the settings («Окно»). The
  // two words of the screen are in both languages at once (`LANGUAGE_SCREEN`): the player has not said yet which one he reads.
  const system = langOf(navigator.language);
  const order: Lang[] = [system, ...LANGS.filter((lang) => lang !== system)];
</script>

<header class="bar">
  <WindowGrip />
  <strong class="title sc-label">SC Trade</strong>
  <CollapseButton />
</header>
<div class="choose" role="group" aria-labelledby="choose-language">
  <p class="question" id="choose-language">{LANGUAGE_SCREEN.title}</p>
  <div class="langs">
    {#each order as lang (lang)}
      <button type="button" class="sc-btn lang" class:sc-btn--primary={lang === system} {lang} onclick={() => void app.chooseLanguage(lang)}>
        {LANG_NAMES[lang]}
      </button>
    {/each}
  </div>
  <p class="note">{LANGUAGE_SCREEN.note}</p>
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

  .choose {
    display: flex;
    flex: none;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 16px var(--sc-pad-x) 14px;
  }

  .question {
    margin: 0;
    color: var(--sc-text);
    font-size: 15px;
    letter-spacing: 0.04em;
  }

  .langs {
    display: flex;
    gap: var(--sc-gap);
  }

  .lang {
    min-width: 120px;
    justify-content: center;
  }

  .note {
    margin: 0;
    color: var(--sc-muted);
    text-align: center;
  }
</style>
