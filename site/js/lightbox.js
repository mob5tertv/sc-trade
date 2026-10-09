// A picture of the gallery opened larger, in a <dialog>: Esc closes it and the focus stays inside (the browser does
// both), the arrows go to the neighbouring picture, a click beside the picture closes. Without a script, or in a
// browser without <dialog>, the link simply opens the picture file.

function startLightbox() {
  const dialog = /** @type {HTMLDialogElement | null} */ (document.querySelector('[data-lightbox]'));
  const links = /** @type {HTMLAnchorElement[]} */ (Array.from(document.querySelectorAll('[data-gallery] a[data-full]')));
  if (dialog === null || links.length === 0 || typeof dialog.showModal !== 'function') return;

  const image = /** @type {HTMLImageElement} */ (dialog.querySelector('[data-lightbox-image]'));
  const caption = /** @type {HTMLElement} */ (dialog.querySelector('[data-lightbox-caption]'));
  let current = 0;
  /** @type {HTMLElement | null} */
  let opener = null;

  const show = (/** @type {number} */ index) => {
    current = (index + links.length) % links.length;
    const link = links[current];
    image.src = link.href;
    image.width = Number(link.getAttribute('data-width'));
    image.height = Number(link.getAttribute('data-height'));
    image.alt = link.querySelector('img')?.alt ?? '';
    caption.textContent = link.getAttribute('data-caption') ?? '';
  };

  links.forEach((link, index) => {
    link.addEventListener('click', (event) => {
      // a click that asks for a new tab or a new window is the visitor's own choice
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      opener = link;
      show(index);
      dialog.showModal();
    });
  });

  dialog.querySelector('[data-lightbox-close]')?.addEventListener('click', () => dialog.close());
  dialog.querySelector('[data-lightbox-prev]')?.addEventListener('click', () => show(current - 1));
  dialog.querySelector('[data-lightbox-next]')?.addEventListener('click', () => show(current + 1));
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') show(current - 1);
    if (event.key === 'ArrowRight') show(current + 1);
  });
  // the dialog itself is what a click on the dimmed page around the picture lands on
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', () => {
    opener?.focus();
    opener = null;
  });
}

startLightbox();
