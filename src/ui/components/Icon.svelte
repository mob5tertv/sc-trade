<script lang="ts" module>
  // The small line icons of the buttons of the window: one stroke, no fill, the colour of the text around them.
  export type IconName = 'lock' | 'unlock' | 'gear' | 'minus' | 'back' | 'swap' | 'cross' | 'search' | 'book' | 'crate';
</script>

<script lang="ts">
  interface Props {
    name: IconName;
    /** Size in px (the icon is square). */
    size?: number;
  }
  let { name, size = 14 }: Props = $props();

  // drawn on a 16 x 16 grid
  const PATHS: Record<IconName, string[]> = {
    lock: ['M3.5 7.5h9v6.5h-9z', 'M5.5 7.5V5.2a2.5 2.5 0 0 1 5 0v2.3'],
    unlock: ['M3.5 7.5h9v6.5h-9z', 'M5.5 7.5V5.2a2.5 2.5 0 0 1 4.8-1'],
    // a cog with eight teeth and a hole
    gear: [
      'M12.97 6.48L14.8 6.8V9.2L12.97 9.52L12.59 10.44L13.65 11.96L11.96 13.65L10.44 12.59L9.52 12.97L9.2 14.8H6.8L6.48 12.97L5.56 12.59L4.04 13.65L2.35 11.96L3.41 10.44L3.03 9.52L1.2 9.2V6.8L3.03 6.48L3.41 5.56L2.35 4.04L4.04 2.35L5.56 3.41L6.48 3.03L6.8 1.2H9.2L9.52 3.03L10.44 3.41L11.96 2.35L13.65 4.04L12.59 5.56z',
      'M8 5.9a2.1 2.1 0 1 0 0 4.2 2.1 2.1 0 0 0 0-4.2z',
    ],
    minus: ['M3.5 11.5h9'],
    back: ['M13 8H3.2', 'M7 4 3 8l4 4'],
    // two arrows in opposite directions: the server has been changed
    swap: ['M2.5 5.5h10', 'M10 3l2.5 2.5L10 8', 'M13.5 10.5h-10', 'M6 8l-2.5 2.5L6 13'],
    cross: ['M3.5 3.5l9 9M12.5 3.5l-9 9'],
    // a magnifier: the search over all the commodities of a terminal
    search: ['M6.8 2.5a4.3 4.3 0 1 0 0 8.6 4.3 4.3 0 0 0 0-8.6z', 'M10 10l4 4'],
    // an open book: the commodity reference
    book: ['M8 4.2C6.6 3.2 4.6 2.9 2.5 3.2v9c2.1-.3 4.1 0 5.5 1 1.4-1 3.4-1.3 5.5-1v-9c-2.1-.3-4.1 0-5.5 1z', 'M8 4.2v9'],
    // a crate: the storage at the stations (version 1.4)
    crate: ['M2.5 5l5.5-2.5L13.5 5v6.5L8 14l-5.5-2.5z', 'M2.5 5L8 7.5 13.5 5', 'M8 7.5V14'],
  };
</script>

<svg class="icon" viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
  {#each PATHS[name] as d, i (i)}<path {d} />{/each}
</svg>

<style>
  .icon {
    display: block;
    flex: none;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linecap: square;
    stroke-linejoin: miter;
  }
</style>
