<script lang="ts">
  import type { Temp } from '../../core/types';
  import { tr } from '../../i18n';

  type Kind = Temp | 'uex';
  interface Props {
    text: string;
    kind: Kind;
    /**
     * A square mark of 6 px in the colour of the freshness (data from UEX: an empty frame) with the whole text in its
     * `title`. It stands next to a number in a row; the full plaque is for the expanded row.
     */
    compact?: boolean;
  }
  let { text, kind, compact = false }: Props = $props();

  // The colour is not the only carrier of the meaning: the text says whose price it is and how old.
  const TITLES: Record<Kind, string> = {
    hot: tr('Моя цена, горячая'),
    warm: tr('Моя цена, тёплая'),
    cooling: tr('Моя цена, остывает'),
    cold: tr('Моя цена, холодная'),
    uex: tr('Данные UEX'),
  };
</script>

{#if compact}
  <span class="mark {kind}" role="img" aria-label={text} title={text}></span>
{:else}
  <span class="badge {kind}" title={TITLES[kind]}>{text}</span>
{/if}

<style>
  .mark {
    display: inline-block;
    flex: none;
    width: 6px;
    height: 6px;
    background: var(--badge);
    vertical-align: middle;
  }

  /* UEX data is nobody's reading of mine: an empty square */
  .mark.uex {
    border: 1px solid var(--badge);
    background: transparent;
  }

  .badge {
    display: inline-block;
    max-width: 100%;
    padding: 0 6px;
    border: 1px solid color-mix(in srgb, var(--badge) 55%, transparent);
    border-radius: var(--sc-radius);
    background: color-mix(in srgb, var(--badge) 14%, transparent);
    color: var(--badge);
    font-size: var(--sc-font-sm);
    line-height: 16px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    vertical-align: middle;
  }

  .hot { --badge: var(--sc-hot); }
  .warm { --badge: var(--sc-warm); }
  .cooling { --badge: var(--sc-cooling); }
  .cold,
  .uex { --badge: var(--sc-cold); }
</style>
