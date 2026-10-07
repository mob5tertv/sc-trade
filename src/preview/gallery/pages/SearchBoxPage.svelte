<script lang="ts">
  import { tick } from 'svelte';
  import type { Terminal } from '../../../core/types';
  import SearchBox from '../../../ui/components/SearchBox.svelte';
  import { terminalSearchItems } from '../../../ui/vm/header';
  import { find, press, typeInto } from '../acts';
  import { useGallery } from '../context';
  import Frame from '../Frame.svelte';

  const { data } = useGallery();
  const pick = (id: number): void => console.info('[gallery] pick', id);

  // Terminals of every star system, with the places they say: the real ones of the dataset and a few made up to show what the
  // list does with names it has seen too little of: three of one name in different systems (UEX has many "Stanton Gateway"),
  // one whose name is longer than the list is wide and one whose place is.
  const some = [...data.reference.terminals.values()][0];
  const systemId = (name: string): number => {
    const found = data.reference.starSystems.find((s) => s.name === name);
    if (found === undefined) throw new Error(`the reference has no star system ${name}`);
    return found.id;
  };
  const madeUp = (id: number, system: string, partial: Partial<Terminal>): Terminal => ({
    ...some, id, code: `X${id}`, name: `Admin - ${partial.displayname}`, nickname: partial.displayname ?? '',
    starSystemId: systemId(system), starSystemName: system, planetName: null, orbitName: null, moonName: null,
    spaceStationName: null, outpostName: null, cityName: null, ...partial,
  });
  const gateways: Terminal[] = [
    madeUp(9001, 'Pyro', { displayname: 'Stanton Gateway', spaceStationName: 'Stanton Gateway' }),
    madeUp(9002, 'Nyx', { displayname: 'Stanton Gateway', planetName: 'Delamar', spaceStationName: 'Stanton Gateway' }),
    madeUp(9003, 'Stanton', { displayname: 'Stanton Gateway', planetName: 'Crusader', moonName: 'Yela' }),
  ];
  const longs: Terminal[] = [
    madeUp(9004, 'Stanton', { displayname: 'Orbital Logistics Hub Extension Platform Alpha Commercial Freight Annex', moonName: 'Wala' }),
    madeUp(9005, 'Stanton', { displayname: 'Orbital Depot', moonName: 'Wala Research and Development Subsidiary' }),
  ];
  const placeItems = terminalSearchItems(
    { ...data.reference, terminals: new Map([...data.reference.terminals, ...[...gateways, ...longs].map((t): [number, Terminal] => [t.id, t])]) },
    null,
  );
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
<Frame
  name="places"
  caption="«stanton g» typed: three terminals of one name in three star systems; the muted place beside each tells them apart (the whole place is in the tooltip of the row)"
  minHeight={120}
  act={(frame) => typeInto(find<HTMLInputElement>(frame, 'input'), 'stanton g')}
>
  <div class="pad"><SearchBox items={placeItems} value={data.viewedName} placeholder="Локация" onPick={pick} /></div>
</Frame>
<Frame
  name="places-long"
  caption="«orbital» typed: a name longer than the list is cut with an ellipsis and the place beside it stays whole; a place longer than half the row is cut too (the full text is in the tooltip of the row)"
  minHeight={100}
  act={(frame) => typeInto(find<HTMLInputElement>(frame, 'input'), 'orbital')}
>
  <div class="pad"><SearchBox items={placeItems} value={data.viewedName} placeholder="Локация" onPick={pick} /></div>
</Frame>
<Frame
  name="commodities"
  caption="the same box picking a commodity: no place, the list looks as it did (name and code)"
  minHeight={120}
  act={(frame) => typeInto(find<HTMLInputElement>(frame, 'input'), 'ti')}
>
  <div class="pad"><SearchBox items={data.commodityItems} placeholder="Товар" onPick={pick} /></div>
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
