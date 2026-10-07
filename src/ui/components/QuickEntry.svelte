<script lang="ts">
  import { formatUec } from '../../core/format';
  import type { Searchable } from '../../core/search';
  import type { Side } from '../../core/types';
  import { resolveQuickEntry } from '../vm/quick-entry';
  import SearchBox from './SearchBox.svelte';

  interface PriceEntry { terminalId: number; commodityId: number; side: Side; price: number; scu: number | null }
  type Rejection = 'no-terminal' | 'no-commodity' | 'bad-price' | 'bad-scu';

  interface Props {
    /** The viewed terminal: the price is written for it. The location is picked in the header of the window, not here. */
    terminalId: number | null;
    commodityItems: Searchable[];
    /** What the viewed terminal trades: those commodities come first in the search. */
    boostIds: Set<number>;
    /** The side a commodity starts with at the viewed terminal. */
    sideFor: (commodityId: number) => Side;
    /** Writes the price; answers the sentence to show when it was not saved, `null` when it was. */
    onSave: (entry: PriceEntry) => Promise<string | null>;
    /** Enter was pressed with something missing or unreadable (nothing was saved). */
    onReject?: (e: { reason: Rejection; price: string; scu: string }) => void;
    /** `onSave` threw instead of answering: the player sees a short sentence, the details belong in the log. */
    onFailure?: (err: unknown, entry: PriceEntry) => void;
  }
  let { terminalId, commodityItems, boostIds, sideFor, onSave, onReject, onFailure }: Props = $props();

  const uid = $props.id();
  const groupName = `side-${uid}`;

  let commodityId = $state<number | null>(null);
  /** The side the player picked by hand; `null` while the side follows what the terminal trades. */
  let pickedSide = $state<Side | null>(null);
  let priceText = $state('');
  let scuText = $state('');
  let badPrice = $state(false);
  let badScu = $state(false);
  let busy = $state(false);
  let status = $state<{ text: string; kind: 'ok' | 'error' } | null>(null);

  let commodityBox = $state<ReturnType<typeof SearchBox>>();
  let priceInput = $state<HTMLInputElement>();
  let scuInput = $state<HTMLInputElement>();

  const chosen = $derived(commodityId === null ? undefined : commodityItems.find((c) => c.id === commodityId));
  const side = $derived<Side>(pickedSide ?? (commodityId === null ? 'buy' : sideFor(commodityId)));

  // Enter in the commodity field takes the first match, and the player goes on with the price.
  function pickCommodity(id: number): void {
    commodityId = id;
    pickedSide = null;
    status = null;
    priceInput?.focus();
  }

  function reject(reason: Rejection, text: string): void {
    status = { text, kind: 'error' };
    onReject?.({ reason, price: priceText, scu: scuText });
  }

  async function save(): Promise<void> {
    if (busy) return;
    // Enter on an empty line is not an entry
    if (commodityId === null && priceText.trim() === '' && scuText.trim() === '') return;
    if (terminalId === null) {
      reject('no-terminal', 'Сначала выбери локацию.');
      return;
    }
    if (commodityId === null) {
      reject('no-commodity', 'Выбери товар: три буквы кода или названия и Enter.');
      commodityBox?.focus();
      return;
    }
    const input = resolveQuickEntry(priceText, scuText);
    if (!input.ok) {
      badPrice = input.price;
      badScu = input.scu;
      if (input.price) {
        reject('bad-price', 'Цена — целое число больше нуля.');
        priceInput?.focus();
      } else {
        reject('bad-scu', 'Количество — целое число SCU или пустое поле.');
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

  // Esc takes back what was typed into the field; with nothing typed it goes on and closes the panel.
  function onFieldKeydown(event: KeyboardEvent, text: string, clear: () => void): void {
    if (event.key !== 'Escape' || text === '') return;
    event.preventDefault();
    event.stopPropagation();
    clear();
  }
</script>

<form
  class="quick"
  aria-label="Быстрый ввод цены"
  onsubmit={(event) => {
    event.preventDefault();
    void save();
  }}
>
  <div class="line">
    <SearchBox
      bind:this={commodityBox}
      items={commodityItems}
      {boostIds}
      placeholder="Товар"
      label="Товар: три буквы кода или названия и Enter"
      value={chosen ? `${chosen.code} ${chosen.name}` : undefined}
      onPick={pickCommodity}
    />
    <div class="sc-seg" role="radiogroup" aria-label="Сторона">
      <label class="side" class:is-on={side === 'buy'} title="Цена, по которой здесь можно купить">
        <input type="radio" name={groupName} checked={side === 'buy'} onchange={() => (pickedSide = 'buy')} />
        <span>Куп.</span>
      </label>
      <label class="side" class:is-on={side === 'sell'} title="Цена, по которой здесь можно продать">
        <input type="radio" name={groupName} checked={side === 'sell'} onchange={() => (pickedSide = 'sell')} />
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
      placeholder="Цена"
      title="Цена, UEC за SCU"
      aria-label="Цена, UEC за SCU"
      aria-invalid={badPrice ? 'true' : undefined}
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
      placeholder="SCU"
      title="Количество, SCU (можно не вводить)"
      aria-label="Количество, SCU (можно не вводить)"
      aria-invalid={badScu ? 'true' : undefined}
      oninput={() => (badScu = false)}
      onkeydown={(event) => onFieldKeydown(event, scuText, () => { scuText = ''; badScu = false; })}
    />
    <button class="sc-btn sc-btn--primary" type="submit" disabled={busy}>Записать</button>
  </div>

  {#if status !== null}
    <p class="status" class:error={status.kind === 'error'} role="status" aria-live="polite" title={status.text}>
      {#if chosen && status.kind === 'error'}<span class="code">{chosen.code}</span> · {/if}{status.text}
    </p>
  {/if}
</form>

<style>
  .quick {
    padding: 4px var(--sc-pad-x);
    border-bottom: 1px solid var(--sc-border);
  }

  .line {
    display: flex;
    align-items: center;
    gap: 4px;
    height: var(--sc-ctl-h);
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

  .status {
    height: var(--sc-row-h);
    margin: 0;
    overflow: hidden;
    color: var(--sc-muted);
    font-size: var(--sc-font-sm);
    line-height: var(--sc-row-h);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .status.error {
    color: var(--sc-bad);
  }

  .code {
    font-weight: 600;
  }
</style>
