<script lang="ts">
  import { search } from '../../core/search';
  import type { SearchItem } from '../vm/header';

  interface Props {
    /** What is found; an item may say `place` (muted, after the name) and `title` (the tooltip of its row). */
    items: SearchItem[];
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
    /** The field is marked as wrong (a red line). */
    invalid?: boolean;
    /** The tooltip of the field; the value (the full name of what stands there) when absent. */
    title?: string;
  }

  let { items, boostIds, placeholder = 'Поиск…', value, onPick, label = placeholder, invalid = false, title }: Props = $props();

  const MAX_RESULTS = 8;
  const listId = `search-${Math.random().toString(36).slice(2, 8)}`;

  let query = $state('');
  /** The player has typed into the field: it shows his text, not `value`. */
  let editing = $state(false);
  let open = $state(false);
  let active = $state(0);
  // `bind:this` is `undefined` until the element exists and `null` once it has gone (the list closes): both are "not there".
  let input: HTMLInputElement | null | undefined = $state();
  let list: HTMLElement | null | undefined = $state();

  const shown = $derived(editing || value === undefined ? query : value);
  const results = $derived(search(items, query, boostIds, MAX_RESULTS));
  const visible = $derived(open && results.length > 0);

  // The window is as big as its content, so a list that sticks out of the root of the window is cut off by the edge of
  // the window. While the list is open the root of the window (the nearest element marked `data-float-host`) gets a
  // minimum height that reaches the bottom of the list, and the list reaches the right edge of the window: it lies
  // over what is under it, moves nothing, and leaves no empty strip beside it. Outside such a root (the gallery)
  // nothing happens and the list is as wide as the CSS below says.
  $effect(() => {
    const element = list;
    if (!element) return; // not open yet (`undefined`) or closed again (`null`)
    void results.length; // the list changes its height with the results
    const host = element.closest<HTMLElement>('[data-float-host]');
    if (host === null) return;
    const frame = host.getBoundingClientRect();
    element.style.maxWidth = 'none';
    element.style.width = `${Math.floor(frame.right - 1 - element.getBoundingClientRect().left)}px`; // 1 px is the frame
    host.style.setProperty('--sc-float-min-h', `${Math.ceil(element.getBoundingClientRect().bottom - frame.top)}px`);
    return () => host.style.removeProperty('--sc-float-min-h');
  });

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

  function onKeydown(event: KeyboardEvent & { currentTarget: HTMLInputElement }): void {
    // Typing replaces what the field shows. The whole value is selected by the click, but the window may take the
    // focus after the click and the selection can go with that, so the first character does not rely on it.
    if (!editing && value !== undefined && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.currentTarget.value = '';
    }
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
    aria-invalid={invalid ? 'true' : undefined}
    autocomplete="off"
    spellcheck="false"
    title={title ?? value}
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
    <ul id={listId} class="list" role="listbox" bind:this={list}>
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
          <span class="name" title={item.title ?? item.name}>{item.name}</span>
          <!-- where it is: the name is cut with an ellipsis before the place is; the whole text is in the tooltip -->
          {#if item.place}<span class="place" title={item.title ?? item.place}>{item.place}</span>{/if}
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
    /* as wide as the field, and wider when the names need it: a short field must not cut every name */
    width: max-content;
    min-width: 100%;
    max-width: 300px;
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

  /* where a terminal is, beside the code: it keeps its size and gives way only past half of the row, so a long name is cut first */
  .place {
    flex: none;
    max-width: 55%;
    margin-left: auto;
    overflow: hidden;
    color: var(--sc-muted);
    font-size: var(--sc-font-sm);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .code {
    flex: none;
    color: var(--sc-muted);
    font-size: var(--sc-font-sm);
  }
</style>
