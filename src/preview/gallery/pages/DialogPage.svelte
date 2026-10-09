<script lang="ts">
  import TradeDialog from '../../../ui/components/TradeDialog.svelte';
  import { INCOME_NOTE } from '../../../ui/vm/trade-form';
  import { find, typeInto } from '../acts';
  import { useGallery } from '../context';
  import Frame from '../Frame.svelte';

  const { data } = useGallery();
  const { trade } = data;
  const confirm = (t: { scu: number; price: number }): void => console.info('[gallery] confirm', JSON.stringify(t));

  async function typedPrice(frame: HTMLElement): Promise<void> {
    await typeInto(find<HTMLInputElement>(frame, 'input.in-price'), '3350');
  }

  async function bad(frame: HTMLElement): Promise<void> {
    await typeInto(find<HTMLInputElement>(frame, 'input'), '0');
    find<HTMLFormElement>(frame, 'form').requestSubmit();
  }
</script>

<!-- the form of a trade stands in the flow, under the row it belongs to: here it stands alone in its frame -->
<Frame name="buy" caption="«Купил»: quantity × price, the sum, the cut button confirms">
  <TradeDialog title={trade.title} side="buy" defaultScu={trade.scu} defaultPrice={trade.price} error={null} onConfirm={confirm} onCancel={() => {}} />
</Frame>
<Frame name="sell" caption="«Продал»">
  <TradeDialog title="Продал Stims" side="sell" defaultScu={80} defaultPrice={3320} error={null} onConfirm={confirm} onCancel={() => {}} />
</Frame>
<Frame name="income" caption="«Продал» goods that are not in the hold: no quantity, one muted line says it is an income">
  <TradeDialog title="Продал Gold" side="sell" defaultScu={null} defaultPrice={6742} note={INCOME_NOTE} error={null} onConfirm={confirm} onCancel={() => {}} />
</Frame>
<Frame name="empty" caption="nothing can be offered: the quantity is empty">
  <TradeDialog title="Купил Gold" side="buy" defaultScu={null} defaultPrice={6120} error={null} onConfirm={confirm} onCancel={() => {}} />
</Frame>
<Frame name="bad-input" caption="quantity 0 sent: the field is marked, one line of the reason" act={bad}>
  <TradeDialog title={trade.title} side="buy" defaultScu={trade.scu} defaultPrice={trade.price} error={null} onConfirm={confirm} onCancel={() => {}} />
</Frame>
<Frame name="error" caption="the write failed: the reason from the owner">
  <TradeDialog title={trade.title} side="buy" defaultScu={trade.scu} defaultPrice={trade.price} error="Свободно только 40 SCU" onConfirm={confirm} onCancel={() => {}} />
</Frame>
<Frame name="foreign-price" caption="the price is not mine (UEX, or mine gone cold): it stands muted, as in the field of the expanded row, until it is touched">
  <TradeDialog title="Продал Stims" side="sell" defaultScu={80} defaultPrice={3320} defaultPriceIsOwn={false} error={null} onConfirm={confirm} onCancel={() => {}} />
</Frame>
<Frame name="foreign-price-typed" caption="the same form after the price was typed over: the number is the player's now, in normal text" act={typedPrice}>
  <TradeDialog title="Продал Stims" side="sell" defaultScu={80} defaultPrice={3320} defaultPriceIsOwn={false} error={null} onConfirm={confirm} onCancel={() => {}} />
</Frame>
