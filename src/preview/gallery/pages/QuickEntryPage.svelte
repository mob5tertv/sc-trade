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

<Frame name="empty" caption="empty: product search (stretches) · side · price · SCU · write — no location field, no status block">
  {@render entry()}
</Frame>
<Frame name="filled" caption="commodity chosen (the field shows it), side follows the terminal, price and SCU typed" act={filled}>
  {@render entry()}
</Frame>
<Frame name="bad-price" caption="«12x» sent: the price is marked and the one line of the reason appears under the row" act={badPrice}>
  {@render entry()}
</Frame>
<!-- last: an open list lives only while the field keeps the focus, and the acts of the states run in this order -->
<Frame name="list" caption="«ste» typed: the list of the search is open (solid, 22 px rows)" minHeight={150} act={openList}>
  {@render entry()}
</Frame>
