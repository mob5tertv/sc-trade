<script lang="ts">
  import { search } from '../../core/search';
  import type { SearchItem } from '../vm/header';
  import { tr } from '../../i18n';

  interface Props {
    /** What is found; an item may say `place` (muted, after the name) and `title` (the tooltip of its row). */
    items: SearchItem[];
    /** Ids that come first among equally good matches (what the current terminal trades, say). */
    boostIds?: Set<number>;
    /**
     * How the items are searched: the type-ahead search of the core by default. The list of terminals gives its own
     * (`searchTerminals`: names before the star system); the commodity search and the quick entry keep the default.
     */
    find?: (items: SearchItem[], query: string, boostIds: Set<number> | undefined, limit: number) => SearchItem[];
    placeholder?: string;
    /**
     * The text that stands in the field until the player edits it (the name of the viewed location, say). A click
     * selects all of it, typing replaces it, and when the field is left it comes back.
     */
    value?: string;
    /**
     * Called with the id of the chosen item; the box is emptied afterwards. `ctrl` says the choice was made with Enter while Ctrl was held
     * (a choice by the mouse, and a plain Enter, are without it); a caller that has no use for it ignores the second argument.
     */
    onPick: (id: number, how: { ctrl: boolean }) => void;
    /** Accessible name of the input. */
    label?: string;
    /** The field is marked as wrong (a red line). */
    invalid?: boolean;
    /** The tooltip of the field; the value (the full name of what stands there) when absent. */
    title?: string;
    /** The field asks to be filled now (the accent colour of its frame, and what was typed and not picked is not kept when it is left). */
    asking?: boolean;
  }

  let { items, boostIds, find = search, placeholder = tr('Поиск…'), value, onPick, label = placeholder, invalid = false, title, asking = false }: Props = $props();

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
  const results = $derived(find(items, query, boostIds, MAX_RESULTS));
  const visible = $derived(open && results.length > 0);

  // The window is as big as its content, so a list that sticks out of the root of the window is cut off by the edge of
  // the window. While the list is open the root of the window (the nearest element marked `data-float-host`) gets a
  // minimum height that reaches the bottom of the list, and the list reaches the right edge of the window: it lies
  // over what is under it, moves nothing, and leaves no empty strip beside it. Outside such a root (the gallery)
  // nothing happens and the list is as wide as the CSS below says.
  // The root of the window may be zoomed (the setting «Масштаб»): what is measured is on the screen, and a length written to the list
  // or to the root is multiplied by the zoom. So the whole screen pixels are counted first, as always, and the length written is that
  // divided by the zoom (the width of the list and the height of the root then come out to the pixel on the screen).
  $effect(() => {
    const element = list;
    if (!element) return; // not open yet (`undefined`) or closed again (`null`)
    void results.length; // the list changes its height with the results
    const host = element.closest<HTMLElement>('[data-float-host]');
    if (host === null) return;
    const zoom = Number.parseFloat(getComputedStyle(host).zoom) || 1;
    const frame = host.getBoundingClientRect();
    element.style.maxWidth = 'none';
    element.style.width = `${Math.floor(frame.right - 1 - element.getBoundingClientRect().left) / zoom}px`; // 1 px is the frame
    host.style.setProperty('--sc-float-min-h', `${Math.ceil(element.getBoundingClientRect().bottom - frame.top) / zoom}px`);
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

  function pick(id: number, ctrl = false): void {
    reset();
    onPick(id, { ctrl });
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
      pick(chosen.id, event.ctrlKey);
    } else if (event.key === 'Escape' && (open || query !== '' || editing)) {
      // Esc closes the list and drops the query. The same press ends with the keyboard at the game (ui/keyboard.ts); the window stays open.
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
    // what was typed and not picked is not kept when the field has a value to go back to (or is asking for one)
    if (value !== undefined || asking) reset();
  }
</script>

<div class="box">
  <!-- `data-picked`: what is picked in the box, the text it shows when nothing is typed over it (empty: nothing is picked). The keyboard
       rules read it (ui/keyboard.ts): for them the box holds its pick, and what is typed over it is a query, which keeps no keyboard. -->
  <input
    bind:this={input}
    value={shown}
    data-picked={value ?? ''}
    class="sc-input"
    class:has-value={!editing && value !== undefined}
    class:asking
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
          <span class="name" class:with-place={Boolean(item.place)} title={item.title ?? item.name}>{item.name}</span>
          <!-- where it is: when both do not fit the name is cut with an ellipsis before the place is; the whole text is in the tooltip -->
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

  /* the field asks to be filled (the location after an arrival with no target): its frame and its question are in the accent colour */
  .asking {
    border-color: var(--sc-accent);
  }

  .asking::placeholder {
    color: var(--sc-accent);
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

  /* A row with a place: when the name and the place do not fit together the NAME gives way first (its share of the shrinking is
     so much larger that the place keeps its whole width, to the pixel, until the name is down to its floor), then the place does.
     While they fit nothing is cut, whatever the lengths, so a short name does not cost a long place its room. */
  .name.with-place {
    flex: 0 1000000 auto;
    min-width: 12ch;
  }

  /* where a terminal is, beside the code */
  .place {
    flex: 0 1 auto;
    min-width: 0;
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
