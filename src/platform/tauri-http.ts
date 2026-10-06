import { fetch } from '@tauri-apps/plugin-http';
import type { FetchJson } from '../data/uex-client';

const TIMEOUT_MS = 30_000;

/**
 * Transport for the UEX client: a GET through `tauri-plugin-http` (the request is made by
 * Rust, so CORS does not apply). One 30 s deadline covers the connection and reading the body.
 * A body that is not JSON is returned as a string, so the client can report it as a shape error.
 */
export const tauriFetchJson: FetchJson = async (url) => {
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  try {
    const response = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' }, signal });
    const raw = await response.text();
    try {
      return { status: response.status, body: JSON.parse(raw) as unknown };
    } catch {
      return { status: response.status, body: raw };
    }
  } catch (err) {
    // The plugin reports an aborted request as a generic "Request cancelled".
    if (signal.aborted) throw new Error(`timed out after ${TIMEOUT_MS / 1000} s`, { cause: err });
    throw err;
  }
};
