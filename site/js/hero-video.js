// The background video of the first screen is for wide screens and for visitors who did not ask for less motion.
// The page says so three times: the sources of the video carry a media condition (a current browser then loads
// nothing), CSS never shows the video otherwise, and this script covers a browser that ignores the condition on a
// source: it takes the sources away, so the download stops and only the still frame is left.

const STILL_ONLY = '(max-width: 719.98px), (prefers-reduced-motion: reduce)';

function startHeroVideo() {
  const video = /** @type {HTMLVideoElement | null} */ (document.querySelector('[data-hero-video]'));
  if (video === null) return;
  const still = window.matchMedia(STILL_ONLY);
  const apply = () => {
    if (!still.matches) return;
    video.removeAttribute('autoplay');
    video.pause();
    for (const source of Array.from(video.querySelectorAll('source'))) source.remove();
    video.load();
  };
  apply();
  still.addEventListener('change', apply);
}

startHeroVideo();
