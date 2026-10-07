<script lang="ts">
  import RunCard from '../../../ui/components/RunCard.svelte';
  import SellDecisionView from '../../../ui/components/SellDecisionView.svelte';
  import { useGallery } from '../context';
  import Frame from '../Frame.svelte';

  const { data } = useGallery();
  const { runCard, sell, reference } = data;
  const nothing = (): void => {};
  // the states of the money that the data of the dataset does not make by itself: no target, an expected loss
  const noTarget = { ...runCard.outlook, expected: null, why: 'выбери цель' };
  const loss = runCard.outlook.expected === null
    ? runCard.outlook
    : { ...runCard.outlook, expected: { ...runCard.outlook.expected, profit: '≈ -11 520', profitLoss: true, roi: '≈ -2%', rate: '≈ -41k' } };
</script>

<Frame name="card" caption="the card of the run while loading: the phases of the leg, only «Груз потерян» (the header has the mark), cargo, put in / sold, the EXPECTED result with ≈">
  <RunCard cargo={runCard.cargo} phases={runCard.phases} outlook={runCard.outlook} marks={[]} onMark={nothing} onLost={nothing} />
</Frame>
<Frame name="card-unloading" caption="unloading: the header has no mark, so the card offers the take-off of another leg">
  <RunCard cargo={runCard.cargo} phases={runCard.phases} outlook={runCard.outlook} marks={['depart']} onMark={nothing} onLost={nothing} />
</Frame>
<Frame name="card-no-target" caption="no target: the three expected numbers are dashes, the tooltip says «выбери цель»">
  <RunCard cargo={runCard.cargo} phases={runCard.phases} outlook={noTarget} marks={[]} onMark={nothing} onLost={nothing} />
</Frame>
<Frame name="card-loss" caption="an expected loss: red, and only here">
  <RunCard cargo={runCard.cargo} phases={runCard.phases} outlook={loss} marks={[]} onMark={nothing} onLost={nothing} />
</Frame>
<Frame name="sell-decision" caption="sell here or fly on: the sale on the spot and up to three other buyers">
  <SellDecisionView commodityCode={sell.commodityCode} here={sell.here} alternatives={sell.alternatives} {reference} />
</Frame>
<Frame name="sell-decision-alone" caption="no other buyer">
  <SellDecisionView commodityCode={sell.commodityCode} here={sell.here} alternatives={[]} {reference} />
</Frame>
