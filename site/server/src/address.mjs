// Where a request came from. The service listens on the server itself only, so every request reaches it through the
// web server in front (Caddy), which writes the address of the sender at the end of X-Forwarded-For. Whatever stands
// before that last entry was written by the sender and is not believed.
import { isIPv4, isIPv6 } from 'node:net';

/** @param {string} group a group of an IPv6 address, or an IPv4 address at its end @returns {number[]} 16-bit numbers */
function groupsOf(group) {
  if (!group.includes('.')) return [parseInt(group, 16)];
  const [a, b, c, d] = group.split('.').map(Number);
  return [a * 256 + b, c * 256 + d];
}

/** @param {string} text an IPv6 address Node takes for one, without a zone @returns {number[]} its eight groups */
function ipv6Groups(text) {
  const gap = text.indexOf('::');
  const part = (/** @type {string} */ side) => (side === '' ? [] : side.split(':').flatMap(groupsOf));
  if (gap === -1) return part(text);
  const head = part(text.slice(0, gap));
  const tail = part(text.slice(gap + 2));
  return [...head, ...new Array(Math.max(0, 8 - head.length - tail.length)).fill(0), ...tail];
}

/**
 * The address of the sender as the limiter counts it: an IPv4 address whole; an IPv6 address by its first 64 bits (a
 * provider gives a customer at least that many, so the rest is the sender's to change at will). Nothing at all
 * (`''`) when the header is missing or its last entry is not an address: such requests are counted as one sender.
 * @param {string | string[] | undefined} header the X-Forwarded-For of the request
 * @returns {string}
 */
export function clientAddress(header) {
  const list = Array.isArray(header) ? header.join(',') : header;
  if (typeof list !== 'string') return '';
  const last = (list.split(',').pop() ?? '').trim();
  if (isIPv4(last)) return last;
  const zone = last.indexOf('%');
  const plain = zone === -1 ? last : last.slice(0, zone);
  if (!isIPv6(plain)) return '';
  const groups = ipv6Groups(plain);
  if (groups.length !== 8) return '';
  // an IPv4 address written as IPv6 (::ffff:a.b.c.d)
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    return `${groups[6] >> 8}.${groups[6] & 0xff}.${groups[7] >> 8}.${groups[7] & 0xff}`;
  }
  return `${groups.slice(0, 4).map((group) => group.toString(16)).join(':')}::/64`;
}
