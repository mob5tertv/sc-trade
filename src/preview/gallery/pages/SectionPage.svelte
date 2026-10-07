<script lang="ts">
  import Section from '../../../ui/components/Section.svelte';
  import HistoryList from '../../../ui/components/HistoryList.svelte';
  import TerminalTable from '../../../ui/components/TerminalTable.svelte';
  import { find, click } from '../acts';
  import { useGallery } from '../context';
  import Frame from '../Frame.svelte';

  const { data } = useGallery();
  let openA = $state(true);
  let openB = $state(false);
  let openC = $state(true);
  let openD = $state(true);
  let openE = $state(true);
  let side = $state<'buy' | 'sell'>('buy');
  let quick = $state(false);
  let selected = $state<number | null>(null);
</script>

<Frame name="open" caption="open: chevron, TITLE in spaced caps, one-line summary; the body directly under, no padding">
  <Section title="Рейс" summary="MEDS 120 SCU, STIM 80 SCU → ARC-L1" open={openA} onToggle={() => (openA = !openA)}>
    <HistoryList rows={data.history} />
  </Section>
</Frame>
<Frame name="closed" caption="closed: only the header, nothing else">
  <Section title="Мои маршруты" summary="лучшие, история, сессии" open={openB} onToggle={() => (openB = !openB)}>
    <HistoryList rows={data.history} />
  </Section>
</Frame>
<Frame name="actions" caption="cross + buttons in the header: a click on them does not toggle (the section is shut by a click on the title only)">
  <Section title="Варианты" summary={data.titles.from} open={openC} onToggle={() => (openC = !openC)} onClose={() => console.info('[gallery] close')}>
    {#snippet actions()}
      <button type="button" class="sc-btn sc-btn--act" onclick={() => console.info('[gallery] all commodities')}>Все товары</button>
    {/snippet}
    <HistoryList rows={data.history.slice(0, 2)} />
  </Section>
</Frame>
<Frame name="long-summary" caption="a long summary is cut with an ellipsis; the buttons keep their place">
  <Section title="Варианты" summary={data.titles.long} open={openD} onToggle={() => (openD = !openD)} onClose={() => {}}>
    {#snippet actions()}
      <button type="button" class="sc-btn sc-btn--act">Все товары</button>
    {/snippet}
    <HistoryList rows={data.history.slice(0, 1)} />
  </Section>
</Frame>
<Frame name="terminal" caption="«Терминал» as 24d will build it: the switch of the sides and the quick-entry button in the header" act={async (frame) => { await click(find(frame, '.line')); }}>
  <Section title="Терминал" summary={data.viewedName} open={openE} onToggle={() => (openE = !openE)}>
    {#snippet actions()}
      <div class="sc-seg" role="group" aria-label="Сторона">
        <button type="button" aria-pressed={side === 'buy'} onclick={() => (side = 'buy')}>Купить {data.rows.filter((r) => r.buy).length}</button>
        <button type="button" aria-pressed={side === 'sell'} onclick={() => (side = 'sell')}>Продать {data.rows.filter((r) => r.sell).length}</button>
      </div>
      <button type="button" class="sc-btn sc-btn--act" aria-pressed={quick} onclick={() => (quick = !quick)}>Ввод</button>
    {/snippet}
    <TerminalTable
      rows={data.rows}
      {side}
      selectedCommodityId={selected}
      scope="gallery"
      onSelect={(id) => (selected = id)}
      onSavePrice={() => {}}
      onLookup={() => {}}
      onTrade={() => {}}
    />
  </Section>
</Frame>
<Frame name="scroll" caption="scroll: a section in a window that is too low keeps its header and scrolls its body (the box is 150 px high)" width={440}>
  <div class="box">
    <Section title="Терминал" summary={data.viewedName} open={true} onToggle={() => {}} scroll>
      <TerminalTable rows={data.rows} side="buy" selectedCommodityId={null} scope="gallery" onSelect={() => {}} onSavePrice={() => {}} onLookup={() => {}} onTrade={() => {}} />
    </Section>
  </div>
</Frame>

<style>
  .box {
    display: flex;
    flex-direction: column;
    height: 150px;
  }
</style>
