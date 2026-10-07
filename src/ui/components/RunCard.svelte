<script lang="ts">
  import { formatCompact, formatPct, formatUec } from '../../core/format';
  import type { RunTotals } from '../../core/run';
  import type { PhaseLine } from '../vm/run-phase';

  interface Props {
    cargo: Array<{ code: string; scu: number; avgBuyPrice: number }>;
    /** The three phases of the current leg and the whole time, for the line at the top. */
    phases: PhaseLine;
    totals: RunTotals;
    onDepart: () => void;
    onArrive: () => void;
    /** Called when the player pressed "Груз потерян". The owner asks the question (a line under the header of the window). */
    onLost: () => void;
  }
  let { cargo, phases, totals, onDepart, onArrive, onLost }: Props = $props();

  const NONE = '—';
  const MIN_RATE_SEC = 60;

  const roi = $derived(totals.roi === null ? NONE : formatPct(totals.roi));
  // the first minute of a run gives a rate of millions an hour that means nothing: it is shown from the first minute on
  const rate = $derived(totals.uecPerHour === null || totals.durationSec < MIN_RATE_SEC ? NONE : `${formatCompact(totals.uecPerHour)}/ч`);
</script>

<section class="card" aria-label="Текущий рейс">
  <div class="phases" role="group" aria-label="Фазы рейса">
    {#each phases.items as item (item.phase)}
      <span class="phase" class:running={item.state === 'running'} class:future={item.state === 'future'}>
        <span class="name">{item.name}</span> <span class="sc-num">{item.text}</span>
      </span>
    {/each}
    <span class="spacer"></span>
    <span class="total" title="Время с первой покупки">всего <span class="sc-num">{phases.total}</span></span>
  </div>

  <div class="top">
    <button type="button" class="sc-btn sc-btn--act" onclick={() => onDepart()}>Взлетел</button>
    <button type="button" class="sc-btn sc-btn--act" onclick={() => onArrive()}>Прилетел</button>
    <span class="spacer"></span>
    <button type="button" class="sc-btn sc-btn--act danger" onclick={() => onLost()}>Груз потерян</button>
  </div>

  {#if cargo.length === 0}
    <p class="empty">В трюме пусто</p>
  {:else}
    <ul class="cargo">
      {#each cargo as line}
        <li class="line">
          <span class="code">{line.code}</span>
          <span class="sc-num">{line.scu} SCU</span>
          <span class="muted sc-num" title="Средневзвешенная цена закупки">по {formatUec(line.avgBuyPrice)}</span>
        </li>
      {/each}
    </ul>
  {/if}

  <dl class="totals">
    <div><dt class="sc-label">Вложено</dt><dd class="sc-num">{formatUec(totals.invested)}</dd></div>
    <div><dt class="sc-label">Выручка</dt><dd class="sc-num">{formatUec(totals.revenue)}</dd></div>
    <div>
      <dt class="sc-label">Прибыль</dt>
      <dd class="sc-num" class:good={totals.profit > 0} class:loss={totals.profit < 0}>{formatUec(totals.profit)}</dd>
    </div>
    <div><dt class="sc-label">ROI</dt><dd class="sc-num">{roi}</dd></div>
    <div><dt class="sc-label">UEC/ч</dt><dd class="sc-num">{rate}</dd></div>
  </dl>
</section>

<style>
  .card {
    padding: 0 var(--sc-pad-x);
  }

  /* the phases of the leg on one line: the finished ones fixed, the running one in the accent, the ones to come as a dash */
  .phases {
    display: flex;
    align-items: center;
    gap: 10px;
    height: var(--sc-row-h);
    white-space: nowrap;
  }

  .phase {
    color: var(--sc-text);
  }

  .phase .name {
    color: var(--sc-label);
  }

  .phase.running,
  .phase.running .name {
    color: var(--sc-accent);
    font-weight: 600;
  }

  .phase.future,
  .phase.future .name {
    color: var(--sc-muted);
  }

  .total {
    color: var(--sc-muted);
  }

  .total .sc-num {
    color: var(--sc-text);
  }

  .top {
    display: flex;
    align-items: center;
    gap: 4px;
    height: calc(var(--sc-ctl-h) + 6px);
  }

  .spacer {
    flex: 1;
  }

  .cargo {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .line {
    display: grid;
    grid-template-columns: 52px 84px minmax(0, 1fr);
    align-items: center;
    gap: var(--sc-gap);
    height: var(--sc-row-h);
    border-top: 1px solid var(--sc-surface-2);
  }

  .code {
    font-weight: 600;
  }

  .line .sc-num {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .totals {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: var(--sc-gap);
    margin: 0;
    padding: 3px 0 4px;
    border-top: 1px solid var(--sc-border);
  }

  .totals div {
    min-width: 0;
  }

  dt {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  dd {
    margin: 0;
    overflow: hidden;
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .muted {
    color: var(--sc-muted);
    text-align: left;
  }

  .empty {
    margin: 0;
    height: var(--sc-row-h);
    color: var(--sc-muted);
    line-height: var(--sc-row-h);
  }

  .good {
    color: var(--sc-good);
  }

  .loss {
    color: var(--sc-bad);
  }

  .danger {
    border-color: var(--sc-bad);
    color: var(--sc-bad);
  }
</style>
