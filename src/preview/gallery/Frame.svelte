<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  import { schedule } from './acts';
  import { useGallery } from './context';

  interface Props {
    /** The name of the state: `gallery=<page>/<name>` draws this one alone. */
    name: string;
    caption: string;
    /** 440 px, the width of the window; `content` for the mini line, which is as wide as what it says. */
    width?: number | 'content';
    /** Room for what hangs out of the state (an open list). */
    minHeight?: number;
    /** Done after the state is drawn: drives the real component with clicks and keys. */
    act?: (frame: HTMLElement) => void | Promise<void>;
    children: Snippet;
  }
  let { name, caption, width = 440, minHeight, act, children }: Props = $props();

  const { only } = useGallery();
  const shown = $derived(only === null || only === name);
  let glass: HTMLElement | undefined = $state();

  onMount(() => {
    const element = glass;
    if (act && element) schedule(() => act(element));
  });
</script>

{#if shown}
  <figure class="state" data-state={name}>
    <figcaption class="caption">{caption}</figcaption>
    <div class="sc-frame" style:width={width === 'content' ? 'max-content' : `${width}px`}>
      <div class="sc-frame__glass" style:min-height={minHeight === undefined ? undefined : `${minHeight}px`} bind:this={glass}>
        {@render children()}
      </div>
    </div>
  </figure>
{/if}

<style>
  .state {
    margin: 0;
  }

  .caption {
    width: fit-content;
    max-width: 440px;
    margin-bottom: 3px;
    padding: 0 3px;
    background: var(--gallery-caption-bg, transparent);
    color: var(--gallery-caption);
    font-size: 10.5px;
    letter-spacing: 0.04em;
  }
</style>
