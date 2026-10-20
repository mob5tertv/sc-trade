<script lang="ts">
  import { parsePrice, parseScu } from '../../core/input';
  import type { StorageRow } from '../vm/storage';
  import { tr } from '../../i18n';

  // The tab «Склад» of the terminal (version 1.4, the author: «3-я вкладка — Купить / Продать / Склад, и работает так же, как со всеми»):
  // what the player left at the storage of this place, with what it cost. A row opens like a row of the market: «Куда везти» looks for
  // the best place to carry it to, «Погрузил» takes it into the hold, «Исправить» and «Списать» put a wrong line right. It cannot be
  // sold here: in the game it is only carried on.

  interface Props {
    rows: StorageRow[];
    /** The free space of the hold; `null` when the ship is not chosen. «Погрузил» offers the smaller of it and the line. */
    free: number | null;
    onLookup: (row: StorageRow) => void;
    /** Each returns the sentence to show at the row when it was not written, `null` when it was. */
    onLoad: (row: StorageRow, scu: number) => Promise<string | null>;
    onWriteOff: (row: StorageRow, scu: number) => Promise<string | null>;
    onFix: (row: StorageRow, scu: number, price: number) => Promise<string | null>;
  }
  let { rows, free, onLookup, onLoad, onWriteOff, onFix }: Props = $props();

  let openKey = $state<string | null>(null);
  /** What the opened row does besides «Погрузил»: nothing, the question of «Списать», or the fields of «Исправить». */
  let step = $state<'none' | 'off' | 'fix'>('none');
  let qtyText = $state('');
  let fixScuText = $state('');
  let fixPriceText = $state('');
  let error = $state<string | null>(null);
  let busy = $state(false);

  const offered = (row: StorageRow): number => (free === null ? row.scu : Math.max(0, Math.min(free, row.scu)));
  // the one-click load: as much as the hold takes (with no ship chosen, all of it)
  const loadable = offered;

  function toggle(row: StorageRow): void {
    if (openKey === row.key) {
      openKey = null;
      return;
    }
    openKey = row.key;
    step = 'none';
    error = null;
    qtyText = String(offered(row));
    fixScuText = String(row.scu);
    fixPriceText = String(Math.round(row.priceValue));
  }

  async function run(write: () => Promise<string | null>): Promise<void> {
    if (busy) return;
    busy = true;
    error = null;
    try {
      const failure = await write();
      if (failure === null) {
        openKey = null;
        step = 'none';
      } else error = failure;
    } finally {
      busy = false;
    }
  }

  function qty(): number | null {
    const n = parseScu(qtyText);
    return n === null || n === 0 ? null : n;
  }

  function load(row: StorageRow): void {
    const n = qty();
    if (n === null) {
      error = tr('Нужно целое число SCU от 1');
      return;
    }
    void run(() => onLoad(row, n));
  }

  function writeOff(row: StorageRow): void {
    const n = qty();
    if (n === null) {
      error = tr('Нужно целое число SCU от 1');
      return;
    }
    void run(() => onWriteOff(row, n));
  }

  function fix(row: StorageRow): void {
    const scu = parseScu(fixScuText);
    const price = parsePrice(fixPriceText);
    if (scu === null || price === null) {
      error = tr('Количество — целое от нуля, цена больше нуля');
      return;
    }
    void run(() => onFix(row, scu, price));
  }
</script>

{#if rows.length === 0}
  <p class="empty">{tr('Здесь у тебя ничего не лежит. Купи больше трюма — остаток ляжет сюда, на склад.')}</p>
{:else}
  <div class="table" role="table" aria-label={tr('Склад')}>
    <div class="grid head sc-label" role="row">
      <span role="columnheader">{tr('Товар')}</span>
      <span role="columnheader" class="r">SCU</span>
      <span role="columnheader" class="r" title={tr('Средняя цена закупки за SCU')}>{tr('Закупка')}</span>
      <span role="columnheader"></span>
    </div>
    {#each rows as row (row.key)}
      {@const opened = openKey === row.key}
      <div class="row" class:opened role="row">
        <div class="line">
          <button type="button" class="toggle" data-tour-storage={row.code} aria-expanded={opened} title={tr('Раскрыть: «Куда везти», своё число, «Списать», «Исправить»')} onclick={() => toggle(row)}>
            <span class="what" title={row.name}>
              <span class="code">{row.code}</span><span class="name">{row.name}</span>
              {#if row.otherTerminal !== null}<span class="other">· {row.otherTerminal}</span>{/if}
            </span>
            <span class="sc-num r strong">{row.scuText}</span>
            <span class="sc-num r">{row.price}</span>
          </button>
          <!-- version 1.4.1: the load is one click, always in sight (the author: «на складе нет кнопки погрузить»): as much as the hold takes -->
          <button
            type="button"
            class="sc-btn sc-btn--primary load"
            data-tour="storage-load-row"
            disabled={busy || loadable(row) === 0}
            title={loadable(row) === 0 ? tr('Трюм полон: места нет') : tr('Погрузил в трюм {n} SCU — сколько влезет; ошибся — «на склад» в карточке рейса', { n: loadable(row) })}
            onclick={() => void run(() => onLoad(row, loadable(row)))}
          >{tr('Погрузил {n}', { n: loadable(row) })}</button>
        </div>
        {#if opened}
          <div class="detail sc-reveal">
            <div class="facts">
              <span><span class="sc-label">{tr('Вложено')}</span> <span class="sc-num">{row.cost}</span></span>
              <span class="muted" title={tr('Сколько лежит на складе')}><span class="sc-label">{tr('Лежит')}</span> {row.age}</span>
              <span class="spacer"></span>
              <button type="button" class="sc-btn sc-btn--act" data-tour="storage-lookup" title={tr('Куда выгоднее отвезти этот груз: прибыль от цены закупки')} onclick={() => onLookup(row)}>{tr('Куда везти')}</button>
            </div>
            <div class="acts">
              <input
                class="sc-input sc-num qty"
                type="text"
                inputmode="numeric"
                autocomplete="off"
                data-select-on-focus
                aria-label={tr('Сколько SCU')}
                title={tr('Сколько SCU')}
                value={qtyText}
                oninput={(e) => { qtyText = e.currentTarget.value; error = null; }}
              />
              <span class="unit">SCU</span>
              <button type="button" class="sc-btn sc-btn--primary" data-tour="storage-load" disabled={busy} title={tr('Ты перегрузил это со склада в трюм: начнётся или продолжится рейс')} onclick={() => load(row)}>{tr('Погрузил')}</button>
              <span class="spacer"></span>
              {#if step === 'off'}
                <span class="ask">{tr('Списать?')}</span>
                <button type="button" class="sc-btn sc-btn--act sure" disabled={busy} onclick={() => writeOff(row)}>{tr('Да')}</button>
                <button type="button" class="sc-btn sc-btn--act" onclick={() => (step = 'none')}>{tr('Нет')}</button>
              {:else}
                <button type="button" class="sc-btn sc-btn--act" title={tr('Груза больше нет (пропал, вайп): его стоимость уйдёт убытком в сессию')} onclick={() => { step = 'off'; error = null; }}>{tr('Списать')}</button>
                <button type="button" class="sc-btn sc-btn--act" aria-pressed={step === 'fix'} title={tr('Поправить число или цену, если ввёл не то: деньги сессии не меняются')} onclick={() => { step = step === 'fix' ? 'none' : 'fix'; error = null; }}>{tr('Исправить')}</button>
              {/if}
            </div>
            {#if step === 'fix'}
              <div class="acts">
                <input class="sc-input sc-num qty" type="text" inputmode="numeric" autocomplete="off" data-select-on-focus aria-label={tr('Количество, SCU')} title={tr('Количество, SCU')} value={fixScuText} oninput={(e) => { fixScuText = e.currentTarget.value; error = null; }} />
                <span class="unit">SCU ×</span>
                <input class="sc-input sc-num price" type="text" inputmode="numeric" autocomplete="off" data-select-on-focus aria-label={tr('Цена закупки за SCU, UEC')} title={tr('Цена закупки за SCU, UEC')} value={fixPriceText} oninput={(e) => { fixPriceText = e.currentTarget.value; error = null; }} />
                <span class="unit">UEC</span>
                <span class="spacer"></span>
                <button type="button" class="sc-btn sc-btn--primary" disabled={busy} onclick={() => fix(row)}>{tr('Сохранить')}</button>
              </div>
            {/if}
            {#if error}<p class="bad" role="alert">{error}</p>{/if}
          </div>
        {/if}
      </div>
    {/each}
  </div>
{/if}

<style>
  .grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 48px 70px var(--load-w);
    column-gap: 4px;
    align-items: center;
    padding: 0 var(--sc-pad-x);
  }

  .table {
    --load-w: 96px;
  }

  /* a row: what lies there (a click opens it), and the load in one click */
  .line {
    display: grid;
    grid-template-columns: minmax(0, 1fr) var(--load-w);
    column-gap: 4px;
    align-items: center;
    height: var(--sc-row-h);
    padding: 0 var(--sc-pad-x);
    border-bottom: 1px solid var(--sc-surface-2);
  }

  .toggle {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 48px 70px;
    column-gap: 4px;
    align-items: center;
    height: 100%;
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .toggle > span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .load {
    height: 22px;
    padding: 0 6px;
    white-space: nowrap;
  }

  .head {
    height: 18px;
    border-bottom: 1px solid var(--sc-border);
    color: var(--sc-muted);
    white-space: nowrap;
  }

  .r {
    text-align: right;
  }

  .line:hover,
  .opened .line {
    background: var(--sc-surface-2);
  }

  .what {
    display: flex;
    gap: 6px;
    min-width: 0;
  }

  .code {
    flex: none;
    color: var(--sc-label);
    font-weight: 600;
  }

  .name,
  .other {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .other,
  .muted {
    color: var(--sc-muted);
  }

  .strong {
    font-weight: 600;
  }

  .detail {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 4px var(--sc-pad-x) 6px;
    border-bottom: 1px solid var(--sc-border);
    background: var(--sc-surface);
  }

  .facts,
  .acts {
    display: flex;
    align-items: center;
    gap: 4px;
    min-height: var(--sc-ctl-h);
  }

  .spacer {
    flex: 1;
  }

  .qty {
    flex: none;
    width: 48px;
  }

  .price {
    flex: none;
    width: 58px;
  }

  .unit {
    color: var(--sc-muted);
    font-size: var(--sc-font-sm);
  }

  .ask {
    color: var(--sc-bad);
  }

  .sure {
    border-color: var(--sc-bad);
    color: var(--sc-bad);
  }

  .bad {
    margin: 0;
    color: var(--sc-bad);
    font-size: var(--sc-font-sm);
  }

  .empty {
    margin: 0;
    padding: 4px var(--sc-pad-x);
    color: var(--sc-muted);
  }
</style>
