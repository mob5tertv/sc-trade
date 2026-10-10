// Small things every part of the service needs to answer a request.

/** @typedef {import('node:http').IncomingMessage} Request */
/** @typedef {import('node:http').ServerResponse} Response */

/** After an answer that came before the end of the body, no more than this much of the rest is thrown away. */
const LINGER_BYTES = 8 * 1024 * 1024;

/**
 * The address a request asks for, as it was written: the path and the query. Nothing is decoded: a path is only
 * ever compared with the paths the service has.
 * @param {string | undefined} url
 * @returns {{ path: string, query: string }}
 */
export function splitUrl(url) {
  const whole = url ?? '/';
  const mark = whole.indexOf('?');
  return mark === -1 ? { path: whole, query: '' } : { path: whole.slice(0, mark), query: whole.slice(mark + 1) };
}

/**
 * Sends an answer, whole and at once — also when the sender has not finished sending.
 *
 * An answer may be decided long before the end of a body: the body is too big, the sender writes too often. Closing
 * the exchange at that moment would cut the line under a sender that is still writing, and a line cut with unread
 * bytes on it is reset: the sender would lose the very answer. So the answer goes out now, and the exchange is
 * closed when the rest of the body has arrived and been thrown away. A sender that does not stop is not waited for:
 * after `lingerMs`, or a few megabytes, the line is cut.
 * @param {Request} req
 * @param {Response} res
 * @param {number} lingerMs
 * @param {number} status
 * @param {Record<string, string>} headers
 * @param {string | Buffer} [body]
 */
export function answer(req, res, lingerMs, status, headers, body = '') {
  res.writeHead(status, { ...headers, 'Content-Length': String(Buffer.byteLength(body)) });
  if (body.length > 0) res.write(body);
  else res.flushHeaders();
  if (req.complete) return void res.end();

  let discarded = 0;
  const cut = () => req.destroy();
  const timer = setTimeout(cut, lingerMs);
  req.on('data', (chunk) => {
    discarded += chunk.length;
    if (discarded > LINGER_BYTES) cut();
  });
  req.on('end', () => {
    clearTimeout(timer);
    res.end();
  });
  req.on('close', () => clearTimeout(timer));
  req.resume();
}

/** What an answer in JSON carries: no browser keeps it or guesses it to be of another type. */
export const JSON_HEADERS = Object.freeze({
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
});

/**
 * What an error is called in the log of the service: the code the system gave it, or its kind. Never its message —
 * a message may repeat what a sender sent.
 * @param {unknown} err
 * @returns {string}
 */
export function errorWord(err) {
  const code = /** @type {{ code?: unknown } | null | undefined} */ (err)?.code;
  if (typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,40}$/.test(code)) return code;
  const name = err instanceof Error ? err.name : '';
  return /^[A-Za-z]{1,40}$/.test(name) ? name : 'error';
}
