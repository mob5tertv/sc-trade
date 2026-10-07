<script lang="ts">
  import { search, type Searchable } from '../../core/search';

  interface Props {
    items: Searchable[];
    /** Ids that come first among equally good matches (what the current terminal trades, say). */
    boostIds?: Set<number>;
    placeholder?: string;
    /**
     * The text that stands in the field until the player edits it (the name of the viewed location, say). A click
     * selects all of it, typing replaces it, and when the field is left it comes back.
     */
    value?: string;
    /** Called with the id of the chosen item; the box is emptied afterwards. */
    onPick: (id: number) => void;
    /** Accessible name of the input. */
    label?: string;
  }

  let { items, boostIds, placeholder = 'Поиск…', value, onPick, label = placeholder }: Props = $props();

  const MAX_RESULTS = 8;
  const listId = `search-${Math.random().toString(36).slice(2, 8)}`;

  let query = $state('');
  /** The player has typed into the field: it shows his text, not `value`. */
  let editing = $state(false);
  let open = $state(false);
  let active = $state(0);
  let input: HTMLInputElement | undefined = $state();

  const shown = $derived(editing || value === undefined ? query : value);
  const results = $derived(search(items, query, boostIds, MAX_RESULTS));
  const visible = $derived(open && results.length > 0);

  /** Puts the cursor into the box. */
  export function focus(): void {
    input?.focus();
  }

  function reset(): void {
    query = '';
    editing = false;
    open = false;
    active = 0;
  }

  function pick(id: number): void {
    reset();
    onPick(id);
  }

  function onInput(event: Event & { currentTarget: HTMLInputElement }): void {
    query = event.currentTarget.value;
    editing = true;
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
    } else if (event.key === 'Escape' && (open || query !== '' || editing)) {
      // The first Esc closes the list; the panel collapses only on the next one.
      event.preventDefault();
      event.stopPropagation();
      reset();
    }
  }

  // A field that shows a value is picked up whole: the next key replaces it.
  const selectValue = (field: HTMLInputElement): void => {
    if (!editing && value !== undefined) field.select();
  };

  function onBlur(): void {
    open = false;
    // what was typed and not picked is not kept when the field has a value to go back to
    if (value !== undefined) reset();
  }
</script>

<div class="box">
  <input
    bind:this={input}
    value={shown}
    class="sc-input"
    class:has-value={!editing && value !== undefined}
    type="text"
    role="combobox"
    aria-label={label}
    aria-expanded={visible}
    aria-controls={listId}
    aria-activedescendant={visible ? `${listId}-${active}` : undefined}
    aria-autocomplete="list"
    autocomplete="off"
    spellcheck="false"
    title={value}
    {placeholder}
    oninput={onInput}
    onkeydown={onKeydown}
    onfocus={(event) => {
      open = query !== '';
      selectValue(event.currentTarget);
    }}
    onclick={(event) => selectValue(event.currentTarget)}
    onblur={onBlur}
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

  /* the name of the place is text to read, not a hint: it keeps its own colour and gets the field's width */
  .has-value {
    text-overflow: ellipsis;
  }

  .list {
    position: absolute;
    z-index: 10;
    top: calc(100% + 1px);
    left: 0;
    right: 0;
    margin: 0;
    padding: 0;
    list-style: none;
    border: 1px solid var(--sc-frame);
    /* the window is glass; the list floats over content and needs to be solid */
    background: var(--sc-bg-solid);
  }

  li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sc-gap);
    height: var(--sc-row-h);
    padding: 0 var(--sc-pad-x);
    border-bottom: 1px solid var(--sc-surface-2);
    cursor: pointer;
  }

  li:last-child {
    border-bottom: 0;
  }

  li.active {
    background: var(--sc-surface-2);
    color: var(--sc-accent);
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
    font-size: var(--sc-font-sm);
  }
</style>
