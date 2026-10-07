<script lang="ts">
  import type { Component } from 'svelte';
  import { provideGallery } from './context';
  import type { GalleryData } from './data';

  interface Props {
    data: GalleryData;
    page: Component;
    /** The one state to draw, or `null` for all of them. */
    only: string | null;
    /** What is under the glass: the game (`dark`, the field of the desktop page shows through) or a bright scene. */
    bg: 'dark' | 'light';
  }
  let { data, page: Page, only, bg }: Props = $props();

  // svelte-ignore state_referenced_locally
  provideGallery({ data, only });
</script>

<div class="gallery" class:light={bg === 'light'}>
  <Page />
</div>

<style>
  .gallery {
    --gallery-caption: #9fb7c2;
    position: absolute;
    top: 0;
    left: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: max-content;
  }

  /* a bright scene of the game under the glass: sky, a white wall, a dark hull; the glass has to hold its own on all of it */
  .gallery.light {
    --gallery-caption: #1f2d36;
    --gallery-caption-bg: rgb(255 255 255 / 0.78);
    padding: 12px;
    background:
      linear-gradient(100deg, #f7f9fb 0 22%, transparent 22% 100%),
      linear-gradient(80deg, transparent 0 62%, #223038 62% 74%, transparent 74% 100%),
      linear-gradient(170deg, #ffffff, #cfe3ee 45%, #f4e9c9 75%, #9fc0d3);
  }
</style>
