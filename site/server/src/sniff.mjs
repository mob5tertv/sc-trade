// What a file is, told from its content. The name a sender gave it and the type the sender declared say nothing:
// both are whatever the sender typed.

/** The kinds of file the service keeps, by the extension it gives them, with the type each is served with. */
export const MIME = Object.freeze({
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  txt: 'text/plain; charset=utf-8',
});

/** @typedef {keyof typeof MIME} Kind */

/** How many bytes from the start of a file are needed to tell a picture. */
export const IMAGE_HEAD_BYTES = 12;

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff]);
const RIFF = Buffer.from('RIFF', 'latin1');
const WEBP = Buffer.from('WEBP', 'latin1');

/** @param {Buffer} bytes @param {Buffer} mark @param {number} at */
const has = (bytes, mark, at) => bytes.length >= at + mark.length && bytes.compare(mark, 0, mark.length, at, at + mark.length) === 0;

/**
 * The kind of picture a file is, by the signature it begins with; `null`: none of the three the form takes.
 * @param {Buffer} head the first bytes of the file (IMAGE_HEAD_BYTES are enough)
 * @returns {'png' | 'jpg' | 'webp' | null}
 */
export function imageType(head) {
  if (has(head, PNG, 0)) return 'png';
  if (has(head, JPEG, 0)) return 'jpg';
  if (has(head, RIFF, 0) && has(head, WEBP, 8)) return 'webp';
  return null;
}

/**
 * Judges a text as it arrives, piece by piece: well-formed UTF-8 with no control character below the space but the
 * tab and the two ends of a line (a log of the application has no other; a file that is not text has many, the zero
 * byte first of all). `push` says `false` at the first byte that cannot be text; `end` says whether the text
 * stopped at the end of a character.
 * @returns {{ push: (chunk: Uint8Array) => boolean, end: () => boolean }}
 */
export function createTextChecker() {
  // how many bytes of the character being read are still to come, and what the next of them may be: the first byte
  // after E0, ED, F0 and F4 has a narrower range (no character written longer than it is, no half of a pair, nothing
  // beyond the last character)
  let need = 0;
  let lower = 0x80;
  let upper = 0xbf;
  return {
    push(chunk) {
      for (let at = 0; at < chunk.length; at++) {
        const byte = chunk[at];
        if (need > 0) {
          if (byte < lower || byte > upper) return false;
          lower = 0x80;
          upper = 0xbf;
          need--;
        } else if (byte < 0x80) {
          if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) return false;
        } else if (byte >= 0xc2 && byte <= 0xdf) {
          need = 1;
        } else if (byte >= 0xe0 && byte <= 0xef) {
          need = 2;
          if (byte === 0xe0) lower = 0xa0;
          if (byte === 0xed) upper = 0x9f;
        } else if (byte >= 0xf0 && byte <= 0xf4) {
          need = 3;
          if (byte === 0xf0) lower = 0x90;
          if (byte === 0xf4) upper = 0x8f;
        } else {
          return false;
        }
      }
      return true;
    },
    end: () => need === 0,
  };
}
