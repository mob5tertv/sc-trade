<script lang="ts">
  import { formatUec } from '../../core/format';
  import { approxTitle, LEGEND } from '../vm/legend';
  import type { PhaseLine } from '../vm/run-phase';
  import type { RunOutlook } from '../vm/run-outlook';

  interface Props {
    cargo: Array<{ code: string; scu: number; avgBuyPrice: number }>;
    /** The three phases of the current leg and the whole time, for the line at the top. */
    phases: PhaseLine;
    /** The money: what is put in and sold (facts), and the EXPECTED result of the whole run. A run that goes on is not a loss. */
    outlook: RunOutlook;
    /** The marks of the body: the ones the header of the section does not offer (`cardMarks`). */
    marks: Array<'depart' | 'arrive'>;
    onMark: (type: 'depart' | 'arrive') => void;
    /** Called when the player pressed "Груз потерян". The owner asks the question (a line under the header of the window). */
    onLost: () => void;
  }
  let { cargo, phases, outlook, marks, onMark, onLost }: Props = $props();

  const NONE = '—';
  const MARK_LABEL = { depart: 'Взлетел', arrive: 'Прилетел' } as const;
  const expected = $derived(outlook.expected);
  const dashTitle = $derived(outlook.why ?? undefined);
</script>

{#snippet lost()}
  <button type="button" class="sc-btn sc-btn--act danger" onclick={() => onLost()}>Груз потерян</button>
{/snippet}

<section class="card" aria-label="Текущий рейс">
  <div class="phases" role="group" aria-label="Фазы рейса">
    {#each phases.items as item (item.phase)}
      <span class="phase" class:running={item.state === 'running'} class:future={item.state === 'future'}>
        <span class="name">{item.name}</span> <span class="sc-num">{item.text}</span>
      </span>
    {/each}
    <span class="spacer"></span>
    <span class="total" title="Время с первой покупки">всего <span class="sc-num">{phases.total}</span></span>
    {#if marks.length === 0}
      <!-- nothing else to press: the button of the lost cargo takes the end of this line, no line of its own -->
      {@render lost()}
    {/if}
  </div>

  {#if marks.length > 0}
    <div class="top">
      {#each marks as type (type)}
        <button type="button" class="sc-btn sc-btn--act" onclick={() => onMark(type)}>{MARK_LABEL[type]}</button>
      {/each}
      <span class="spacer"></span>
      {@render lost()}
    </div>
  {/if}

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
    <div><dt class="sc-label" title="Всё, что куплено">Вложено</dt><dd class="sc-num">{outlook.invested}</dd></div>
    <div><dt class="sc-label" title="Всё, что уже продано">Выручка</dt><dd class="sc-num">{outlook.revenue}</dd></div>
    <div>
      <dt class="sc-label" title="Ожидаемая прибыль всего рейса: уже проданное плюс то, что в трюме, по ожидаемой цене в точке цели, минус вложенное">Прибыль</dt>
      <dd class="sc-num" class:loss={expected?.profitLoss} title={approxTitle(expected?.profit ?? NONE, LEGEND.approxRun, dashTitle)}>{expected?.profit ?? NONE}</dd>
    </div>
    <div>
      <dt class="sc-label" title="Ожидаемое отношение прибыли ко вложенному">ROI</dt>
      <dd class="sc-num" title={approxTitle(expected?.roi ?? NONE, LEGEND.approxRun, dashTitle)}>{expected?.roi ?? NONE}</dd>
    </div>
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
    height: calc(var(--sc-ctl-h) + 4px);
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
    grid-template-columns: repeat(4, minmax(0, 1fr));
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

  .loss {
    color: var(--sc-bad);
  }

  .danger {
    border-color: var(--sc-bad);
    color: var(--sc-bad);
  }
</style>
