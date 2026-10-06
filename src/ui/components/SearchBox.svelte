<script lang="ts">
  import { search, type Searchable } from '../../core/search';

  interface Props {
    items: Searchable[];
    /** Ids that come first among equally good matches (what the current terminal trades, say). */
    boostIds?: Set<number>;
    placeholder?: string;
    /** Called with the id of the chosen item; the box is emptied afterwards. */
    onPick: (id: number) => void;
    /** Accessible name of the input. */
    label?: string;
  }

  let { items, boostIds, placeholder = 'Поиск…', onPick, label = placeholder }: Props = $props();

  const MAX_RESULTS = 8;
  const listId = `search-${Math.random().toString(36).slice(2, 8)}`;

  let query = $state('');
  let open = $state(false);
  let active = $state(0);
  let input: HTMLInputElement | undefined = $state();

  const results = $derived(search(items, query, boostIds, MAX_RESULTS));
  const visible = $derived(open && results.length > 0);

  /** Puts the cursor into the box. */
  export function focus(): void {
    input?.focus();
  }

  function reset(): void {
    query = '';
    open = false;
    active = 0;
  }

  function pick(id: number): void {
    reset();
    onPick(id);
  }

  function onInput(): void {
    open = true;
    active = 0;
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (results.length === 0) return;
      event.preventDefault();
      open = true;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      active = (active + step + results.length) % results.length;
    } else if (event.key === 'Enter') {
      const chosen = results[active];
      if (chosen === undefined) return;
      event.preventDefault();
      pick(chosen.id);
    } else if (event.key === 'Escape' && (open || query !== '')) {
      // The first Esc closes the list; the panel collapses only on the next one.
      event.preventDefault();
      event.stopPropagation();
      reset();
    }
  }
</script>

<div class="box">
  <input
    bind:this={input}
    bind:value={query}
    class="sc-input"
    type="text"
    role="combobox"
    aria-label={label}
    aria-expanded={visible}
    aria-controls={listId}
    aria-activedescendant={visible ? `${listId}-${active}` : undefined}
    aria-autocomplete="list"
    autocomplete="off"
    spellcheck="false"
    {placeholder}
    oninput={onInput}
    onkeydown={onKeydown}
    onfocus={() => (open = query !== '')}
    onblur={() => (open = false)}
  />
  {#if visible}
    <ul id={listId} class="list" role="listbox">
      {#each results as item, i (item.id)}
        <!-- Picked on mousedown, which must not take the focus from the input: the keyboard drives the list through the input. -->
        <li
          id="{listId}-{i}"
          role="option"
          aria-selected={i === active}
          class:active={i === active}
          onmouseenter={() => (active = i)}
          onmousedown={(event) => {
            event.preventDefault();
            pick(item.id);
          }}
        >
          <span class="name" title={item.name}>{item.name}</span>
          {#if item.code}<span class="code">{item.code}</span>{/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .box {
    position: relative;
    min-width: 0;
  }

  .list {
    position: absolute;
    z-index: 10;
    top: calc(100% + 2px);
    left: 0;
    right: 0;
    margin: 0;
    padding: 2px;
    list-style: none;
    border: 1px solid var(--sc-border);
    border-radius: var(--sc-radius);
    /* the panel background is translucent; the list floats over content and needs to be solid */
    background: #1b1e27;
    box-shadow: 0 6px 18px rgb(0 0 0 / 0.5);
  }

  li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sc-gap);
    height: 28px;
    padding: 0 8px;
    border-radius: 4px;
    cursor: pointer;
  }

  li.active {
    background: var(--sc-surface-2);
  }

  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .code {
    flex: none;
    color: var(--sc-muted);
    font-family: var(--sc-mono);
    font-size: var(--sc-font-sm);
  }
</style>
