// A small client of the Chrome DevTools protocol over the WebSocket that comes with Node. Enough for the
// screenshot script: send a command and wait for its answer, listen to events.

/**
 * @typedef {{
 *   send: (method: string, params?: object) => Promise<any>,
 *   on: (method: string, handler: (params: any) => void) => void,
 *   close: () => void,
 * }} Cdp
 */

/**
 * @param {string} url the `ws://` address of a target or of the browser
 * @returns {Promise<Cdp>}
 */
export async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', () => resolve(undefined), { once: true });
    socket.addEventListener('error', () => reject(new Error(`cannot connect to the browser at ${url}`)), { once: true });
  });

  let nextId = 1;
  /** @type {Map<number, { resolve: (value: any) => void, reject: (error: Error) => void, method: string }>} */
  const pending = new Map();
  /** @type {Map<string, Array<(params: any) => void>>} */
  const listeners = new Map();

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id !== undefined) {
      const call = pending.get(message.id);
      if (call === undefined) return;
      pending.delete(message.id);
      if (message.error) call.reject(new Error(`${call.method}: ${message.error.message}`));
      else call.resolve(message.result);
      return;
    }
    for (const handler of listeners.get(message.method) ?? []) handler(message.params);
  });
  socket.addEventListener('close', () => {
    for (const call of pending.values()) call.reject(new Error(`${call.method}: the browser closed the connection`));
    pending.clear();
  });

  return {
    send: (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject, method });
        socket.send(JSON.stringify({ id, method, params }));
      }),
    on(method, handler) {
      const list = listeners.get(method) ?? [];
      list.push(handler);
      listeners.set(method, list);
    },
    close: () => socket.close(),
  };
}
