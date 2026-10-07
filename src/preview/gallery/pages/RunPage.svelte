<script lang="ts">
  import RunCard from '../../../ui/components/RunCard.svelte';
  import SellDecisionView from '../../../ui/components/SellDecisionView.svelte';
  import { click, find } from '../acts';
  import { useGallery } from '../context';
  import Frame from '../Frame.svelte';

  const { data } = useGallery();
  const { runCard, sell, reference } = data;
  const nothing = (): void => {};
</script>

<Frame name="card" caption="the card of the run: timer, the mark buttons, cargo lines, totals">
  <RunCard cargo={runCard.cargo} timer={runCard.timer} totals={runCard.totals} onDepart={nothing} onArrive={nothing} onLost={nothing} />
</Frame>
<Frame name="card-lost" caption="«Груз потерян» pressed: the question, the safe answer has the focus" act={(frame) => click(find(frame, '.danger'))}>
  <RunCard cargo={runCard.cargo} timer={runCard.timer} totals={runCard.totals} onDepart={nothing} onArrive={nothing} onLost={nothing} />
</Frame>
<Frame name="sell-decision" caption="sell here or fly on: the sale on the spot and up to three other buyers">
  <SellDecisionView commodityCode={sell.commodityCode} here={sell.here} alternatives={sell.alternatives} {reference} />
</Frame>
<Frame name="sell-decision-alone" caption="no other buyer">
  <SellDecisionView commodityCode={sell.commodityCode} here={sell.here} alternatives={[]} {reference} />
</Frame>
