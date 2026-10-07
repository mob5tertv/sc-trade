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

<Frame name="buy" caption="buy: what the player can buy here · {counts.buy} rows · own prices of every age, UEX, a typo (!)">
  <TableDemo rows={data.rows} side="buy" />
</Frame>
<Frame name="buy-expanded" caption="buy · MEDS expanded: fields, plaque, was 380 · age, actions">
  <TableDemo rows={data.rows} side="buy" selected={idOf('MEDS')} />
</Frame>
<Frame name="buy-cold" caption="buy · ALUM expanded: my cold price kept next to UEX, range next to it">
  <TableDemo rows={data.rows} side="buy" selected={idOf('ALUM')} />
</Frame>
<Frame name="buy-typo" caption="buy · SCRA expanded: the typo warning">
  <TableDemo rows={data.rows} side="buy" selected={idOf('SCRA')} />
</Frame>
<Frame name="sell" caption="sell: what the player can sell here · {counts.sell} rows">
  <TableDemo rows={data.rows} side="sell" />
</Frame>
<Frame name="sell-expanded" caption="sell · TUNG expanded: the buyer's inventory, «Где купить» / «Продал»">
  <TableDemo rows={data.rows} side="sell" selected={idOf('TUNG')} />
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
