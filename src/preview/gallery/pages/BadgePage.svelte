<script lang="ts">
  import TempBadge from '../../../ui/components/TempBadge.svelte';
  import type { Cell } from '../../../ui/vm/terminal-rows';
  import { useGallery } from '../context';
  import Frame from '../Frame.svelte';

  const { data } = useGallery();
  // one real badge of every kind, from the table of the viewed terminal
  const cells = data.rows.flatMap((r) => [r.buy, r.sell]).filter((c): c is Cell => c !== null);
  const badges = (['hot', 'warm', 'cooling', 'cold', 'uex'] as const).map((kind) => cells.find((c) => c.badge?.kind === kind)?.badge).filter((b) => b !== null && b !== undefined);
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
</style>
