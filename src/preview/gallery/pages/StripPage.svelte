<script lang="ts">
  import StripView from '../../../ui/components/StripView.svelte';
  import type { StripModel } from '../../../ui/vm/strip';
  import { useGallery } from '../context';
  import Frame from '../Frame.svelte';

  const { data } = useGallery();
  const open = (): void => console.info('[gallery] open');
  // the same run in the other two phases: each has its own timer; unloading has no button, the sale ends it
  const inPhase = (phase: 'flight' | 'unloading'): StripModel => (data.strip.run.kind === 'run'
    ? phase === 'flight'
      ? { ...data.strip.run, phase, phaseLabel: 'ПОЛЁТ', phaseTimer: '8:40', next: 'arrive' }
      : { ...data.strip.run, phase, phaseLabel: 'ВЫГРУЗКА', phaseTimer: '2:05', next: null }
    : data.strip.run);
  const flying = inPhase('flight');
  const unloading = inPhase('unloading');

  // the run line of version 1.2 (spec 14.19): one commodity in parts, the sale side by who says it
  const base = data.strip.cargo.single;
  const lotOf = (lot: import('../../../ui/vm/strip').StripLot): StripModel => (base.kind === 'run' ? { ...base, lot } : base);
  const own = lotOf({ code: 'MEDS', qty: '120 SCU', buy: '2 115', person: { who: 'моя', price: '2 351', age: '12 мин' }, range: { low: '2 190', high: '2 420' }, single: null });
  const fleet = lotOf({ code: 'MEDS', qty: '120 SCU', buy: '2 115', person: { who: 'Вася', price: '2 351', age: '4 мин' }, range: { low: '2 190', high: '2 420' }, single: null });
  const uex = lotOf({ code: 'MEDS', qty: '120 SCU', buy: '2 115', person: null, range: { low: '2 190', high: '2 420' }, single: null });
  const ownOnly = lotOf({ code: 'MEDS', qty: '120 SCU', buy: '2 115', person: { who: 'моя', price: '2 351', age: '12 мин' }, range: null, single: null });
  const one = lotOf({ code: 'MEDS', qty: '120 SCU', buy: '2 115', person: null, range: null, single: '2 351' });
  const bare = lotOf({ code: 'MEDS', qty: '120 SCU', buy: '2 115', person: null, range: null, single: null });
</script>

<Frame name="idle" caption="no run, a target is set: the location → the target" width="content">
  <StripView model={data.strip.idle} flash={null} onOpen={open} />
</Frame>
<Frame name="idle-bare" caption="no run and no target: the location alone, no label in front of it (the grip of the window is not in this frame)" width="content">
  <StripView model={data.strip.idle.kind === 'idle' ? { ...data.strip.idle, target: null } : data.strip.idle} flash={null} onOpen={open} />
</Frame>
<Frame name="flight" caption="in flight: the phase and its own timer first, the button of the arrival" width="content">
  <StripView model={flying} flash={null} onOpen={open} onArrive={open} />
</Frame>
<Frame name="unloading" caption="unloading: no button, the sale ends the run" width="content">
  <StripView model={unloading} flash={null} onOpen={open} />
</Frame>
<Frame name="run" caption="a run with BOTH mark buttons (more than the owner gives): two commodities with what they were bought for, the line whole" width="content">
  <StripView model={data.strip.run} flash={null} onOpen={open} onDepart={open} onArrive={open} />
</Frame>
<Frame name="run-arrive" caption="a run: timer · cargo · → target · the profit expected and the rate, and the one button of the next mark: the cargo is whole" width="content">
  <StripView model={data.strip.run} flash={null} onOpen={open} onArrive={open} />
</Frame>
<Frame name="run-bare" caption="a run without mark buttons" width="content">
  <StripView model={data.strip.run} flash={null} onOpen={open} />
</Frame>
<Frame name="flash" caption="a message replaces the content" width="content">
  <StripView model={data.strip.run} flash="Цель рейса: ARC-L1." onOpen={open} onArrive={open} />
</Frame>
<Frame name="long" caption="a cargo of six lines: the cargo is cut with an ellipsis, the line is not wider than 660 px" width="content">
  <StripView model={data.strip.long} flash={null} onOpen={open} onDepart={open} onArrive={open} />
</Frame>
<Frame name="no-target" caption="a run with no target chosen" width="content">
  <StripView model={data.strip.noTarget} flash={null} onOpen={open} onArrive={open} />
</Frame>
<Frame name="cargo-single" caption="one commodity at an ordinary price: what it was bought for, then what it is expected to sell for, then the profit expected and the rate" width="content">
  <StripView model={data.strip.cargo.single} flash={null} onOpen={open} onDepart={open} />
</Frame>
<Frame name="lot-own" caption="1.2 · my own price at the target stands still in a frame with its age; after it the low and the high end of the range take turns (3 s each)" width="content">
  <StripView model={own} flash={null} onOpen={open} onDepart={open} />
</Frame>
<Frame name="lot-own-still" caption="1.2 · the same with the turns switched off (the setting, or a system that asks for less motion): the range stands as low–high" width="content">
  <StripView model={own} flash={null} onOpen={open} onDepart={open} rangeStill />
</Frame>
<Frame name="lot-uex" caption="1.2 · only UEX knows the target: the two ends of its range take turns, nothing in a frame" width="content">
  <StripView model={uex} flash={null} onOpen={open} onDepart={open} />
</Frame>
<Frame name="lot-uex-still" caption="1.2 · only UEX, turns off" width="content">
  <StripView model={uex} flash={null} onOpen={open} onDepart={open} rangeStill />
</Frame>
<Frame name="lot-own-only" caption="1.2 · my own price and no range of UEX: the frame alone" width="content">
  <StripView model={ownOnly} flash={null} onOpen={open} onDepart={open} />
</Frame>
<Frame name="lot-one" caption="1.2 · a price that is one number (a single report of UEX): the number alone, no marks" width="content">
  <StripView model={one} flash={null} onOpen={open} onDepart={open} />
</Frame>
<Frame name="lot-bare" caption="1.2 · nothing known at the target (or no target): what is aboard and what it was bought for" width="content">
  <StripView model={bare} flash={null} onOpen={open} onDepart={open} />
</Frame>
<Frame name="lot-fleet" caption="2.0, for the look ahead · a price a member of the fleet typed in: his nick in the same frame" width="content">
  <StripView model={fleet} flash={null} onOpen={open} onDepart={open} />
</Frame>
<Frame name="cargo-one" caption="one commodity: its quantity with SCU, what it was bought for (seven digits) and what it is expected to sell for, the profit and the rate (nine digits: a loss, the widest numbers)" width="content">
  <StripView model={data.strip.cargo.one} flash={null} onOpen={open} onDepart={open} />
</Frame>
<Frame name="cargo-one-far" caption="the widest line of one commodity: the same with the longest name of a target (Seraphim Station): only the cargo may be cut" width="content">
  <StripView model={{ ...data.strip.cargo.one, target: 'Seraphim Station' }} flash={null} onOpen={open} onDepart={open} />
</Frame>
<Frame name="cargo-two" caption="two commodities: no SCU, each with what it was bought for (seven digits), and no «ждём» (which commodity would it be for? it is in the tooltip, a line for each)" width="content">
  <StripView model={data.strip.cargo.two} flash={null} onOpen={open} onDepart={open} />
</Frame>
<Frame name="cargo-three" caption="three commodities with seven-digit prices: the cargo is cut with an ellipsis, the target, the profit expected, the rate and the button stay whole" width="content">
  <StripView model={data.strip.cargo.three} flash={null} onOpen={open} onDepart={open} />
</Frame>
