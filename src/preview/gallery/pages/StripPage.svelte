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
</script>

<Frame name="idle" caption="no run, a target is set: the location → the target" width="content">
  <StripView model={data.strip.idle} flash={null} onOpen={open} />
</Frame>
<Frame name="idle-bare" caption="no run and no target: the SC mark and the location" width="content">
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
<Frame name="run-arrive" caption="a run: timer · cargo · → target · wait for the price · rate, and the one button of the next mark: the cargo is whole" width="content">
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
<Frame name="cargo-one" caption="one commodity: its quantity with SCU and what it was bought for (seven digits)" width="content">
  <StripView model={data.strip.cargo.one} flash={null} onOpen={open} onDepart={open} />
</Frame>
<Frame name="cargo-two" caption="two commodities: no SCU, each with what it was bought for (seven digits)" width="content">
  <StripView model={data.strip.cargo.two} flash={null} onOpen={open} onDepart={open} />
</Frame>
<Frame name="cargo-three" caption="three commodities with seven-digit prices: the cargo is cut with an ellipsis, the target, the expectation, the rate and the button stay whole" width="content">
  <StripView model={data.strip.cargo.three} flash={null} onOpen={open} onDepart={open} />
</Frame>
