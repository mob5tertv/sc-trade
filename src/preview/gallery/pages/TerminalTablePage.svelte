<script lang="ts">
  import type { TerminalRow } from '../../../ui/vm/terminal-rows';
  import { roiCells } from '../../../ui/vm/row-roi';
  import type { RowRoi } from '../../../ui/vm/row-roi';
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

  // the best ROI of the rows, in the words of the table, at the threshold of the settings
  const threshold = data.settings.roiHighlightPct;
  const hereBuy = roiCells(data.roi.here.buy, 'buy', data.reference, threshold);
  const hereSell = roiCells(data.roi.here.sell, 'sell', data.reference, threshold);
  const lorville = data.roi.lorville;
  const lorvilleSell = roiCells(lorville.sell, 'sell', data.reference, threshold);
  const lorvilleBuy = roiCells(lorville.buy, 'buy', data.reference, threshold);
  // the same rows with the bar at every row that pays, whatever it pays: how each tier looks as a bar
  const lorvilleSellAll = roiCells(lorville.sell, 'sell', data.reference, 0);
  const lorvilleId = (code: string): number => {
    const row = lorville.rows.find((r) => r.code === code);
    if (!row) throw new Error(`the table of Lorville has no ${code}`);
    return row.commodityId;
  };

  // The widest things a row can say, made up to measure the columns: the longest names of the commodities, a seven-digit
  // price, a ROI of thousands of percent (written 999+), a five-digit one-price range. Rows of the real table of Levski
  // (`from` is the code of the row it is made of), renamed.
  const LONG: ReadonlyArray<{ from: string; code: string; name: string; roi: number }> = [
    { from: 'TITA', code: 'RMC', name: 'Recycled Material Composite', roi: 16.99 },
    { from: 'GOLD', code: 'AGRS', name: 'Agricultural Supplies', roi: 9.9 },
    { from: 'DIAM', code: 'HEPH', name: 'Hephaestanite', roi: 0.62 },
    { from: 'TUNG', code: 'DIST', name: 'Distilled Spirits', roi: 0.1 },
  ];
  const longRows: TerminalRow[] = LONG.map((long) => {
    const row = data.ranges.rows.find((r) => r.code === long.from);
    if (!row) throw new Error(`the table of ranges has no ${long.from}`);
    return { ...row, code: long.code, name: long.name };
  });
  const longRoi = new Map<number, RowRoi>(longRows.map((row, i) => [
    row.commodityId, { commodityId: row.commodityId, roi: LONG[i].roi, otherId: 3, buyPrice: 1995, sellPrice: 2760 },
  ]));
  const longCells = roiCells(longRoi, 'buy', data.reference, threshold);

  async function badPrice(frame: HTMLElement): Promise<void> {
    const price = find<HTMLInputElement>(frame, '.in-price');
    await typeInto(price, '12x');
    await press(price, 'Enter');
  }
</script>

<Frame name="buy" caption="buy: what the player can buy here · {counts.buy} rows · own prices of every age, UEX, a typo (!) · triangles: MEDS, STIM, SCRA up (red), PFOO down (green), HYDR the same, the rest a first reading or UEX · the last column is the best ROI of a trip from here">
  <TableDemo rows={data.rows} side="buy" roi={hereBuy} />
</Frame>
<Frame name="buy-expanded" caption="buy · MEDS expanded: fields, plaque, how the price moved (red up: bought dearer), was 380 · age, actions">
  <TableDemo rows={data.rows} side="buy" selected={idOf('MEDS')} roi={hereBuy} />
</Frame>
<Frame name="buy-fell" caption="buy · PFOO expanded: the price fell (green down: bought cheaper), the text next to the plaque">
  <TableDemo rows={data.rows} side="buy" selected={idOf('PFOO')} roi={hereBuy} />
</Frame>
<Frame name="buy-cold" caption="buy · ALUM expanded: my cold price kept next to UEX, range next to it">
  <TableDemo rows={data.rows} side="buy" selected={idOf('ALUM')} roi={hereBuy} />
</Frame>
<Frame name="buy-long" caption="buy · SCRA expanded, the longest line there is: the warning first, the plaque, the five-digit price that moved (red up), the stock estimate with its base, the learned rate; the texts give way with an ellipsis">
  <TableDemo rows={data.rows} side="buy" selected={idOf('SCRA')} roi={hereBuy} />
</Frame>
<Frame name="ranges" caption="«Мин–макс»: a spread (TUNG), one price as «= price» (MEDS; GOLD: the week is flat, the month moved; TITA: seven digits), nothing as «—» (STIM, BERY: UEX has no row; QUAR: UEX has the price but no bounds, another tooltip) · beside my price: one price (AGRI), a spread (DIAM), nothing (STIM)">
  <TableDemo rows={data.ranges.rows} side="buy" />
</Frame>
<Frame name="sell" caption="sell: what the player can sell here · {counts.sell} rows · triangles: TUNG up (green), DIAM down (red), LARA the same, GOLD is UEX · the last column is the best ROI of bringing the commodity here">
  <TableDemo rows={data.rows} side="sell" roi={hereSell} />
</Frame>
<Frame name="sell-expanded" caption="sell · TUNG expanded: the buyer's inventory, the price rose (green up: sold dearer), «Где купить» / «Продал»">
  <TableDemo rows={data.rows} side="sell" selected={idOf('TUNG')} roi={hereSell} />
</Frame>
<Frame name="sell-fell" caption="sell · DIAM expanded: the price fell (red down: sold cheaper)">
  <TableDemo rows={data.rows} side="sell" selected={idOf('DIAM')} roi={hereSell} />
</Frame>
<Frame name="roi-sell" caption="Lorville, sell · the player typed what it pays · ROI of every tier (green ≥ 30, lime ≥ 15, amber ≥ 5, grey) · a bar from {threshold} % (DIAM, GOLD, MEDS, STIM) · PFOO and TUNG are great but below the bar · QUAR and BERY: no trip pays, the cell is empty">
  <TableDemo rows={lorville.rows} side="sell" roi={lorvilleSell} />
</Frame>
<Frame name="roi-sell-expanded" caption="Lorville, sell · STIM expanded: the bar and the ROI stay on the row, the fields and the actions open under it">
  <TableDemo rows={lorville.rows} side="sell" selected={lorvilleId('STIM')} roi={lorvilleSell} />
</Frame>
<Frame name="roi-sell-all" caption="Lorville, sell · threshold 0: every row that pays has a bar, the colour of its tier (the setting «Выделять ROI от, %» = 0)">
  <TableDemo rows={lorville.rows} side="sell" roi={lorvilleSellAll} />
</Frame>
<Frame name="roi-buy" caption="Lorville, buy · the best trip from here: GOLD above the bar, a row of every other tier, SCRA is dearer here than anyone pays (empty cell)">
  <TableDemo rows={lorville.rows} side="buy" roi={lorvilleBuy} />
</Frame>
<Frame name="roi-no-ship" caption="Lorville, sell · no ship is set (cargo space 0): no trip can be carried, so no row has a ROI; the tooltip of the head «ROI» says why: «Укажи корабль в настройках — без вместимости ROI не считается»">
  <TableDemo rows={lorville.rows} side="sell" noCapacity />
</Frame>
<Frame name="roi-long" caption="the widest things made up: the longest names of commodities, a seven-digit price, a ROI of thousands of percent written 999+ (the real number is in the tooltip), a five-digit one-price range">
  <TableDemo rows={longRows} side="buy" roi={longCells} />
</Frame>
<Frame name="bad-price" caption="buy · MEDS expanded, «12x» typed and Enter pressed: the price is marked" act={badPrice}>
  <TableDemo rows={data.rows} side="buy" selected={idOf('MEDS')} roi={hereBuy} />
</Frame>
<Frame name="empty" caption="a terminal nothing is known about">
  <TableDemo rows={data.noRows} side="buy" />
</Frame>
<Frame name="empty-side" caption="sell tab of a terminal that buys nothing">
  <TableDemo rows={noBuyers} side="sell" />
</Frame>
