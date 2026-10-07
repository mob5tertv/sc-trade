import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The picture of the game under the overlay: the first PNG (by name) of `Screenshot/` in the project root, or of
 * the folder the environment variable `PREVIEW_BACKDROP_DIR` names. `null` when there is no such folder or picture:
 * the desktop page then draws its gradient. The pictures are the player's own: they are served by the dev server
 * only, from where they lie, and never copied.
 */
export function findBackdrop(projectRoot: string, env: Record<string, string | undefined> = process.env): string | null {
  const folder = env.PREVIEW_BACKDROP_DIR ? env.PREVIEW_BACKDROP_DIR : join(projectRoot, 'Screenshot');
  if (!existsSync(folder)) return null;
  const first = readdirSync(folder)
    .filter((name) => name.toLowerCase().endsWith('.png'))
    .sort((a, b) => a.localeCompare(b))[0];
  return first === undefined ? null : join(folder, first);
}
