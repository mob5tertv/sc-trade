// The pages of the author, as HTML. Russian, like the author.
//
// Everything a visitor sent — the text, the contact, the name of a file — and everything the author typed into the
// search reaches a page through `esc` and in no other way: it is shown as text, whatever it looks like. The pages
// have no script and no style of their own (the policy the web server puts on the site forbids both): one style
// sheet, /admin/assets/admin.css, and plain forms.

/** @typedef {import('./store.mjs').MessageRecord} MessageRecord */

const ENTITIES = /** @type {Record<string, string>} */ ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' });

/** A text as it stands in HTML, between tags or inside a quoted attribute. @param {unknown} value */
export function esc(value) {
  return String(value).replace(/[&<>"']/g, (char) => ENTITIES[char]);
}

/** How many characters of a message the list shows. */
const EXCERPT_CHARS = 200;

const LANGUAGES = /** @type {Record<string, string>} */ ({ ru: 'русский', en: 'английский', '': 'не указан' });

/** The moment a message came, for a person: 10.10.2026 12:00 UTC. @param {string} iso */
export function whenText(iso) {
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)} ${iso.slice(11, 16)} UTC`;
}

/** @param {number} bytes */
function sizeText(bytes) {
  if (bytes < 1024) return `${bytes} Б`;
  const comma = (/** @type {number} */ value) => value.toFixed(1).replace('.', ',');
  return bytes < 1024 * 1024 ? `${comma(bytes / 1024)} КБ` : `${comma(bytes / 1024 / 1024)} МБ`;
}

const time = (/** @type {string} */ iso) => `<time datetime="${esc(iso)}">${esc(whenText(iso))}</time>`;
const token = (/** @type {string} */ csrf) => `<input type="hidden" name="csrf" value="${esc(csrf)}">`;

/**
 * A whole page.
 * @param {{ title: string, body: string, csrf?: string }} page `csrf`: the token of the session; with it the page has the way out
 */
function layout({ title, body, csrf }) {
  const logout = csrf === undefined ? '' : `\n<form method="post" action="/admin/logout">${token(csrf)}<button type="submit">Выйти</button></form>`;
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)} — SC Trade</title>
<link rel="stylesheet" href="/admin/assets/admin.css">
</head>
<body>
<header class="top">
<a class="brand" href="/admin/">SC Trade — обращения</a>${logout}
</header>
<main>
${body}
</main>
</body>
</html>
`;
}

/** @param {{ error?: string }} page */
export function loginPage({ error }) {
  return layout({
    title: 'Вход',
    body: `<h1>Вход</h1>${error === undefined ? '' : `\n<p class="error" role="alert">${esc(error)}</p>`}
<form method="post" action="/admin/login" class="login">
<label for="password">Пароль</label>
<input id="password" type="password" name="password" autocomplete="current-password" required autofocus>
<button type="submit">Войти</button>
</form>`,
  });
}

/**
 * A page that says one thing: there is no such page, an action was refused.
 * @param {{ title: string, text: string, csrf?: string }} page
 */
export function notePage({ title, text, csrf }) {
  return layout({ title, csrf, body: `<h1>${esc(title)}</h1>\n<p>${esc(text)}</p>\n<p><a href="/admin/">К списку обращений</a></p>` });
}

/** The address of a page of the list. @param {string} q @param {number} page */
function listUrl(q, page) {
  const parts = [...(q === '' ? [] : [`q=${encodeURIComponent(q)}`]), ...(page === 1 ? [] : [`page=${page}`])];
  return `/admin/${parts.length === 0 ? '' : `?${parts.join('&')}`}`;
}

/**
 * @param {{
 *   csrf: string,
 *   q: string,
 *   page: number,
 *   pages: number,
 *   total: number,
 *   items: Array<{ record: MessageRecord, iso: string }>,
 *   storage?: { used: number, limit: number },
 * }} list `q`: the words of the search; `total`: how many messages there are, or how many were found; `storage`:
 *   given when the storage is nearly full — the list then says so at its top
 */
export function listPage({ csrf, q, page, pages, total, items, storage }) {
  const rows = items.map(({ record, iso }) => {
    const text = record.message.replace(/\s+/g, ' ');
    const chars = Array.from(text);
    const excerpt = chars.length > EXCERPT_CHARS ? `${chars.slice(0, EXCERPT_CHARS).join('')}…` : text;
    const who = record.contact === '' ? '<span class="who muted">без контакта</span>' : `<span class="who"><bdi>${esc(record.contact)}</bdi></span>`;
    const files = record.files.length === 0 ? '<span class="amount"></span>' : `<span class="amount">файлов: ${record.files.length}</span>`;
    const tick = `<input type="checkbox" name="id" value="${esc(record.id)}" aria-label="Отметить обращение от ${esc(whenText(iso))}">`;
    return `<li class="item">${tick}<a href="/admin/m/${esc(record.id)}"><span class="when">${time(iso)}</span>${who}${files}<span class="excerpt"><bdi>${esc(excerpt)}</bdi></span></a></li>`;
  });
  const nothing = q === '' ? 'Обращений пока нет.' : 'Ничего не найдено.';
  const prev = page > 1 ? `<a href="${esc(listUrl(q, page - 1))}" rel="prev">← Новее</a>` : '';
  const next = page < pages ? `<a href="${esc(listUrl(q, page + 1))}" rel="next">Старше →</a>` : '';
  const warning =
    storage === undefined
      ? ''
      : `\n<p class="warning" role="status">Хранилище заполнено на ${Math.floor((storage.used * 100) / storage.limit)} %: ${sizeText(storage.used)} из ${sizeText(storage.limit)}. Когда место кончится, форма сайта перестанет принимать сообщения: удали ненужные.</p>`;
  // the messages of the page, each with a box to tick, and one button for the ticked ones
  const ticked = `<form method="post" action="/admin/delete" class="bulk">
${token(csrf)}<input type="hidden" name="q" value="${esc(q)}">
<ol class="list">
${rows.join('\n')}
</ol>
<p class="bulk-actions"><label><input type="checkbox" name="confirm" value="yes" required> Удалить отмеченные навсегда, вместе с файлами</label><button type="submit" class="danger">Удалить отмеченные</button></p>
</form>`;
  // everything a search found: a link to the page that says how many and asks once more
  const found = q === '' || total === 0 ? '' : `\n<p class="bulk-found"><a href="/admin/delete-found?q=${esc(encodeURIComponent(q))}">Удалить всё найденное: ${total}</a></p>`;
  return layout({
    title: 'Обращения',
    csrf,
    body: `<h1>Обращения</h1>${warning}
<form method="get" action="/admin/" class="search" role="search">
<label for="q">Поиск по тексту, контакту, имени файла или дню (2026-10-10 или 10.10.2026, время — UTC)</label>
<input id="q" type="search" name="q" value="${esc(q)}" maxlength="100">
<button type="submit">Найти</button>
</form>
<p class="count">${q === '' ? 'Всего' : 'Найдено'}: ${total}</p>
${rows.length === 0 ? `<p class="empty">${nothing}</p>` : ticked}${found}
<nav class="pages" aria-label="Страницы">${prev}<span>Страница ${page} из ${pages}</span>${next}</nav>`,
  });
}

/**
 * The page that stands before the deleting of everything a search found: how many there are — of how many in all,
 * so that a search that finds every message is seen to do so — and one more question.
 * @param {{ csrf: string, q: string, count: number, total: number, changed: boolean }} ask `total`: how many messages
 *   there are; `changed`: the number is not the one the author was shown a moment ago
 */
export function deleteFoundPage({ csrf, q, count, total, changed }) {
  const back = `<p><a href="${esc(listUrl(q, 1))}">← К найденному</a></p>`;
  const words = `<p>Слова поиска: <bdi>${esc(q)}</bdi></p>`;
  if (count === 0) {
    return layout({
      title: 'Удаление найденного',
      csrf,
      body: `${back}\n<h1>Удаление найденного</h1>\n${words}\n<p class="empty">Ничего не найдено: удалять нечего. Всего обращений: ${total}.</p>`,
    });
  }
  const everything = count >= total ? '\n<p class="warning" role="alert">Поиск нашёл всё: это все обращения, какие есть. После удаления не останется ни одного.</p>' : '';
  return layout({
    title: 'Удаление найденного',
    csrf,
    body: `${back}
<h1>Удаление найденного</h1>${changed ? '\n<p class="error" role="alert">Пока ты смотрел, найденное изменилось. Проверь число и подтверди ещё раз.</p>' : ''}
${words}
<p>Найдено обращений: ${count} из ${total}. Они будут удалены навсегда, вместе с файлами. Вернуть их будет нельзя.</p>${everything}
<form method="post" action="/admin/delete-found" class="delete">
${token(csrf)}
<input type="hidden" name="q" value="${esc(q)}">
<input type="hidden" name="count" value="${count}">
<label><input type="checkbox" name="confirm" value="yes" required> Да, удалить все найденные обращения: ${count}</label>
<button type="submit" class="danger">Удалить найденное</button>
</form>`,
  });
}

/**
 * One message, whole.
 * @param {{ csrf: string, record: MessageRecord, iso: string }} view
 */
export function messagePage({ csrf, record, iso }) {
  const base = `/admin/m/${esc(record.id)}`;
  const files = record.files.map((file, index) => {
    const url = `${base}/file/${index + 1}`;
    const picture = file.kind === 'shot' ? `<a href="${url}"><img class="thumb" src="${url}" alt="" loading="lazy"></a>` : '';
    const name = file.name === '' ? '<span class="muted">без имени</span>' : `<bdi>${esc(file.name)}</bdi>`;
    return `<li>${picture}<a href="${url}" download>Скачать</a>${name}<span class="muted">${esc(file.type.split(';')[0])}, ${sizeText(file.bytes)}</span></li>`;
  });
  return layout({
    title: 'Обращение',
    csrf,
    body: `<p><a href="/admin/">← К списку</a></p>
<h1>Обращение</h1>
<dl class="facts">
<dt>Получено</dt><dd>${time(iso)}</dd>
<dt>Контакт</dt><dd>${record.contact === '' ? '<span class="muted">не указан</span>' : `<bdi>${esc(record.contact)}</bdi>`}</dd>
<dt>Язык страницы</dt><dd>${esc(LANGUAGES[record.lang] ?? LANGUAGES[''])}</dd>
</dl>
<h2>Текст</h2>
<pre class="message">${esc(record.message)}</pre>
<h2>Файлы</h2>
${files.length === 0 ? '<p class="muted">Файлов нет.</p>' : `<ul class="files">\n${files.join('\n')}\n</ul>`}
<h2>Удаление</h2>
<form method="post" action="${base}/delete" class="delete">
${token(csrf)}
<label><input type="checkbox" name="confirm" value="yes" required> Удалить это обращение и его файлы навсегда</label>
<button type="submit" class="danger">Удалить</button>
</form>`,
  });
}
