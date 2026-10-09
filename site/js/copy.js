// The "copy" button of the SHA-256 sum. Without a script the button stays hidden and the sum is a text that one
// click selects whole (CSS `user-select: all`). When the browser refuses to copy, the sum is selected for the visitor
// and the page says so.

function startCopy() {
  const status = document.querySelector('[data-copy-status]');
  const source = document.querySelector('[data-copy-source]');

  /** @param {HTMLElement} button @param {boolean} copied */
  const say = (button, copied) => {
    if (status === null) return;
    status.textContent = button.getAttribute(copied ? 'data-copied' : 'data-copy-failed') ?? '';
    status.classList.toggle('is-failed', !copied);
  };

  /** The old way: select the text on the page and ask the browser to copy the selection. */
  const copySelection = () => {
    const selection = window.getSelection();
    if (source === null || selection === null) return false;
    const range = document.createRange();
    range.selectNodeContents(source);
    selection.removeAllRanges();
    selection.addRange(range);
    try {
      return document.execCommand('copy');
    } catch {
      return false;
    }
  };

  for (const button of /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('[data-copy]'))) {
    button.hidden = false;
    button.addEventListener('click', () => {
      const text = button.getAttribute('data-copy') ?? '';
      const fallback = () => say(button, copySelection());
      if (navigator.clipboard === undefined) return fallback();
      navigator.clipboard.writeText(text).then(() => say(button, true), fallback);
    });
  }
}

startCopy();
