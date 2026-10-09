import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadConfig, siteDir } from '../../scripts/site/config.mjs';
import { contentSecurityPolicy, styleHash } from '../../scripts/site/server-config.mjs';
import { LIMITS } from '../../site/js/feedback-rules.js';
import { build, type Built } from './helpers';

const config = loadConfig(siteDir);

/** The directives of a policy by name. */
const directives = (policy: string) => Object.fromEntries(policy.split(';').map((part) => part.trim().split(/\s+/)).map(([name, ...values]) => [name, values]));

describe('the Content-Security-Policy', () => {
  it('lets the pages load only what the site itself serves', () => {
    const policy = directives(contentSecurityPolicy({ ga4Id: '', styleHashes: [] }));
    expect(policy['default-src']).toEqual(["'none'"]);
    expect(policy['script-src']).toEqual(["'self'"]);
    expect(policy['style-src']).toEqual(["'self'"]);
    expect(policy['img-src']).toEqual(["'self'"]);
    expect(policy['media-src']).toEqual(["'self'"]);
    expect(policy['connect-src']).toEqual(["'self'"]);
    expect(policy['form-action']).toEqual(["'self'"]);
    expect(policy['base-uri']).toEqual(["'none'"]);
    expect(policy['frame-ancestors']).toEqual(["'none'"]);
  });

  it('never allows inline scripts, inline styles or eval', () => {
    for (const ga4Id of ['', 'G-TEST123456']) expect(contentSecurityPolicy({ ga4Id, styleHashes: ["'sha256-abc='"] })).not.toMatch(/unsafe/);
  });

  it('names the domains of Google only when a GA4 id is set', () => {
    expect(contentSecurityPolicy({ ga4Id: '', styleHashes: [] })).not.toMatch(/google/i);
    const policy = directives(contentSecurityPolicy({ ga4Id: 'G-TEST123456', styleHashes: [] }));
    expect(policy['script-src']).toEqual(["'self'", 'https://*.googletagmanager.com']);
    expect(policy['connect-src']).toEqual(["'self'", 'https://*.google-analytics.com', 'https://*.analytics.google.com', 'https://*.googletagmanager.com']);
    expect(policy['img-src']).toEqual(["'self'", 'https://*.google-analytics.com', 'https://*.googletagmanager.com']);
    // nothing else changes
    expect(policy['style-src']).toEqual(["'self'"]);
    expect(policy['default-src']).toEqual(["'none'"]);
  });

  it('allows one inline style sheet by its hash', () => {
    const css = 'body { margin: 0 }';
    expect(styleHash(css)).toBe(`'sha256-${createHash('sha256').update(css, 'utf8').digest('base64')}'`);
    expect(directives(contentSecurityPolicy({ ga4Id: '', styleHashes: [styleHash(css)] }))['style-src']).toEqual(["'self'", styleHash(css)]);
  });
});

describe('the Caddyfile the build writes', () => {
  let site: Built;
  let caddyfile: string;
  beforeAll(() => {
    site = build();
    caddyfile = site.caddyfile;
  });

  it('serves the domain of the settings from the folder of the site, compressed', () => {
    expect(caddyfile).toMatch(new RegExp(`^${config.domain.replaceAll('.', '\\.')} \\{$`, 'm'));
    expect(caddyfile).toMatch(/^\troot \* \/var\/www\/sc-trade\.space$/m);
    expect(caddyfile).toMatch(/^\tencode zstd gzip$/m);
    expect(caddyfile).toMatch(/^\t\tfile_server$/m);
  });

  it('leaves nothing of the template unfilled and closes every block it opens', () => {
    expect(caddyfile).not.toMatch(/\{\{|\}\}/);
    let depth = 0;
    for (const line of caddyfile.split('\n').filter((row) => !row.trim().startsWith('#'))) {
      // the braces of placeholders ({http.error.status_code}) stand inside a line; a block opens and closes at its end
      if (line.trimEnd().endsWith('{')) depth++;
      if (line.trim() === '}') depth--;
      expect(depth).toBeGreaterThanOrEqual(0);
    }
    expect(depth).toBe(0);
  });

  it('sends the security headers with every answer, the error page too', () => {
    const headers = /^\(security\) \{\n([\s\S]*?)^\}/m.exec(caddyfile)?.[1] ?? '';
    expect(headers).toMatch(/^\t\tContent-Security-Policy "default-src 'none'; [^"]*"$/m);
    expect(headers).toMatch(/^\t\tX-Content-Type-Options "nosniff"$/m);
    expect(headers).toMatch(/^\t\tReferrer-Policy "strict-origin-when-cross-origin"$/m);
    expect(headers).toMatch(/^\t\tX-Frame-Options "DENY"$/m);
    expect(headers).toMatch(/^\t\tStrict-Transport-Security "max-age=\d{7,}"$/m);
    expect(headers).toContain("frame-ancestors 'none'");
    // once for the site and once for the pages of errors
    expect(caddyfile.match(/^\t+import security$/gm)).toHaveLength(2);
  });

  it('carries the very policy the build made, with the hash of the styles of the 404 page', () => {
    const inline = /<style>([\s\S]*?)<\/style>/.exec(site.read('404.html'))?.[1] ?? '';
    expect(inline).not.toBe('');
    const policy = contentSecurityPolicy({ ga4Id: '', styleHashes: [styleHash(inline)] });
    expect(caddyfile).toContain(`Content-Security-Policy "${policy}"`);
    expect(policy).not.toContain('"');
  });

  it('names no domain of Google while ga4Id is empty, and names them when it is set', () => {
    expect(caddyfile).not.toMatch(/google/i);
    const withAnalytics = build({ patchConfig: (settings) => void (settings.analytics.ga4Id = 'G-TEST123456') }).caddyfile;
    expect(withAnalytics).toContain("script-src 'self' https://*.googletagmanager.com;");
    expect(withAnalytics).toContain('https://*.google-analytics.com');
  });

  it('lets browsers keep pictures, video, styles and scripts — but only an answer that is the file itself', () => {
    expect(caddyfile).toMatch(/^\t@assets path \/assets\/\*$/m);
    const block = /^\theader @assets \{\n([\s\S]*?)^\t\}/m.exec(caddyfile)?.[1] ?? '';
    expect(block).toMatch(/^\t\tCache-Control "public, max-age=\d{6,}"$/m);
    // set when the file server writes its answer: a 404 under /assets/ goes through the error pages and gets no long cache
    expect(block).toMatch(/^\t\tdefer$/m);
    expect(caddyfile).not.toMatch(/^\theader @assets Cache-Control/m);
  });

  it('makes browsers ask again for the pages and for the list of sums', () => {
    expect(caddyfile).toMatch(/^\t@pages path \/ \/en\/ \*\.html \/download\/SHA256SUMS\.txt$/m);
    expect(caddyfile).toMatch(/^\theader @pages Cache-Control "no-cache"$/m);
  });

  it('says that it must be checked by Caddy itself on the server before it is used', () => {
    expect(caddyfile).toMatch(/^#.*`caddy validate --config \/etc\/caddy\/Caddyfile`/m);
  });

  it('hands the installer over as a download, never as a page', () => {
    const block = /^\theader @installer \{\n([\s\S]*?)^\t\}/m.exec(caddyfile)?.[1] ?? '';
    expect(caddyfile).toMatch(/^\t@installer path \/download\/\*\.exe$/m);
    expect(block).toMatch(/^\t\tContent-Type "application\/octet-stream"$/m);
    expect(block).toMatch(/^\t\tContent-Disposition "attachment"$/m);
    // set when the answer is written, after the file server has put its own type
    expect(block).toMatch(/^\t\tdefer$/m);
  });

  it('passes /api and /admin, with and without anything after them, to the service on the server itself, and says that the service comes with the next task', () => {
    expect(caddyfile).toMatch(/^\t@service path \/api \/api\/\* \/admin \/admin\/\*$/m);
    const block = /^\thandle @service \{\n([\s\S]*?)^\t\}/m.exec(caddyfile)?.[1] ?? '';
    expect(block).toMatch(/^\t\treverse_proxy 127\.0\.0\.1:8787$/m);
    expect(caddyfile).toMatch(/#.*(task 53|next task)/i);
    expect(config.feedback.endpoint.startsWith('/api/')).toBe(true);
  });

  it('lets no request bigger than a full message reach the service: three pictures of 5 MB, a log of 2 MB, the text and the envelope', () => {
    const block = /^\thandle @service \{\n([\s\S]*?)^\t\}/m.exec(caddyfile)?.[1] ?? '';
    expect(block).toMatch(/^\t\trequest_body \{\n\t\t\tmax_size 24MB\n\t\t\}$/m);
    // the limit stands in front of the proxy
    expect(block.indexOf('request_body')).toBeLessThan(block.indexOf('reverse_proxy'));
    expect(3 * LIMITS.shotBytes + LIMITS.logBytes).toBeLessThan(24 * 1024 * 1024);
  });

  it("answers an address that does not exist with the site's own 404 page", () => {
    const errors = /^\thandle_errors \{\n([\s\S]*?)^\t\}/m.exec(caddyfile)?.[1] ?? '';
    expect(errors).toContain('expression {http.error.status_code} == 404');
    expect(errors).toMatch(/handle @notfound \{\n\t\t\trewrite \* \/404\.html\n\t\t\tfile_server\n\t\t\}/);
    // any other error (the service is down) is answered with its own number, not with a page that is not there
    expect(errors).toContain('respond "{http.error.status_code} {http.error.status_text}"');
    expect(site.files).toContain('404.html');
  });

  it('serves no file whose name starts with a dot', () => {
    expect(caddyfile).toMatch(/^\t@dotfiles path \*\/\.\*$/m);
    expect(caddyfile).toMatch(/^\thandle @dotfiles \{\n\t\terror 404\n\t\}$/m);
    expect(site.files.filter((file) => file.split('/').some((part) => part.startsWith('.')))).toEqual([]);
  });
});
