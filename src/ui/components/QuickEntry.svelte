<script lang="ts">
  import { formatUec } from '../../core/format';
  import type { Searchable } from '../../core/search';
  import type { Side } from '../../core/types';
  import { resolveQuickEntry } from '../vm/quick-entry';
  import SearchBox from './SearchBox.svelte';

  interface PriceEntry { terminalId: number; commodityId: number; side: Side; price: number; scu: number | null }
  type Rejection = 'no-terminal' | 'no-commodity' | 'bad-price' | 'bad-scu';

  interface Props {
    /** The viewed terminal: the price is written for it. */
    terminalId: number | null;
    /** Its name; the location field shows it as the ghost of a value until another terminal is picked. */
    terminalName: string | null;
    terminalItems: Searchable[];
    commodityItems: Searchable[];
    /** What the viewed terminal trades: those commodities come first in the search. */
    boostIds: Set<number>;
    /** The side a commodity starts with at the viewed terminal. */
    sideFor: (commodityId: number) => Side;
    /** Another terminal was picked: it becomes the viewed one. */
    onPickTerminal: (terminalId: number) => void;
    /** Writes the price; answers the sentence to show when it was not saved, `null` when it was. */
    onSave: (entry: PriceEntry) => Promise<string | null>;
    /** Enter was pressed with something missing or unreadable (nothing was saved). */
    onReject?: (e: { reason: Rejection; price: string; scu: string }) => void;
  }
  let { terminalId, terminalName, terminalItems, commodityItems, boostIds, sideFor, onPickTerminal, onSave, onReject }: Props = $props();

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

  let locationBox = $state<ReturnType<typeof SearchBox>>();
  let commodityBox = $state<ReturnType<typeof SearchBox>>();
  let priceInput = $state<HTMLInputElement>();
  let scuInput = $state<HTMLInputElement>();

  const chosen = $derived(commodityId === null ? undefined : commodityItems.find((c) => c.id === commodityId));
  const side = $derived<Side>(pickedSide ?? (commodityId === null ? 'buy' : sideFor(commodityId)));

  /** Puts the cursor into the commodity field: where a new entry starts. */
  export function focus(): void {
    commodityBox?.focus();
  }

  function pickTerminal(id: number): void {
    onPickTerminal(id);
    commodityBox?.focus();
  }

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
      locationBox?.focus();
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

    busy = true;
    let failure: string | null;
    try {
      failure = await onSave({ terminalId, commodityId, side, price: input.price, scu: input.scu });
    } catch {
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
      text: `Записано: ${chosen?.code ?? `#${commodityId}`} · ${side === 'buy' ? 'покупка' : 'продажа'} ${formatUec(input.price)}`,
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
  <SearchBox
    bind:this={locationBox}
    items={terminalItems}
    placeholder={terminalName ?? 'Локация: три буквы и Enter'}
    label="Локация, для которой записывается цена"
    onPick={pickTerminal}
  />

  <div class="line">
    <SearchBox
      bind:this={commodityBox}
      items={commodityItems}
      {boostIds}
      placeholder="Товар: три буквы и Enter"
      label="Товар"
      onPick={pickCommodity}
    />
    <div class="sides" role="radiogroup" aria-label="Сторона">
      <label class="side" title="Цена, по которой здесь можно купить">
        <input type="radio" name={groupName} checked={side === 'buy'} onchange={() => (pickedSide = 'buy')} />
        <span>Купить</span>
      </label>
      <label class="side" title="Цена, по которой здесь можно продать">
        <input type="radio" name={groupName} checked={side === 'sell'} onchange={() => (pickedSide = 'sell')} />
        <span>Продать</span>
      </label>
    </div>
  </div>

  <div class="line numbers">
    <input
      bind:this={priceInput}
      bind:value={priceText}
      class="sc-input sc-num"
      type="text"
      inputmode="numeric"
      autocomplete="off"
      placeholder="Цена, UEC за SCU"
      aria-label="Цена, UEC за SCU"
      aria-invalid={badPrice ? 'true' : undefined}
      oninput={() => (badPrice = false)}
      onkeydown={(event) => onFieldKeydown(event, priceText, () => { priceText = ''; badPrice = false; })}
    />
    <input
      bind:this={scuInput}
      bind:value={scuText}
      class="sc-input sc-num"
      type="text"
      inputmode="numeric"
      autocomplete="off"
      placeholder="SCU, если видно"
      aria-label="Количество, SCU (можно не вводить)"
      aria-invalid={badScu ? 'true' : undefined}
      oninput={() => (badScu = false)}
      onkeydown={(event) => onFieldKeydown(event, scuText, () => { scuText = ''; badScu = false; })}
    />
    <button class="sc-btn" type="submit" disabled={busy}>Записать</button>
  </div>

  <p class="status" class:error={status?.kind === 'error'} role="status" aria-live="polite">
    {#if status !== null}
      {#if chosen && status.kind === 'error'}<span><span class="code">{chosen.code}</span> ·</span> {/if}{status.text}
    {:else if chosen}
      <span class="code">{chosen.code}</span> {chosen.name}
    {:else}
      <span class="muted">Товар → цена → SCU → Enter. Любую локацию можно выбрать выше.</span>
    {/if}
  </p>
</form>

<style>
  .quick {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: var(--sc-gap) calc(var(--sc-gap) * 1.5);
    border-bottom: 1px solid var(--sc-border);
  }

  .line {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--sc-gap);
  }

  .line.numbers {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
  }

  .sides {
    display: flex;
    height: 28px;
    overflow: hidden;
    border: 1px solid var(--sc-border);
    border-radius: var(--sc-radius);
  }

  .side {
    position: relative;
    display: flex;
    align-items: center;
    padding: 0 10px;
    color: var(--sc-muted);
    cursor: pointer;
  }

  /* the radio covers its label: the keyboard and the mouse use the same control, which draws no mark of its own */
  .side input {
    position: absolute;
    inset: 0;
    margin: 0;
    opacity: 0;
    cursor: pointer;
  }

  .side:has(input:checked) {
    background: var(--sc-surface-2);
    color: var(--sc-text);
  }

  .side:has(input:focus-visible) {
    outline: 2px solid var(--sc-accent);
    outline-offset: -2px;
  }

  .status {
    min-height: 18px;
    margin: 0;
    overflow: hidden;
    font-size: var(--sc-font-sm);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .status.error {
    color: var(--sc-bad);
  }

  .code {
    font-family: var(--sc-mono);
    font-weight: 600;
  }

  .muted {
    color: var(--sc-muted);
  }
</style>
