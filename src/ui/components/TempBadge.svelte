<script lang="ts">
  import type { Temp } from '../../core/types';

  type Kind = Temp | 'uex';
  let { text, kind }: { text: string; kind: Kind } = $props();

  // The colour is not the only carrier of the meaning: the text says whose price it is and how old.
  const TITLES: Record<Kind, string> = {
    hot: 'Моя цена, горячая',
    warm: 'Моя цена, тёплая',
    cooling: 'Моя цена, остывает',
    cold: 'Моя цена, холодная',
    uex: 'Данные UEX',
  };
</script>

<span class="badge {kind}" title={TITLES[kind]}>{text}</span>

<style>
  .badge {
    display: inline-block;
    max-width: 100%;
    box-sizing: border-box;
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
