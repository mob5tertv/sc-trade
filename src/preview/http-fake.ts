// A network the scene can answer from. By default the preview has none (`ipc.ts`: UEX is unreachable at once); a scene
// that wants to show a request on its way, or its answer, puts a `FakeUex` in with `installHttpFake`, and from then on
// every request of the application goes through it, the way the commands of `tauri-plugin-http` go through Rust.
// Nothing here is part of the production build: only the preview loads it.

/** What UEX answers: the HTTP status and the JSON body (the envelope `{ status, data }` is the scene's to write). */
export interface FakeAnswer {
  status: number;
  body: unknown;
}

/**
 * The scene's answer to a request, by its URL. It may take as long as the scene wants (a request that waits is a request
 * on its way) and may throw (the network failed).
 */
export type FakeUex = (url: string) => Promise<FakeAnswer> | FakeAnswer;

/** The `plugin:http|…` commands that `fetch` of `@tauri-apps/plugin-http` sends, answered from a `FakeUex`. */
export interface FakeHttp {
  handles(name: string): boolean;
  command(name: string, args: Record<string, unknown>): Promise<unknown>;
}

const COMMANDS = ['fetch', 'fetch_send', 'fetch_read_body', 'fetch_cancel', 'fetch_cancel_body'];
/** The last byte of a chunk that `fetch_read_body` returns: 0 = there is more, 1 = the body is over. */
const MORE = 0;
const END = 1;

interface Pending {
  url: string;
  /** Rejects the `fetch_send` that is waiting for the scene's answer. */
  cancel?: (reason: Error) => void;
  cancelled: boolean;
}

const rid = (args: Record<string, unknown>): number => Number(args.rid);

/** The protocol of `plugin:http` in the shape the page sees it: `fetch` → resource id, `fetch_send` → the head of the response, `fetch_read_body` → chunks. */
export function createFakeHttp(answer: FakeUex): FakeHttp {
  let nextId = 1;
  const requests = new Map<number, Pending>();
  /** The chunks of a response that are not read yet. */
  const bodies = new Map<number, number[][]>();

  async function send(id: number): Promise<unknown> {
    const request = requests.get(id);
    if (request === undefined) throw new Error(`no such request: ${id}`);
    const cancelled = new Promise<never>((_, reject) => {
      request.cancel = reject;
    });
    if (request.cancelled) throw new Error('Request cancelled');
    const reply = await Promise.race([Promise.resolve(answer(request.url)), cancelled]);
    const bodyId = nextId++;
    bodies.set(bodyId, [[...new TextEncoder().encode(JSON.stringify(reply.body)), MORE], [END]]);
    return { status: reply.status, statusText: '', url: request.url, headers: [['content-type', 'application/json']], rid: bodyId };
  }

  return {
    handles: (name) => COMMANDS.includes(name),
    async command(name, args) {
      switch (name) {
        case 'fetch': {
          const id = nextId++;
          requests.set(id, { url: String((args.clientConfig as { url?: unknown } | undefined)?.url ?? ''), cancelled: false });
          return id;
        }
        case 'fetch_send':
          return send(rid(args));
        case 'fetch_read_body':
          return bodies.get(rid(args))?.shift() ?? [END];
        case 'fetch_cancel': {
          const request = requests.get(rid(args));
          if (request !== undefined) {
            request.cancelled = true;
            request.cancel?.(new Error('Request cancelled'));
          }
          return null;
        }
        default: // fetch_cancel_body
          bodies.delete(rid(args));
          return null;
      }
    },
  };
}

let installed: FakeHttp | null = null;

/** Puts the scene's network in place (`null` takes it away again: the preview has no network, as it had). */
export function installHttpFake(answer: FakeUex | null): void {
  installed = answer === null ? null : createFakeHttp(answer);
}

/** The network of the scene, or `null` when there is none: `ipc.ts` asks for it at every request. */
export const currentHttpFake = (): FakeHttp | null => installed;
