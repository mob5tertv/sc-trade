// The menu of a narrow screen opens and closes without a script (a checkbox and CSS). The script only tidies up:
// a click on a link of the menu, or Esc, closes it.

function startMenu() {
  const toggle = /** @type {HTMLInputElement | null} */ (document.getElementById('menu-toggle'));
  const nav = document.querySelector('.site-nav');
  if (toggle === null || nav === null) return;
  nav.addEventListener('click', (event) => {
    if (event.target instanceof Element && event.target.closest('a') !== null) toggle.checked = false;
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !toggle.checked) return;
    toggle.checked = false;
    toggle.focus();
  });
}

startMenu();
