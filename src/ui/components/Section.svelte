<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    /** In small spaced capitals (`.sc-label`). */
    title: string;
    /** A one-line summary in the header, cut with an ellipsis. */
    summary?: string;
    open: boolean;
    onToggle: () => void;
    /** A cross at the end of the header (the "Варианты" section closes for good). */
    onClose?: () => void;
    /** What the cross does, in two words, for the tooltip and the screen reader ('Снять цель'); 'Закрыть' by default. */
    closeTitle?: string;
    /** Small buttons at the right of the header; a click on them does not toggle the section. */
    actions?: Snippet;
    /**
     * A line that stands under the header and does not scroll with the content (the row of the quick entry); drawn
     * only while the section is open. It is not clipped by the scrolling content, so a list may open from it.
     */
    lead?: Snippet;
    children: Snippet;
    /** The content may shrink and scroll when the window has no height to spare; the header stays. */
    scroll?: boolean;
    /**
     * Of two open sections that scroll, the one with the larger number gives up more of its height first (a flex
     * shrink factor). The section that matters less, or is short, takes a small one. Only with `scroll`.
     */
    shrink?: number;
  }
  let { title, summary, open, onToggle, onClose, closeTitle = 'Закрыть', actions, lead, children, scroll = false, shrink = 1 }: Props = $props();

  const uid = $props.id();
  const bodyId = `${uid}-body`;
</script>

<section class="section" class:open class:scroll style:--shrink={shrink}>
  <div class="head">
    <button type="button" class="toggle" aria-expanded={open} aria-controls={open ? bodyId : undefined} title={summary ? `${title}: ${summary}` : title} onclick={() => onToggle()}>
      <svg class="chevron" class:open viewBox="0 0 10 10" width="10" height="10" aria-hidden="true"><path d="M3 1.5 7 5 3 8.5" /></svg>
      <span class="sc-label title">{title}</span>
      {#if summary}<span class="summary">{summary}</span>{/if}
    </button>
    {#if actions}<div class="actions">{@render actions()}</div>{/if}
    {#if onClose}
      <button type="button" class="close" aria-label="{closeTitle}: {title}" title={closeTitle} onclick={() => onClose?.()}>
        <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true"><path d="M1.5 1.5 8.5 8.5M8.5 1.5 1.5 8.5" /></svg>
      </button>
    {/if}
  </div>
  {#if open}
    {#if lead}<div class="lead sc-reveal">{@render lead()}</div>{/if}
    <div id={bodyId} class="body sc-reveal">{@render children()}</div>
  {/if}
</section>

<style>
  .section {
    display: flex;
    flex: none;
    flex-direction: column;
    min-height: 0;
  }

  /* an open section that may scroll takes what is left of the window and no more than its content; a closed one is
     its header only and never shrinks below it */
  .section.scroll.open {
    flex: 0 var(--shrink, 1) auto;
  }

  .head {
    display: flex;
    flex: none;
    align-items: stretch;
    height: var(--sc-head-h);
    background: var(--sc-surface);
    border-bottom: 1px solid var(--sc-border);
  }

  .toggle {
    display: flex;
    flex: 1;
    align-items: center;
    gap: var(--sc-gap);
    min-width: 0;
    padding: 0 var(--sc-pad-x);
    border: 0;
    background: transparent;
    color: var(--sc-text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .toggle:hover {
    background: var(--sc-surface-2);
  }

  .chevron,
  .close svg {
    flex: none;
    fill: none;
    stroke: var(--sc-accent);
    stroke-width: 1.6;
  }

  .chevron {
    transition: transform 100ms;
  }

  .chevron.open {
    transform: rotate(90deg);
  }

  .title {
    flex: none;
  }

  .summary {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .actions {
    display: flex;
    flex: none;
    align-items: center;
    gap: 4px;
    padding-right: 4px;
  }

  .close {
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: var(--sc-head-h);
    border: 0;
    border-left: 1px solid var(--sc-border);
    background: transparent;
    cursor: pointer;
  }

  .close:hover {
    background: var(--sc-surface-2);
  }

  .close svg {
    stroke: var(--sc-text);
  }

  .close:hover svg {
    stroke: var(--sc-accent);
  }

  .lead {
    flex: none;
  }

  .body {
    min-height: 0;
  }

  .scroll .body {
    flex: 0 1 auto;
    overflow-x: hidden;
    overflow-y: auto;
  }

  @media (prefers-reduced-motion: reduce) {
    .chevron {
      transition: none;
    }
  }
</style>
