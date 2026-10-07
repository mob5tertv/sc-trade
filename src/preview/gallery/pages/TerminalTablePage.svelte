<script lang="ts">
  import { sideCounts } from '../../../ui/vm/terminal-rows';
  import { find, press, typeInto } from '../acts';
  import { useGallery } from '../context';
  import Frame from '../Frame.svelte';
  import TableDemo from '../TableDemo.svelte';

  const { data } = useGallery();
  const counts = sideCounts(data.rows);
  const idOf = (code: string): number => {
    const row = data.rows.find((r) => r.code === code);
    if (!row) throw new Error(`the table has no ${code}`);
    return row.commodityId;
  };
  // the same table without what is traded on the sell side: the sell tab of a terminal that buys nothing
  const noBuyers = data.rows.filter((r) => r.sell === null);

  async function badPrice(frame: HTMLElement): Promise<void> {
    const price = find<HTMLInputElement>(frame, '.in-price');
    await typeInto(price, '12x');
    await press(price, 'Enter');
  }
</script>

<Frame name="buy" caption="buy: what the player can buy here · {counts.buy} rows · own prices of every age, UEX, a typo (!) · triangles: MEDS, STIM, SCRA up (red), PFOO down (green), HYDR the same, the rest a first reading or UEX">
  <TableDemo rows={data.rows} side="buy" />
</Frame>
<Frame name="buy-expanded" caption="buy · MEDS expanded: fields, plaque, how the price moved (red up: bought dearer), was 380 · age, actions">
  <TableDemo rows={data.rows} side="buy" selected={idOf('MEDS')} />
</Frame>
<Frame name="buy-fell" caption="buy · PFOO expanded: the price fell (green down: bought cheaper), the text next to the plaque">
  <TableDemo rows={data.rows} side="buy" selected={idOf('PFOO')} />
</Frame>
<Frame name="buy-cold" caption="buy · ALUM expanded: my cold price kept next to UEX, range next to it">
  <TableDemo rows={data.rows} side="buy" selected={idOf('ALUM')} />
</Frame>
<Frame name="buy-long" caption="buy · SCRA expanded, the longest line there is: the warning first, the plaque, the five-digit price that moved (red up), the stock estimate with its base, the learned rate; the texts give way with an ellipsis">
  <TableDemo rows={data.rows} side="buy" selected={idOf('SCRA')} />
</Frame>
<Frame name="ranges" caption="«Мин–макс»: a spread (TUNG), one price as «= price» (MEDS; GOLD: the week is flat, the month moved; TITA: seven digits), nothing as «—» (STIM, BERY: UEX has no row) · beside my price: one price (AGRI), a spread (DIAM), nothing (STIM)">
  <TableDemo rows={data.ranges.rows} side="buy" />
</Frame>
<Frame name="sell" caption="sell: what the player can sell here · {counts.sell} rows · triangles: TUNG up (green), DIAM down (red), LARA the same, GOLD is UEX">
  <TableDemo rows={data.rows} side="sell" />
</Frame>
<Frame name="sell-expanded" caption="sell · TUNG expanded: the buyer's inventory, the price rose (green up: sold dearer), «Где купить» / «Продал»">
  <TableDemo rows={data.rows} side="sell" selected={idOf('TUNG')} />
</Frame>
<Frame name="sell-fell" caption="sell · DIAM expanded: the price fell (red down: sold cheaper)">
  <TableDemo rows={data.rows} side="sell" selected={idOf('DIAM')} />
</Frame>
<Frame name="bad-price" caption="buy · MEDS expanded, «12x» typed and Enter pressed: the price is marked" act={badPrice}>
  <TableDemo rows={data.rows} side="buy" selected={idOf('MEDS')} />
</Frame>
<Frame name="empty" caption="a terminal nothing is known about">
  <TableDemo rows={data.noRows} side="buy" />
</Frame>
<Frame name="empty-side" caption="sell tab of a terminal that buys nothing">
  <TableDemo rows={noBuyers} side="sell" />
</Frame>
