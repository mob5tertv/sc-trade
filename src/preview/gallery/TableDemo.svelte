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

  // What the table told its owner, for the console and for `--do "eval:window.__tableEvents"`: a save is one line, a refusal another.
  const events = ((window as unknown as { __tableEvents?: string[] }).__tableEvents ??= []);
  function say(what: string, e: unknown): void {
    events.push(`${what} ${JSON.stringify(e)}`);
    console.info('[gallery]', what, JSON.stringify(e));
  }
</script>

<TerminalTable
  {rows}
  {side}
  selectedCommodityId={current}
  scope="gallery"
  onSelect={(id) => (current = id)}
  onSavePrice={(e) => say('save price', e)}
  onReject={(e) => say('reject price', e)}
  onLookup={(e) => console.info('[gallery] lookup', JSON.stringify(e))}
  onTrade={(e) => console.info('[gallery] trade', JSON.stringify(e))}
  {roi}
  {pulse}
  {noCapacity}
/>
