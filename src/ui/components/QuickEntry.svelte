<script lang="ts">
  import { untrack } from 'svelte';
  import { formatUec } from '../../core/format';
  import type { Searchable } from '../../core/search';
  import type { Side } from '../../core/types';
  import { rejectionText, resolveQuickEntry, allowedSide, mayWrite, type EntrySides } from '../vm/quick-entry';
  import type { Rejection } from '../vm/quick-entry';
  import SearchBox from './SearchBox.svelte';

  interface PriceEntry { terminalId: number; commodityId: number; side: Side; price: number; scu: number | null }

  interface Props {
    /** The viewed terminal: the price is written for it. The location is picked in the header of the window, not here. */
    terminalId: number | null;
    /** The name of that terminal, for the line that says where a price of a commodity it does not trade would go. */
    place?: string;
    commodityItems: Searchable[];
    /** The commodities the form offers on a side: on «Куп.» what the terminal sells, on «Прод.» what it buys. Without it, all of `commodityItems`. */
    itemsFor?: (side: Side) => Searchable[];
    /** What the viewed terminal trades: those commodities come first in the search. */
    boostIds: Set<number>;
    /**
     * The side the line shows for a commodity at the viewed terminal while the player has not picked one by hand; `null`: no commodity
     * is chosen yet (the owner answers with the side of the table the player is looking at, `defaultSide`).
     */
    sideFor: (commodityId: number | null) => Side;
    /** The sides the terminal trades a commodity on: the price can be written to those only; `null` (and no function): not limited. */
    sidesFor?: (commodityId: number | null) => EntrySides | null;
    /** Writes the price; answers the sentence to show when it was not saved, `null` when it was. */
    onSave: (entry: PriceEntry) => Promise<string | null>;
    /** Enter was pressed with something missing or unreadable (nothing was saved): which of the parts it was, never what was typed. */
    onReject?: (e: { reason: Rejection }) => void;
    /** `onSave` threw instead of answering: the player sees a short sentence, the details belong in the log. */
    onFailure?: (err: unknown, entry: PriceEntry) => void;
  }
  let { terminalId, place = '', commodityItems, itemsFor, boostIds, sideFor, sidesFor, onSave, onReject, onFailure }: Props = $props();

  const uid = $props.id();
  const groupName = `side-${uid}`;

  let commodityId = $state<number | null>(null);
  /** The side the player picked by hand; `null` while the side follows what the terminal trades and the tab he is on (`sideFor`). */
  let pickedSide = $state<Side | null>(null);
  let priceText = $state('');
  let scuText = $state('');
  let badPrice = $state(false);
  let badScu = $state(false);
  let badCommodity = $state(false);
  /** The write was refused, or there is nowhere to write to: the button of the line is marked. */
  let badSave = $state(false);
  let busy = $state(false);
  // What happened, for the screen reader and for the tooltip of the field that is marked. A saved price says nothing on the screen
  // (the table below is its confirmation), so it shifts nothing.
  let status = $state<{ text: string; kind: 'ok' | 'error' } | null>(null);
  const problem = $derived(status !== null && status.kind === 'error' ? status.text : null);
  // A refusal says why in words under the line, for as long as a field is marked; with no refusal the line is not there at all and
  // takes no height. The marked fields point at it (`aria-describedby`).
  const reasonShown = $derived(problem !== null && (badPrice || badScu || badCommodity || badSave));
  const reasonId = `reason-${uid}`;

  // `bind:this` gives `undefined` before the element exists and `null` after it has gone: both are "not there"
  let commodityBox = $state<ReturnType<typeof SearchBox> | null>();
  let priceInput = $state<HTMLInputElement | null>();
  let scuInput = $state<HTMLInputElement | null>();

  const chosen = $derived(commodityId === null ? undefined : commodityItems.find((c) => c.id === commodityId));
  // The commodity is none of those this terminal is known to trade (by UEX or by my own records): the price is still written, the
  // player may see what UEX does not, but the line says where it goes, so that a price meant for another station is not left here.
  const foreign = $derived(commodityId !== null && !boostIds.has(commodityId));
  // The one side of the line: the switch shows it and the price is written to it. With no commodity chosen it is not "buy" but what
  // the owner says for the empty line (the tab), so the switch never shows a side the price would not go to.
  const sides = $derived(sidesFor?.(commodityId) ?? null);
  const side = $derived<Side>(allowedSide(pickedSide ?? sideFor(commodityId), sides));
  // The list of the search follows the side the line is on before a commodity is chosen: the side picked by hand, else the tab of
  // the table. A commodity that is traded on the other side only is not offered here: the player switches the side to see it.
  const listSide = $derived<Side>(pickedSide ?? sideFor(null));
  const items = $derived(itemsFor ? itemsFor(listSide) : commodityItems);

  // What is on the line belongs to the terminal it was typed for: with another terminal in the table the line starts empty, or a
  // commodity picked from the list of one station would be written to the next one, which may not trade it at all.
  $effect(() => {
    void terminalId;
    untrack(() => {
      commodityId = null;
      pickedSide = null;
      priceText = '';
      scuText = '';
      badPrice = false;
      badScu = false;
      badCommodity = false;
      badSave = false;
      status = null;
    });
  });

  // Enter in the commodity field takes the first match, and the player goes on with the price.
  function pickCommodity(id: number): void {
    commodityId = id;
    pickedSide = listSide;
    status = null;
    badCommodity = false;
    badSave = false;
    priceInput?.focus();
  }

  function reject(reason: Rejection): void {
    status = { text: rejectionText(reason), kind: 'error' };
    onReject?.({ reason });
  }

  async function save(): Promise<void> {
    if (busy) return;
    badSave = false;
    badCommodity = false;
    // Enter on an empty line is not an entry
    if (commodityId === null && priceText.trim() === '' && scuText.trim() === '') return;
    if (terminalId === null) {
      badSave = true;
      reject('no-terminal');
      return;
    }
    if (commodityId === null) {
      badCommodity = true;
      reject('no-commodity');
      commodityBox?.focus();
      return;
    }
    // the list offers only what the terminal trades on the side; this is the same rule at the moment of the write, whatever
    // the line went through since the commodity was picked
    if (!mayWrite(side, sides)) {
      badCommodity = true;
      reject('not-traded');
      commodityBox?.focus();
      return;
    }
    const input = resolveQuickEntry(priceText, scuText);
    if (!input.ok) {
      badPrice = input.price;
      badScu = input.scu;
      if (input.price) {
        reject('bad-price');
        priceInput?.focus();
      } else {
        reject('bad-scu');
        scuInput?.focus();
      }
      return;
    }

    // What is saved is what was on the line when Enter was pressed. The side and the commodity are derived and may
    // change while the save is awaited, so the entry and the confirmation are built from these.
    const entry: PriceEntry = { terminalId, commodityId, side, price: input.price, scu: input.scu };
    const label = chosen?.code ?? `#${commodityId}`;

    busy = true;
    let failure: string | null;
    try {
      failure = await onSave(entry);
    } catch (err) {
      onFailure?.(err, entry);
      failure = 'Не удалось записать цену. Подробности в логе.';
    } finally {
      busy = false;
    }
    if (failure !== null) {
      // what was typed stays, so that it can be saved again
      status = { text: failure, kind: 'error' };
      badSave = true;
      return;
    }
    status = {
      text: `Записано: ${label} · ${entry.side === 'buy' ? 'покупка' : 'продажа'} ${formatUec(entry.price)}`,
      kind: 'ok',
    };
    commodityId = null;
    pickedSide = null;
    priceText = '';
    scuText = '';
    badPrice = false;
    badScu = false;
    commodityBox?.focus();
  }

  // Esc takes back what was typed into the field. The same press gives the keyboard back to the game, whatever is done here
  // (ui/keyboard.ts): the line stays as it is then, with the commodity that was picked, and nothing is written.
  function onFieldKeydown(event: KeyboardEvent, text: string, clear: () => void): void {
    if (event.key !== 'Escape' || text === '') return;
    event.preventDefault();
    event.stopPropagation();
    clear();
  }
</script>

<!-- `data-entry-field`: the button that opens the line («+ цена») puts the cursor into its first field, the commodity (ui/keyboard.ts) -->
<!-- The commodity box has a value at all times, an empty one while no commodity is picked: a search box with a value to go back to drops
     what was typed and not picked when it is left. A query is a search, not an entry: it keeps no keyboard (vm/keyboard-idle.ts), and when
     the keyboard has gone back to the game by itself no stray letter is left in «Товар». -->
<form
  class="quick"
  aria-label="Быстрый ввод цены"
  data-entry-field="quick"
  onsubmit={(event) => {
    event.preventDefault();
    void save();
  }}
>
  <div class="line">
    <SearchBox
      bind:this={commodityBox}
      {items}
      {boostIds}
      placeholder="Товар"
      label="Товар: три буквы кода или названия и Enter"
      value={chosen ? `${chosen.code} ${chosen.name}` : ''}
      invalid={badCommodity}
      title={badCommodity && problem !== null ? problem : undefined}
      onPick={pickCommodity}
    />
    <!-- `data-opens-entry`: for the keyboard the switch is a button that opens an entry (ui/keyboard.ts). The pointer over it arms the
         window like a field, the press on a side takes the keyboard (or keeps it), and the cursor goes into the price (`data-entry-field`
         with the same name), its number selected: picking a side never leaves the line without a cursor, with its keys going to the game. -->
    <div class="sc-seg" role="radiogroup" aria-label="Сторона" data-opens-entry="quick-price">
      <label class="side" class:is-on={side === 'buy'} class:off={sides !== null && !sides.buy} title={sides !== null && !sides.buy ? 'Этот товар здесь не продают' : 'Цена, по которой здесь можно купить'}>
        <input type="radio" name={groupName} checked={side === 'buy'} disabled={sides !== null && !sides.buy} onchange={() => (pickedSide = 'buy')} />
        <span>Куп.</span>
      </label>
      <label class="side" class:is-on={side === 'sell'} class:off={sides !== null && !sides.sell} title={sides !== null && !sides.sell ? 'Этот товар здесь не покупают' : 'Цена, по которой здесь можно продать'}>
        <input type="radio" name={groupName} checked={side === 'sell'} disabled={sides !== null && !sides.sell} onchange={() => (pickedSide = 'sell')} />
        <span>Прод.</span>
      </label>
    </div>
    <input
      bind:this={priceInput}
      bind:value={priceText}
      class="sc-input sc-num in-price"
      type="text"
      inputmode="numeric"
      autocomplete="off"
      data-select-on-focus
      data-entry-field="quick-price"
      placeholder="Цена"
      title={badPrice && problem !== null ? problem : 'Цена, UEC за SCU'}
      aria-label="Цена, UEC за SCU"
      aria-invalid={badPrice ? 'true' : undefined}
      aria-describedby={badPrice && reasonShown ? reasonId : undefined}
      oninput={() => (badPrice = false)}
      onkeydown={(event) => onFieldKeydown(event, priceText, () => { priceText = ''; badPrice = false; })}
    />
    <input
      bind:this={scuInput}
      bind:value={scuText}
      class="sc-input sc-num in-scu"
      type="text"
      inputmode="numeric"
      autocomplete="off"
      data-select-on-focus
      placeholder="SCU"
      title={badScu && problem !== null ? problem : 'Количество, SCU (можно не вводить)'}
      aria-label="Количество, SCU (можно не вводить)"
      aria-invalid={badScu ? 'true' : undefined}
      aria-describedby={badScu && reasonShown ? reasonId : undefined}
      oninput={() => (badScu = false)}
      onkeydown={(event) => onFieldKeydown(event, scuText, () => { scuText = ''; badScu = false; })}
    />
    <button
      class="sc-btn sc-btn--primary"
      type="submit"
      disabled={busy}
      data-failed={badSave ? '' : undefined}
      title={badSave && problem !== null ? problem : undefined}
      aria-describedby={badSave && reasonShown ? reasonId : undefined}
    >Записать</button>
  </div>
  {#if foreign && !reasonShown}
    <p class="foreign">{chosen?.code ?? 'Товар'} здесь по данным UEX не торгуется. Запишется как твоя цена{place ? ` на ${place}` : ' на этом терминале'}.</p>
  {/if}
  <!-- the words of a refusal: only while a field is marked; the screen reader gets the same sentence from the status below -->
  {#if reasonShown}<p class="reason" id={reasonId} aria-hidden="true">{problem}</p>{/if}

  <!-- for the screen reader only: the line has no room for a message, a mark and a tooltip say what went wrong -->
  <p class="sr-only" role="status" aria-live="polite">{status === null ? '' : `${chosen && status.kind === 'error' ? `${chosen.code}: ` : ''}${status.text}`}</p>
</form>

<style>
  .quick {
    position: relative;
    padding: 4px var(--sc-pad-x);
    border-bottom: 1px solid var(--sc-border);
  }

  .line {
    display: flex;
    align-items: center;
    gap: 4px;
    height: var(--sc-ctl-h);
  }

  /* a side the terminal does not trade the commodity on: it cannot be picked */
  .side.off {
    opacity: 0.35;
    cursor: default;
  }

  /* the commodity is none of this terminal's: one line that says where the price would be written */
  .foreign {
    margin: 3px 0 0;
    overflow: hidden;
    color: var(--sc-warn);
    font-size: var(--sc-font-sm);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .line > :global(.box) {
    flex: 1;
    min-width: 90px;
  }

  .in-price {
    flex: none;
    width: 66px;
  }

  .in-scu {
    flex: none;
    width: 48px;
  }

  .line > :global(.sc-btn) {
    flex: none;
  }

  .side {
    position: relative;
  }

  /* the radio covers its label: the keyboard and the mouse use the same control, which draws no mark of its own */
  .side input {
    position: absolute;
    inset: 0;
    margin: 0;
    opacity: 0;
    cursor: pointer;
  }

  .side:has(input:focus-visible) {
    outline: 1px solid var(--sc-accent);
    outline-offset: -1px;
  }

  /* why the entry was refused, in the colour of the red mark of the field; it is there only while a field is marked */
  .reason {
    margin: 0;
    padding-top: 2px;
    color: var(--sc-bad);
    font-size: var(--sc-font-sm);
    line-height: 14px;
  }

  /* read by the screen reader, takes no place on the screen */
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
</style>
