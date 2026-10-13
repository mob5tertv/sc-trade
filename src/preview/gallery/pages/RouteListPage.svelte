<script lang="ts">
  import type { RouteOption } from '../../../core/routes';
  import RouteList from '../../../ui/components/RouteList.svelte';
  import Section from '../../../ui/components/Section.svelte';
  import TargetGoodsView from '../../../ui/components/TargetGoodsView.svelte';
  import type { HoldSet, TargetGoodsRow } from '../../../ui/vm/target-goods';
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

  // «К цели» (spec 14.19, item 16), a mock-up: the goods HUR-L1 sells and ARC-L1 buys, and the set that fills a hold of 696 SCU.
  // The numbers are made up for the look; the real ones come from the search of trips.
  const own = (text: string) => ({ text, kind: 'hot' as const });
  const uex = (text: string) => ({ text, kind: 'uex' as const });
  const goods: TargetGoodsRow[] = [
    { key: 'meds', code: 'MEDS', name: 'Medical Supplies', buy: { price: '2 115', badge: own('моя · 4 мин') }, sell: { price: '2 721', badge: uex('UEX · 2 ч') }, roi: '29%', tier: 'good', take: '288', takeTitle: 'Весь запас станции: 288 SCU', unsure: false, profit: '174 528' },
    { key: 'stim', code: 'STIM', name: 'Stims', buy: { price: '2 810', badge: own('моя · 4 мин') }, sell: { price: '3 395', badge: own('моя · 1,5 ч') }, roi: '21%', tier: 'ok', take: '120', takeTitle: 'Весь запас станции: 120 SCU', unsure: false, profit: '70 200' },
    { key: 'agri', code: 'AGRI', name: 'Agricultural Supplies', buy: { price: '1 180', badge: uex('UEX · 5 ч') }, sell: { price: '1 340', badge: uex('UEX · 2 ч') }, roi: '14%', tier: 'ok', take: '288', takeTitle: 'Остаток трюма: 288 SCU. Запас станции неизвестен', unsure: true, profit: '46 080' },
    { key: 'wast', code: 'WAST', name: 'Waste', buy: { price: '12', badge: uex('UEX · 1 д') }, sell: { price: '13', badge: uex('UEX · 1 д') }, roi: '8%', tier: 'poor', take: '—', takeTitle: 'В набор не вошёл: трюм заполнен товарами выгоднее', unsure: false, profit: '—' },
  ];
  const full: HoldSet = { caption: 'Набор на 696 SCU', filled: '696 из 696 SCU', invested: '1 286 160', profit: '≈ 290 808', roi: '23%', note: null };
  const short: HoldSet = { caption: 'Набор на 696 SCU', filled: '408 из 696 SCU', invested: '946 320', profit: '≈ 244 728', roi: '26%', note: 'Запаса на станции хватает на 408 из 696 SCU' };
  let pair = $state(true);

  // the same trips with no stock known at the purchase terminal for the first and the third: the volume was counted without it
  const noStock = (o: RouteOption): RouteOption => ({ ...o, buy: { ...o.buy, scu: null, scuOrigin: null, stock: null } });
  const unsure = routes.from.map((o, i) => (i === 0 || i === 2 ? noStock(o) : o));

  async function openFirst(frame: HTMLElement): Promise<void> {
    await click(find(frame, '.row .line'));
  }

  // the trip of AGRI: the sale price is mine, with the one price of UEX beside it
  async function openAgri(frame: HTMLElement): Promise<void> {
    const line = [...frame.querySelectorAll<HTMLElement>('.row .line')].find((el) => (el.textContent ?? '').includes('AGRI'));
    if (line === undefined) throw new Error('the list has no trip of AGRI');
    await click(line);
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
<Frame name="unknown-stock" caption="the first and the third trip rest on a stock nobody knows: «?» at the end of the names (it moves no number), the tooltip says why · the second trip has a known stock and no mark">
  <RouteList options={unsure} {reference} {runCounts} mode="from" showCommodity={true} emptyText="" anchorTerminalId={viewedId} {uexRange} targetTerminalId={target} onTarget={log} />
</Frame>
<Frame name="unknown-stock-narrow" width={380} caption="the same in the narrowest window (380 px): the names give way, the numbers stay where they are">
  <RouteList options={unsure} {reference} {runCounts} mode="from" showCommodity={true} emptyText="" anchorTerminalId={viewedId} {uexRange} targetTerminalId={target} onTarget={log} />
</Frame>
<Frame name="unknown-stock-expanded" caption="the first trip expanded: the line under the volume says it in words" act={openFirst}>
  <RouteList options={unsure} {reference} {runCounts} mode="from" showCommodity={true} emptyText="" anchorTerminalId={viewedId} {uexRange} targetTerminalId={null} onTarget={log} />
</Frame>
<Frame name="ranges" caption="«Мин–макс» of the sale price: one price «= price» (MEDS, GOLD; TITA: seven digits), a spread (TUNG), beside my price: one price (AGRI), a spread (DIAM), nothing «—» (STIM; QUAR: UEX has the price, no bounds)">
  <RouteList options={data.ranges.trips} {reference} {runCounts} mode="from" showCommodity={true} emptyText="" anchorTerminalId={viewedId} uexRange={data.ranges.uexRange} targetTerminalId={null} onTarget={log} />
</Frame>
<Frame name="ranges-expanded" caption="the trip of AGRI expanded: both prices, the sale price of mine with the one price of UEX beside it" act={openAgri}>
  <RouteList options={data.ranges.trips} {reference} {runCounts} mode="from" showCommodity={true} emptyText="" anchorTerminalId={viewedId} uexRange={data.ranges.uexRange} targetTerminalId={null} onTarget={log} />
</Frame>
<Frame name="to-target" caption="1.2 mock-up · «К цели»: the switch in the header appears while a target is set; the list is every commodity the viewed terminal sells and the target buys, with how much of each the set takes; the set that fills the hold stands on top">
  <Section title="Варианты" summary="HUR-L1 → ARC-L1" open={true} onToggle={() => {}} onClose={() => {}}>
    {#snippet actions()}
      <div class="sc-seg" role="group" aria-label="Куда везти">
        <button type="button" aria-pressed={!pair} onclick={() => (pair = false)}>Куда угодно</button>
        <button type="button" aria-pressed={pair} onclick={() => (pair = true)}>К цели</button>
      </div>
    {/snippet}
    <TargetGoodsView rows={goods} set={full} emptyText="" />
  </Section>
</Frame>
<Frame name="to-target-short" caption="1.2 mock-up · the stock of the station does not fill the hold: the line under the set says so; the commodity whose stock nobody knows is left out here">
  <Section title="Варианты" summary="HUR-L1 → ARC-L1" open={true} onToggle={() => {}} onClose={() => {}}>
    {#snippet actions()}
      <div class="sc-seg" role="group" aria-label="Куда везти">
        <button type="button" aria-pressed="false">Куда угодно</button>
        <button type="button" aria-pressed="true">К цели</button>
      </div>
    {/snippet}
    <TargetGoodsView rows={goods.filter((g) => !g.unsure).map((g) => (g.key === 'wast' ? { ...g, takeTitle: 'В набор не вошёл: прибыль меньше порога' } : g))} set={short} emptyText="" />
  </Section>
</Frame>
<Frame name="to-target-empty" caption="1.2 mock-up · the two terminals have no commodity in common">
  <Section title="Варианты" summary="HUR-L1 → ARC-L1" open={true} onToggle={() => {}} onClose={() => {}}>
    <TargetGoodsView rows={[]} set={null} emptyText="HUR-L1 не продаёт ничего, что покупает ARC-L1" />
  </Section>
</Frame>
<Frame name="empty" caption="nothing found: one muted row">
  <RouteList options={[]} {reference} {runCounts} mode="from" showCommodity={true} emptyText={lookupEmptyText(request, reference)} anchorTerminalId={viewedId} {uexRange} targetTerminalId={null} onTarget={log} />
</Frame>
