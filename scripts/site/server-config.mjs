// What the web server is told about the site: the Content-Security-Policy header. The rest of the server's config is
// the template site/deploy/Caddyfile.template, which the build fills in.
import { createHash } from 'node:crypto';

/**
 * The source a policy takes for one inline style sheet: the hash of its text, exactly as it stands between the tags.
 * @param {string} css
 */
export function styleHash(css) {
  return `'sha256-${createHash('sha256').update(css, 'utf8').digest('base64')}'`;
}

/**
 * The pages load only what the site itself serves. The domains of Google Analytics are named only when an id is set:
 * with an empty id the policy forbids them like everything else.
 * @param {{ ga4Id: string, styleHashes: string[] }} options `styleHashes`: inline style sheets allowed by hash (the 404 page)
 */
export function contentSecurityPolicy({ ga4Id, styleHashes }) {
  const analytics = ga4Id !== '';
  /** @type {Array<[string, string[]]>} */
  const directives = [
    ['default-src', ["'none'"]],
    ['script-src', ["'self'", ...(analytics ? ['https://*.googletagmanager.com'] : [])]],
    ['style-src', ["'self'", ...styleHashes]],
    ['img-src', ["'self'", ...(analytics ? ['https://*.google-analytics.com', 'https://*.googletagmanager.com'] : [])]],
    ['media-src', ["'self'"]],
    ['connect-src', ["'self'", ...(analytics ? ['https://*.google-analytics.com', 'https://*.analytics.google.com', 'https://*.googletagmanager.com'] : [])]],
    ['form-action', ["'self'"]],
    ['base-uri', ["'none'"]],
    ['frame-ancestors', ["'none'"]],
  ];
  return directives.map(([name, sources]) => `${name} ${sources.join(' ')}`).join('; ');
}
