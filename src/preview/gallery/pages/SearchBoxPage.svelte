<script lang="ts">
  import { tick } from 'svelte';
  import SearchBox from '../../../ui/components/SearchBox.svelte';
  import { find, press, typeInto } from '../acts';
  import { useGallery } from '../context';
  import Frame from '../Frame.svelte';

  const { data } = useGallery();
  const pick = (id: number): void => console.info('[gallery] pick', id);
</script>

<Frame name="value" caption="value: the viewed location stands in the field">
  <div class="pad"><SearchBox items={data.terminalItems} value={data.viewedName} placeholder="Локация" onPick={pick} /></div>
</Frame>
<Frame name="selected" caption="a click (here: focus) selects the whole value, the next key replaces it" act={(frame) => find<HTMLInputElement>(frame, 'input').focus()}>
  <div class="pad"><SearchBox items={data.terminalItems} value={data.viewedName} placeholder="Локация" onPick={pick} /></div>
</Frame>
<Frame name="empty" caption="no value: the placeholder">
  <div class="pad"><SearchBox items={data.terminalItems} placeholder="Сменить локацию" onPick={pick} /></div>
</Frame>
<!-- the list goes away (a pick, the field left): the element of the list is gone and the effect of the box runs once more; it must not throw -->
<Frame
  name="picked"
  caption="«hur» typed, Enter: the first match is picked, the list closes, the value comes back"
  act={async (frame) => {
    const input = find<HTMLInputElement>(frame, 'input');
    await typeInto(input, 'hur');
    await press(input, 'Enter');
  }}
>
  <div class="pad"><SearchBox items={data.terminalItems} value={data.viewedName} boostIds={data.boostIds} placeholder="Локация" onPick={pick} /></div>
</Frame>
<Frame
  name="left"
  caption="«hur» typed, then the field is left: the list closes, the value comes back"
  act={async (frame) => {
    const input = find<HTMLInputElement>(frame, 'input');
    await typeInto(input, 'hur');
    input.blur();
    await tick();
  }}
>
  <div class="pad"><SearchBox items={data.terminalItems} value={data.viewedName} boostIds={data.boostIds} placeholder="Локация" onPick={pick} /></div>
</Frame>
<!-- last: the focus of the page stays with the state whose act ran last -->
<Frame name="typing" caption="«hur» typed over the value: the list of the matches" minHeight={160} act={(frame) => typeInto(find<HTMLInputElement>(frame, 'input'), 'hur')}>
  <div class="pad"><SearchBox items={data.terminalItems} value={data.viewedName} boostIds={data.boostIds} placeholder="Локация" onPick={pick} /></div>
</Frame>

<style>
  .pad {
    padding: 4px var(--sc-pad-x);
  }
</style>
