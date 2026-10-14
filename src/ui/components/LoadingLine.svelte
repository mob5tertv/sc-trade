<script lang="ts">
  // A line that says something is on its way, with three dots that light up in turn. A system that asks for less motion gets the
  // dots still.
  let { text }: { text: string } = $props();
</script>

<span class="loading" role="status">
  {text}<span class="dots" aria-hidden="true"><span>.</span><span>.</span><span>.</span></span>
</span>

<style>
  .loading {
    color: var(--sc-muted);
  }

  .dots span {
    animation: sc-loading-dot 1.2s infinite;
    opacity: 0.25;
  }

  .dots span:nth-child(2) {
    animation-delay: 0.2s;
  }

  .dots span:nth-child(3) {
    animation-delay: 0.4s;
  }

  @keyframes sc-loading-dot {
    0%, 60%, 100% { opacity: 0.25; }
    30% { opacity: 1; }
  }

  @media (prefers-reduced-motion: reduce) {
    .dots span {
      animation: none;
      opacity: 1;
    }
  }
</style>
