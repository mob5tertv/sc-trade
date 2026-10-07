<script lang="ts">
  import type { RouteOption } from '../../../core/routes';
  import RouteList from '../../../ui/components/RouteList.svelte';
  import { lookupEmptyText } from '../../../ui/vm/lookup';
  import { find } from '../acts';
  import { click } from '../acts';
  import { useGallery } from '../context';
  import Frame from '../Frame.svelte';

  const { data } = useGallery();
  const { routes, reference, runCounts, viewedId, uexRange } = data;
  const request = { kind: 'from' as const, terminalId: viewedId, commodityId: null, price: null };
  // the target of the player: where the second trip of the list leads
  const target = routes.from[1]?.destId ?? null;
  const toTarget = routes.to[1]?.originId ?? null;
  const log = (option: RouteOption): void => console.info('[gallery] target', option.destId);

  async function openFirst(frame: HTMLElement): Promise<void> {
    await click(find(frame, '.row .line'));
  }
</script>

<Frame name="from" caption="from: «Куда» · sale price at the destination (green up MIC-L1: sold dearer; red down Port Tressler: sold cheaper; Lorville the same; UEX has no triangle), ROI by tier, UEC/ч (best in green) · the second trip is the target">
  <RouteList options={routes.from} {reference} {runCounts} mode="from" showCommodity={true} emptyText="" anchorTerminalId={viewedId} {uexRange} targetTerminalId={target} onTarget={log} />
</Frame>
<Frame name="nearby" caption="from + «и рядом»: a trip bought at another terminal of the planet shows both ends">
  <RouteList options={routes.nearby} {reference} {runCounts} mode="from" showCommodity={true} emptyText="" anchorTerminalId={viewedId} {uexRange} targetTerminalId={target} onTarget={log} />
</Frame>
<Frame name="to" caption="to: «Откуда» · purchase price at the origin (green down Everus Harbor: bought cheaper; red up ARC-L1: bought dearer; the rest UEX)">
  <RouteList options={routes.to} {reference} {runCounts} mode="to" showCommodity={true} emptyText="" anchorTerminalId={viewedId} {uexRange} targetTerminalId={toTarget} onTarget={log} />
</Frame>
<Frame name="one-commodity" caption="from, one commodity: no commodity code in the row">
  <RouteList options={routes.from.filter((o) => o.commodityId === routes.from[0].commodityId)} {reference} {runCounts} mode="from" showCommodity={false} emptyText="" anchorTerminalId={viewedId} {uexRange} targetTerminalId={null} onTarget={log} />
</Frame>
<Frame name="ladder" caption="the five ROI tiers: great ≥30%, good ≥15%, ok ≥5%, poor ≥0, loss">
  <RouteList options={routes.ladder} {reference} {runCounts} mode="from" showCommodity={true} emptyText="" anchorTerminalId={viewedId} {uexRange} targetTerminalId={null} onTarget={log} />
</Frame>
<Frame name="expanded" caption="the first trip expanded: volume, money, both prices with their plaques, time, «Цель»" act={openFirst}>
  <RouteList options={routes.nearby} {reference} {runCounts} mode="from" showCommodity={true} emptyText="" anchorTerminalId={viewedId} {uexRange} targetTerminalId={null} onTarget={log} />
</Frame>
<Frame name="expanded-target" caption="the target trip expanded: «Цель» is taken" act={async (frame) => {
  await click(find(frame, '.row.tier-great .line, .row .line'));
}}>
  <RouteList options={routes.ladder} {reference} {runCounts} mode="from" showCommodity={true} emptyText="" anchorTerminalId={viewedId} {uexRange} targetTerminalId={routes.ladder[0].destId} onTarget={log} />
</Frame>
<Frame name="empty" caption="nothing found: one muted row">
  <RouteList options={[]} {reference} {runCounts} mode="from" showCommodity={true} emptyText={lookupEmptyText(request, reference)} anchorTerminalId={viewedId} {uexRange} targetTerminalId={null} onTarget={log} />
</Frame>
