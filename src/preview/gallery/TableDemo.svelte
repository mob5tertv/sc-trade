<script lang="ts">
  import type { Side } from '../../core/types';
  import TerminalTable from '../../ui/components/TerminalTable.svelte';
  import type { RoiCell } from '../../ui/vm/row-roi';
  import type { TerminalRow } from '../../ui/vm/terminal-rows';

  // The table the way its owner drives it: one row is selected at a time, a click on it again takes it back.
  interface Props {
    rows: TerminalRow[];
    side: Side;
    selected?: number | null;
    roi?: ReadonlyMap<number, RoiCell>;
    pulse?: ReadonlySet<number>;
    noCapacity?: boolean;
  }
  let { rows, side, selected = null, roi, pulse, noCapacity }: Props = $props();

  let current = $derived(selected);
</script>

<TerminalTable
  {rows}
  {side}
  selectedCommodityId={current}
  scope="gallery"
  onSelect={(id) => (current = id)}
  onSavePrice={(e) => console.info('[gallery] save price', JSON.stringify(e))}
  onLookup={(e) => console.info('[gallery] lookup', JSON.stringify(e))}
  onTrade={(e) => console.info('[gallery] trade', JSON.stringify(e))}
  {roi}
  {pulse}
  {noCapacity}
/>
