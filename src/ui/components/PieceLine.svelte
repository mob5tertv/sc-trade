<script lang="ts">
  import type { Piece } from '../vm/route-pieces';

  interface Props {
    /** The pieces of the line in order (`routePieces`, `titlePieces`). */
    pieces: Piece[];
  }
  let { pieces }: Props = $props();

  // A fixed piece takes its whole width; the others are tracks that grow to their text and no further, and when the line is too short they get
  // the room in equal shares (a grid hands out the free space equally and takes back from the pieces that do not need it): a short piece stays
  // whole and the long ones are cut, each with an ellipsis of its own.
  const columns = $derived(pieces.map((piece) => (piece.fixed ? 'max-content' : 'minmax(0, max-content)')).join(' '));
</script>

<span class="line" style:grid-template-columns={columns}>
  {#each pieces as piece, i (i)}
    <span class="piece">{piece.text}</span>
  {/each}
</span>

<style>
  .line {
    display: grid;
    justify-content: start;
    column-gap: 5px;
    min-width: 0;
    white-space: nowrap;
  }

  .piece {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
