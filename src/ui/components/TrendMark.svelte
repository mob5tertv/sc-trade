<script lang="ts">
  import type { PriceTrend } from '../vm/price-trend';

  interface Props {
    /**
     * How my own price moved since my previous reading. `null` leaves the slot empty: it is as wide as the triangle,
     * so the numbers of a column keep their place whether or not a row has one.
     */
    trend: PriceTrend | null;
  }
  let { trend }: Props = $props();
</script>

<!-- The triangle points where the price went; its colour says whether that is good for the player. The hint tells the numbers. -->
{#if trend}
  <span
    class="slot {trend.dir}"
    class:good={trend.good}
    class:bad={!trend.good}
    role="img"
    aria-label={trend.dir === 'up' ? 'цена выросла' : 'цена упала'}
    title={trend.title}
  ><span class="tri"></span></span>
{:else}
  <span class="slot"></span>
{/if}

<style>
  .slot {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    align-self: stretch;
    width: var(--sc-trend-w);
  }

  .tri {
    width: var(--sc-trend-w);
    height: var(--sc-trend-h);
    background: var(--tri);
  }

  .up .tri { clip-path: polygon(50% 0, 100% 100%, 0 100%); }
  .down .tri { clip-path: polygon(0 0, 100% 0, 50% 100%); }

  .good { --tri: var(--sc-good); }
  .bad { --tri: var(--sc-bad); }
</style>
