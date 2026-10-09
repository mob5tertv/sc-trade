<script lang="ts">
  import QuickEntry from '../../../ui/components/QuickEntry.svelte';
  import { find, press, typeInto } from '../acts';
  import { useGallery } from '../context';
  import Frame from '../Frame.svelte';

  const { data } = useGallery();
  const save = async (entry: unknown): Promise<string | null> => {
    console.info('[gallery] save', JSON.stringify(entry));
    return null;
  };

  async function openList(frame: HTMLElement): Promise<void> {
    await typeInto(find<HTMLInputElement>(frame, 'input[role="combobox"]'), 'ste');
  }

  // a commodity picked with Enter, a price that is not a number, the form sent
  async function badPrice(frame: HTMLElement): Promise<void> {
    const search = find<HTMLInputElement>(frame, 'input[role="combobox"]');
    await typeInto(search, 'meds');
    await press(search, 'Enter');
    await typeInto(find<HTMLInputElement>(frame, '.in-price'), '12x');
    find<HTMLFormElement>(frame, 'form').requestSubmit();
  }

  // a price that reads, a quantity that does not: the quantity is marked
  async function badScu(frame: HTMLElement): Promise<void> {
    const search = find<HTMLInputElement>(frame, 'input[role="combobox"]');
    await typeInto(search, 'meds');
    await press(search, 'Enter');
    await typeInto(find<HTMLInputElement>(frame, '.in-price'), '2400');
    await typeInto(find<HTMLInputElement>(frame, '.in-scu'), '-5');
    find<HTMLFormElement>(frame, 'form').requestSubmit();
  }

  // no viewed terminal: there is nowhere to write to
  async function noTerminal(frame: HTMLElement): Promise<void> {
    const search = find<HTMLInputElement>(frame, 'input[role="combobox"]');
    await typeInto(search, 'meds');
    await press(search, 'Enter');
    await typeInto(find<HTMLInputElement>(frame, '.in-price'), '2400');
    find<HTMLFormElement>(frame, 'form').requestSubmit();
  }

  // a whole cycle: commodity, price, quantity, the form sent; the line is empty again and nothing has appeared under it
  async function saved(frame: HTMLElement): Promise<void> {
    const search = find<HTMLInputElement>(frame, 'input[role="combobox"]');
    await typeInto(search, 'sc');
    await press(search, 'Enter');
    await typeInto(find<HTMLInputElement>(frame, '.in-price'), '1650');
    find<HTMLFormElement>(frame, 'form').requestSubmit();
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  // a price with no commodity: the commodity field is marked, nothing is written
  async function noCommodity(frame: HTMLElement): Promise<void> {
    await typeInto(find<HTMLInputElement>(frame, '.in-price'), '1650');
    find<HTMLFormElement>(frame, 'form').requestSubmit();
  }

  async function filled(frame: HTMLElement): Promise<void> {
    const search = find<HTMLInputElement>(frame, 'input[role="combobox"]');
    await typeInto(search, 'sc');
    await press(search, 'Enter');
    await typeInto(find<HTMLInputElement>(frame, '.in-price'), '1650');
    await typeInto(find<HTMLInputElement>(frame, '.in-scu'), '300');
  }
</script>

{#snippet entry(terminalId: number | null = data.viewedId)}
  <QuickEntry {terminalId} commodityItems={data.commodityItems} boostIds={data.boostIds} sideFor={data.sideFor} onSave={save} />
{/snippet}

<Frame name="empty" caption="empty: product search (stretches) · side · price · SCU · write; no location field, nothing under the line">
  {@render entry()}
</Frame>
<Frame name="filled" caption="commodity chosen (the field shows it), side follows the terminal, price and SCU typed" act={filled}>
  {@render entry()}
</Frame>
<Frame name="saved" caption="saved (SCRA 1650, Enter): the line is empty again; the confirmation is the table below, and nothing appears or goes away under the line" act={saved}>
  {@render entry()}
</Frame>
<Frame name="no-commodity" caption="a price with no commodity sent: the commodity field is red and one line under the entry says why: «Выбери товар» (the line is there only while a field is marked)" act={noCommodity}>
  {@render entry()}
</Frame>
<Frame name="bad-price" caption="«12x» sent: the price field is red and the line under the entry says why: «Цена — целое число больше нуля»" act={badPrice}>
  {@render entry()}
</Frame>
<Frame name="bad-scu" caption="a price and a quantity that is not a number sent: the quantity field is red, «Количество — целое число от нуля»" act={badScu}>
  {@render entry()}
</Frame>
<Frame name="no-terminal" caption="no location chosen, a commodity and a price typed and sent: the button is marked and the line says «Сначала выбери локацию в шапке окна»" act={noTerminal}>
  {@render entry(null)}
</Frame>
<!-- last: an open list lives only while the field keeps the focus, and the acts of the states run in this order -->
<Frame name="list" caption="«ste» typed: the list of the search is open (solid, 22 px rows)" minHeight={150} act={openList}>
  {@render entry()}
</Frame>
