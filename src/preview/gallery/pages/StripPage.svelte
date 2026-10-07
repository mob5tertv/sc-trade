<script lang="ts">
  import StripView from '../../../ui/components/StripView.svelte';
  import type { StripModel } from '../../../ui/vm/strip';
  import { useGallery } from '../context';
  import Frame from '../Frame.svelte';

  const { data } = useGallery();
  const open = (): void => console.info('[gallery] open');
  // what the strip says when the target was never picked: no target, no price there, no rate
  const noTarget: StripModel = data.strip.run.kind === 'run' ? { ...data.strip.run, target: null, expect: null, rate: null } : data.strip.run;
</script>

<Frame name="idle" caption="no run: the SC mark and the location" width="content">
  <StripView model={data.strip.idle} flash={null} onOpen={open} />
</Frame>
<Frame name="run" caption="a run: timer · cargo · → target · wait for the price · rate, and the mark buttons" width="content">
  <StripView model={data.strip.run} flash={null} onOpen={open} onDepart={open} onArrive={open} />
</Frame>
<Frame name="run-arrive" caption="a run, one mark button (the owner gives only the next mark)" width="content">
  <StripView model={data.strip.run} flash={null} onOpen={open} onArrive={open} />
</Frame>
<Frame name="run-bare" caption="a run without mark buttons" width="content">
  <StripView model={data.strip.run} flash={null} onOpen={open} />
</Frame>
<Frame name="flash" caption="a message replaces the content" width="content">
  <StripView model={data.strip.run} flash="Цель рейса: ARC-L1." onOpen={open} onArrive={open} />
</Frame>
<Frame name="long" caption="a cargo of six lines: the cargo is cut with an ellipsis, the line is not wider than 520 px" width="content">
  <StripView model={data.strip.long} flash={null} onOpen={open} onDepart={open} onArrive={open} />
</Frame>
<Frame name="no-target" caption="a run with no target chosen" width="content">
  <StripView model={noTarget} flash={null} onOpen={open} onArrive={open} />
</Frame>
