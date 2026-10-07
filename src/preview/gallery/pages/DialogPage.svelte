<script lang="ts">
  import TradeDialog from '../../../ui/components/TradeDialog.svelte';
  import { find, typeInto } from '../acts';
  import { useGallery } from '../context';
  import Frame from '../Frame.svelte';

  const { data } = useGallery();
  const { trade } = data;
  const confirm = (t: { scu: number; price: number }): void => console.info('[gallery] confirm', JSON.stringify(t));

  async function bad(frame: HTMLElement): Promise<void> {
    await typeInto(find<HTMLInputElement>(frame, 'input'), '0');
    find<HTMLFormElement>(frame, 'form').requestSubmit();
  }
</script>

<!-- `contain: layout` makes the box the frame of the fixed overlay of the dialog, as the window is in life -->
<Frame name="buy" caption="«Купил»: quantity and price, the cut button confirms">
  <div class="stage">
    <TradeDialog title={trade.title} side="buy" defaultScu={trade.scu} defaultPrice={trade.price} error={null} onConfirm={confirm} onCancel={() => {}} />
  </div>
</Frame>
<Frame name="sell" caption="«Продал»">
  <div class="stage">
    <TradeDialog title="Продал Stims" side="sell" defaultScu={80} defaultPrice={3320} error={null} onConfirm={confirm} onCancel={() => {}} />
  </div>
</Frame>
<Frame name="bad-input" caption="quantity 0 sent: the field is marked, one line of the reason" act={bad}>
  <div class="stage">
    <TradeDialog title={trade.title} side="buy" defaultScu={trade.scu} defaultPrice={trade.price} error={null} onConfirm={confirm} onCancel={() => {}} />
  </div>
</Frame>
<Frame name="error" caption="the write failed: the reason from the owner">
  <div class="stage">
    <TradeDialog title={trade.title} side="buy" defaultScu={trade.scu} defaultPrice={trade.price} error="Свободно только 40 SCU" onConfirm={confirm} onCancel={() => {}} />
  </div>
</Frame>

<style>
  .stage {
    position: relative;
    height: 190px;
    contain: layout;
  }
</style>
