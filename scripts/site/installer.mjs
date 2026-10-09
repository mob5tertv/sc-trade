// The installer the site hands out: what the pages say about it (name, size, SHA-256) is read from the file itself.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename } from 'node:path';

/**
 * @typedef {{ source: string, fileName: string, size: number, sha256: string }} InstallerInfo
 *   `source` is the file as Tauri named it; `fileName` is the name the site gives it (no spaces)
 */

/**
 * @param {string} file the installer, as `npm run tauri build` wrote it
 * @param {string} version the version of package.json
 * @returns {InstallerInfo}
 */
export function installerInfo(file, version) {
  if (!existsSync(file) || !statSync(file).isFile()) throw new Error(`the installer ${file} does not exist`);
  const name = basename(file);
  // the version must stand in the name as a whole: "1.1.0" is not in "11.1.0" and not in "1.1.01"
  const escaped = version.replaceAll('.', '\\.');
  if (!new RegExp(`(^|[^0-9.])${escaped}([^0-9.]|\\.[^0-9]|$)`).test(name)) {
    throw new Error(`the installer "${name}" is not version ${version} (package.json)`);
  }
  const bytes = readFileSync(file);
  return { source: file, fileName: `SC-Trade-${version}-setup.exe`, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}

/**
 * A size a person reads: megabytes with one digit after the point, kilobytes and bytes whole.
 * @param {number} bytes
 * @param {string} lang
 * @param {{ mb: string, kb: string, b: string }} units the words of the language
 */
export function formatSize(bytes, lang, units) {
  const number = (/** @type {number} */ value, /** @type {number} */ digits) =>
    new Intl.NumberFormat(lang, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
  if (bytes >= 1024 * 1024) return `${number(bytes / (1024 * 1024), 1)} ${units.mb}`;
  if (bytes >= 1024) return `${number(Math.round(bytes / 1024), 0)} ${units.kb}`;
  return `${number(bytes, 0)} ${units.b}`;
}
