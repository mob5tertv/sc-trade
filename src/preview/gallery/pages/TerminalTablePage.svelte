<script lang="ts">
  import { tick } from 'svelte';
  import type { CargoLine } from '../../../core/types';
  import type { TerminalRow } from '../../../ui/vm/terminal-rows';
  import { roiCells } from '../../../ui/vm/row-roi';
  import type { RowRoi } from '../../../ui/vm/row-roi';
  import { sideCounts } from '../../../ui/vm/terminal-rows';
  import { click, find, press, typeInto } from '../acts';
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

  // the player's hold on arrival at Lorville: MEDS and STIM, in the order they were bought
  const hold: CargoLine[] = [
    { commodityId: lorvilleId('MEDS'), scu: 120, avgBuyPrice: 2115 },
    { commodityId: lorvilleId('STIM'), scu: 80, avgBuyPrice: 2810 },
  ];

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

  // the longest name there is, in the hold with a five-digit quantity
  const longHold: CargoLine[] = [{ commodityId: longRows[0].commodityId, scu: 12_345, avgBuyPrice: 1_234_567 }];

  // A row with no price at all: the table never draws one (a side has a cell only when a price can be estimated), so it is made up
  // from the UEX row of Gold on the sell side with the price taken away, to see what the field says when there is nothing to correct.
  const gold = data.rows.find((r) => r.code === 'GOLD');
  if (!gold?.sell) throw new Error('the table has no Gold on the sell side');
  const noPrice: TerminalRow[] = [{
    ...gold,
    sell: { ...gold.sell, own: null, hint: null, hintScu: null, badge: null, ownLast: null, trend: null, warn: false, range: { kind: 'none' } },
  }];

  // a click on a head that sorts («Товар» or «ROI»), as many times as asked
  async function sortBy(frame: HTMLElement, label: string, times = 1): Promise<void> {
    const button = [...frame.querySelectorAll<HTMLElement>('.head .sort')].find((el) => (el.textContent ?? '').trim() === label);
    if (button === undefined) throw new Error(`the table has no head "${label}" that sorts`);
    for (let i = 0; i < times; i++) await click(button);
  }

  // A price typed into the open row and not saved, then the head «ROI» clicked the way a mouse clicks it: the button takes the focus
  // (the field is left, its text is checked and kept), then the click. The row moves, stays open, keeps the text.
  async function sortWithDraft(frame: HTMLElement): Promise<void> {
    await typeInto(find<HTMLInputElement>(frame, '.in-price'), '12x');
    find<HTMLElement>(frame, '.head > span:last-child .sort').focus();
    await sortBy(frame, 'ROI');
  }

  // The head «ROI» clicked by a click event that leaves the focus in the field (the keyboard of the player is in the field, the order
  // is asked for from elsewhere): the sort is asked for and the places of the rows are held while the field has the focus.
  async function sortHeld(frame: HTMLElement): Promise<void> {
    await typeInto(find<HTMLInputElement>(frame, '.in-price'), '2400');
    await sortBy(frame, 'ROI');
  }

  // ...and then the focus leaves the table: the sort has its way.
  async function sortReleased(frame: HTMLElement): Promise<void> {
    await sortHeld(frame);
    find<HTMLInputElement>(frame, '.in-price').blur();
    await tick();
  }

  async function badPrice(frame: HTMLElement): Promise<void> {
    const price = find<HTMLInputElement>(frame, '.in-price');
    await typeInto(price, '12x');
    await press(price, 'Enter');
  }

  // the price of UEX in the field, corrected by a little: the player's own text, in the normal colour
  async function correctedPrice(frame: HTMLElement): Promise<void> {
    const price = find<HTMLInputElement>(frame, '.in-price');
    await typeInto(price, String(Number(price.value) + 10));
  }

  // a quantity over a row that has no price: leaving the cell is refused and the price is marked
  async function quantityWithoutPrice(frame: HTMLElement): Promise<void> {
    const scu = find<HTMLInputElement>(frame, '.in-scu');
    await typeInto(scu, '50');
    scu.blur();
    await tick();
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
<Frame name="sell-uex" caption="sell · GOLD expanded, a price of UEX only: the price of the row stands in the field, muted · it is corrected in place, a quantity is saved alone, Enter confirms it as mine">
  <TableDemo rows={data.rows} side="sell" selected={idOf('GOLD')} roi={hereSell} />
</Frame>
<Frame name="sell-uex-corrected" caption="sell · GOLD, the price in the field corrected by a little: now it is the player's text, in the normal colour" act={correctedPrice}>
  <TableDemo rows={data.rows} side="sell" selected={idOf('GOLD')} roi={hereSell} />
</Frame>
<Frame name="no-price" caption="made up: a row with no price at all (the table never draws one): nothing stands in the field, only the dash of the placeholder">
  <TableDemo rows={noPrice} side="sell" selected={idOf('GOLD')} />
</Frame>
<Frame name="no-price-refused" caption="made up: a row with no price, a quantity typed and the cell left: nothing is saved, the price is marked as required" act={quantityWithoutPrice}>
  <TableDemo rows={noPrice} side="sell" selected={idOf('GOLD')} />
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
<Frame name="sell-cargo" caption="Lorville, sell, a run is going · MEDS and STIM are in the hold: they stand first, in the order of the cargo, with a box and the quantity after the name · the other rows as before">
  <TableDemo rows={lorville.rows} side="sell" roi={lorvilleSell} cargo={hold} />
</Frame>
<Frame name="sell-cargo-expanded" caption="Lorville, sell · STIM (in the hold) expanded: the mark stays on the name, the fields open under the row">
  <TableDemo rows={lorville.rows} side="sell" selected={lorvilleId('STIM')} roi={lorvilleSell} cargo={hold} />
</Frame>
<Frame name="sell-cargo-buy-side" caption="the same hold, the buy side of Lorville: nothing is marked, nothing moves">
  <TableDemo rows={lorville.rows} side="buy" roi={lorvilleBuy} cargo={hold} />
</Frame>
<Frame name="sort-default" caption="Lorville, sell · nothing clicked: the order of the view model (by the name), «Товар» carries the arrow and aria-sort=ascending">
  <TableDemo rows={lorville.rows} side="sell" roi={lorvilleSell} />
</Frame>
<Frame name="sort-roi" caption="Lorville, sell · «ROI» clicked once: the best ROI on top, rows without one (AGRI, BERY, QUAR) at the end, the arrow down on «ROI»" act={(frame) => sortBy(frame, 'ROI')}>
  <TableDemo rows={lorville.rows} side="sell" roi={lorvilleSell} />
</Frame>
<Frame name="sort-roi-asc" caption="Lorville, sell · «ROI» clicked twice: the order is turned round (the worst on top), rows without a ROI are still last, the arrow up" act={(frame) => sortBy(frame, 'ROI', 2)}>
  <TableDemo rows={lorville.rows} side="sell" roi={lorvilleSell} />
</Frame>
<Frame name="sort-back" caption="Lorville, sell · «ROI», then «Товар»: the default order is back" act={async (frame) => { await sortBy(frame, 'ROI'); await sortBy(frame, 'Товар'); }}>
  <TableDemo rows={lorville.rows} side="sell" roi={lorvilleSell} />
</Frame>
<Frame name="sort-cargo" caption="Lorville, sell, MEDS and STIM in the hold · «ROI» clicked: the hold stays first (STIM 70 % before MEDS 54 %, each group by ROI), the others after it by ROI" act={(frame) => sortBy(frame, 'ROI')}>
  <TableDemo rows={lorville.rows} side="sell" roi={lorvilleSell} cargo={hold} />
</Frame>
<Frame name="sort-cargo-narrow" width={380} caption="the same in the narrowest window (380 px): the mark of the hold and the head «ROI» with its arrow take the room of the names, the columns of numbers stay" act={(frame) => sortBy(frame, 'ROI')}>
  <TableDemo rows={longRows} side="sell" roi={longCells} cargo={longHold} />
</Frame>
<Frame name="sort-draft" caption="Lorville, sell · PFOO open, «12x» typed and not saved, then «ROI» clicked with the mouse: the row moved up to its place by ROI, is still open and holds its text" act={sortWithDraft}>
  <TableDemo rows={lorville.rows} side="sell" selected={lorvilleId('PFOO')} roi={lorvilleSell} />
</Frame>
<Frame name="sort-held" caption="Lorville, sell · PFOO open with the cursor in its price field, «ROI» asked for meanwhile: the arrow moved, the places of the rows did not (a row that moves takes the focus out of the field)" act={sortHeld}>
  <TableDemo rows={lorville.rows} side="sell" selected={lorvilleId('PFOO')} roi={lorvilleSell} />
</Frame>
<Frame name="sort-held-released" caption="the same, and the cursor leaves the field: the table takes the order of the sort" act={sortReleased}>
  <TableDemo rows={lorville.rows} side="sell" selected={lorvilleId('PFOO')} roi={lorvilleSell} />
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
