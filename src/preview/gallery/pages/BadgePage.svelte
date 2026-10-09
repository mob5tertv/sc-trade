<script lang="ts">
  import TempBadge from '../../../ui/components/TempBadge.svelte';
  import TrendMark from '../../../ui/components/TrendMark.svelte';
  import type { PriceTrend } from '../../../ui/vm/price-trend';
  import type { Cell } from '../../../ui/vm/terminal-rows';
  import { useGallery } from '../context';
  import Frame from '../Frame.svelte';

  const { data } = useGallery();
  // one real badge of every kind, from the table of the viewed terminal
  const cells = data.rows.flatMap((r) => [r.buy, r.sell]).filter((c): c is Cell => c !== null);
  const badges = (['hot', 'warm', 'cooling', 'cold', 'uex'] as const).map((kind) => cells.find((c) => c.badge?.kind === kind)?.badge).filter((b) => b !== null && b !== undefined);
  // the triangle of a price that moved, in each of its four looks
  const trends: Array<{ label: string; trend: PriceTrend }> = [
    { label: 'rose, good for you (a sale price)', trend: { dir: 'up', good: true, title: 'было 2 300 · 2 ч назад (+50)' } },
    { label: 'fell, good for you (a purchase price)', trend: { dir: 'down', good: true, title: 'было 2 300 · 2 ч назад (-50)' } },
    { label: 'rose, against you (a purchase price)', trend: { dir: 'up', good: false, title: 'было 2 300 · 2 ч назад (+50)' } },
    { label: 'fell, against you (a sale price)', trend: { dir: 'down', good: false, title: 'было 2 300 · 2 ч назад (-50)' } },
  ];
</script>

<Frame name="marks" caption="compact: a 6 px square in the colour of the freshness; UEX is an empty frame; the text is in the title">
  <div class="list">
    {#each badges as badge (badge.kind)}
      <div class="line"><TempBadge compact text={badge.text} kind={badge.kind} /><span class="text">{badge.text}</span></div>
    {/each}
  </div>
</Frame>
<Frame name="plaques" caption="full plaques, for the expanded rows">
  <div class="list">
    {#each badges as badge (badge.kind)}
      <div class="line"><TempBadge text={badge.text} kind={badge.kind} /></div>
    {/each}
  </div>
</Frame>
<Frame name="trends" caption="the triangle of a price that moved: green when it is good for you, crimson when it is against you; the hot square and the red of a refusal stand beside it">
  <div class="list">
    {#each trends as { label, trend } (label)}
      <div class="line"><TrendMark {trend} /><span class="text">{label}</span></div>
    {/each}
    <div class="line"><TempBadge compact text="горячая" kind="hot" /><span class="text">the square of a hot price</span></div>
    <div class="line"><span class="refusal">Отказ записи</span><span class="text">the red of a refusal</span></div>
  </div>
</Frame>

<style>
  .list {
    padding: 4px var(--sc-pad-x);
  }

  .line {
    display: flex;
    align-items: center;
    gap: 8px;
    height: var(--sc-row-h);
  }

  .text {
    color: var(--sc-muted);
  }

  .refusal {
    color: var(--sc-bad);
  }
</style>
