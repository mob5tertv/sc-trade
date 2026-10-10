import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
    // with "sudo": run by anybody else, Caddy cannot open its log and refuses a file that is good
    expect(caddyfile).toMatch(/^#.*`sudo caddy validate --config \/etc\/caddy\/Caddyfile`/m);
    expect(caddyfile.split('\n').filter((line) => /caddy validate/.test(line) && !/sudo caddy validate/.test(line))).toEqual([]);
  });

  it('hands the installer over as a download, never as a page', () => {
    const block = /^\theader @installer \{\n([\s\S]*?)^\t\}/m.exec(caddyfile)?.[1] ?? '';
    expect(caddyfile).toMatch(/^\t@installer path \/download\/\*\.exe$/m);
    expect(block).toMatch(/^\t\tContent-Type "application\/octet-stream"$/m);
    expect(block).toMatch(/^\t\tContent-Disposition "attachment"$/m);
    // set when the answer is written, after the file server has put its own type
    expect(block).toMatch(/^\t\tdefer$/m);
  });

  it('passes /api and /admin, with and without anything after them, to the service on the server itself, and names the service', () => {
    expect(caddyfile).toMatch(/^\t@service path \/api \/api\/\* \/admin \/admin\/\*$/m);
    const block = /^\thandle @service \{\n([\s\S]*?)^\t\}/m.exec(caddyfile)?.[1] ?? '';
    expect(block).toMatch(/^\t\treverse_proxy 127\.0\.0\.1:8787$/m);
    expect(caddyfile).toMatch(/#.*systemctl status sc-trade-site/);
    // the file goes to the server of the user: it does not speak of the numbers of our tasks
    expect(caddyfile).not.toMatch(/task \d|next task/i);
    expect(config.feedback.endpoint.startsWith('/api/')).toBe(true);
  });

  it('lets the service answer for itself: nothing of the site is cached or served under /api and /admin', () => {
    // the matchers of the site name paths that the service does not have
    for (const line of caddyfile.split('\n').filter((row) => /^\t@(assets|pages|installer) /.test(row))) expect(line).not.toMatch(/\/admin|\/api/);
    // and the paths of the service's own pages do not look like a page of the site ("*.html") or a file of it
    const servicePaths = ['/admin/', '/admin/login', '/admin/logout', '/admin/assets/admin.css', `/admin/m/${'0'.repeat(32)}`, `/admin/m/${'0'.repeat(32)}/file/1`, `/admin/m/${'0'.repeat(32)}/delete`, '/api/feedback', '/api/'];
    for (const path of servicePaths) {
      expect(path).not.toMatch(/\.html$|\.exe$|^\/assets\/|\/\./);
    }
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

// «О данных»: "в журнале ошибок сервера — до 30 дней". The web server writes errors only, into a file of its own,
// without the headers of the request; the file is turned over every day and a part of it lives 29 days at the most.
describe('the log of the web server', () => {
  let caddyfile: string;
  const rotation = readFileSync(join(siteDir, 'deploy', 'logrotate.conf'), 'utf8').replaceAll('\r\n', '\n');
  const rules = rotation.split('\n').filter((line) => !line.startsWith('#'));
  beforeAll(() => {
    caddyfile = build().caddyfile;
  });

  /** The global options: the first block of a Caddyfile, a block without a name. */
  const options = () => /^\{\n([\s\S]*?)^\}\n/m.exec(caddyfile)?.[1] ?? '';

  it('is set in the global options, which stand before every site of the file', () => {
    expect(options()).not.toBe('');
    const firstBlock = caddyfile.split('\n').find((line) => !line.startsWith('#') && line.trim() !== '');
    expect(firstBlock).toBe('{');
    expect(caddyfile.indexOf('\n{\n')).toBeLessThan(caddyfile.indexOf('\n(security) {'));
  });

  it('takes errors only, into a file of its own', () => {
    const log = /^\tlog \{\n([\s\S]*?)^\t\}/m.exec(options())?.[1] ?? '';
    expect(log).toMatch(/^\t\toutput file \/var\/log\/caddy\/sc-trade-error\.log \{\n\t\t\troll_disabled\n\t\t\}$/m);
    expect(log).toMatch(/^\t\tlevel ERROR$/m);
    // one log, one place: nothing goes to another file or to another machine
    expect(options().match(/^\tlog\b/gm)).toHaveLength(1);
    expect(log.match(/^\t\toutput /gm)).toHaveLength(1);
    expect(log).not.toMatch(/output (net|stdout|stderr|discard)/);
  });

  it('leaves the headers of a request out of what it writes: the address stays, as the page about data says', () => {
    const log = /^\tlog \{\n([\s\S]*?)^\t\}/m.exec(options())?.[1] ?? '';
    expect(log).toMatch(/^\t\tformat filter \{\n\t\t\twrap json\n\t\t\tfields \{\n\t\t\t\trequest>headers delete\n\t\t\t\}\n\t\t\}$/m);
    expect(log).not.toMatch(/remote_ip|client_ip/);
  });

  it('is no access log: no site of the file writes down who opened what', () => {
    // a "log" inside a site block would be an access log; the only one stands in the global options
    expect(caddyfile.match(/^\t+log\b/gm)).toHaveLength(1);
    const site = caddyfile.slice(caddyfile.indexOf('\nsc-trade.space {'));
    expect(site).not.toMatch(/^\t*log\b/m);
    expect(caddyfile).not.toMatch(/access\.log|log_credentials/);
  });

  it('is turned over by the day and kept for 30 days at the most (Caddy alone turns a log over only when it grows big)', () => {
    expect(rules[0]).toBe('/var/log/caddy/sc-trade-error.log {');
    const rule = (name: string) => rules.map((line) => line.trim()).find((line) => line === name || line.startsWith(`${name} `));
    expect(rule('daily')).toBe('daily');
    // every day one part more is put aside: a part that has been put aside 28 times is at most 29 days old when it goes
    const kept = Number(rule('rotate')?.split(' ')[1]);
    expect(kept).toBeGreaterThanOrEqual(1);
    expect(kept + 1).toBeLessThanOrEqual(29);
    expect(rule('maxage')).toBe('maxage 30');
    // an empty log is turned over as well: otherwise the old parts would stay as long as nothing new is written
    expect(rule('ifempty')).toBe('ifempty');
    expect(rule('notifempty')).toBeUndefined();
    // Caddy holds the file open and is not told to open it again: the file is copied and emptied in place…
    expect(rule('copytruncate')).toBe('copytruncate');
    // …which is safe only because Caddy opens it for appending — as it does when it does not turn it over itself
    expect(caddyfile).toMatch(/roll_disabled/);
    expect(rule('su')).toBe('su caddy caddy');
    expect(rule('missingok')).toBe('missingok');
    expect(rules.filter((line) => line.endsWith('{'))).toHaveLength(1);
  });

  it('is the very file setup.sh makes for Caddy and names at the end', () => {
    const setup = readFileSync(join(siteDir, 'deploy', 'setup.sh'), 'utf8');
    expect(setup).toMatch(/^readonly CADDY_LOG=\/var\/log\/caddy\/sc-trade-error\.log$/m);
    expect(setup).toMatch(/^readonly LOGROTATE_FILE=\/etc\/logrotate\.d\/sc-trade-site$/m);
    expect(setup).toContain('run install -m 0644 -o root -g root "$here/logrotate.conf" "$LOGROTATE_FILE"');
  });
});

describe('the unit of the service (site/deploy/sc-trade-site.service)', () => {
  const unit = readFileSync(join(siteDir, 'deploy', 'sc-trade-site.service'), 'utf8').replaceAll('\r\n', '\n');
  const lines = unit.split('\n').filter((line) => !line.startsWith('#') && line.trim() !== '');
  const value = (name: string) => lines.filter((line) => line.startsWith(`${name}=`)).map((line) => line.slice(name.length + 1));

  it('runs the service as a user of its own, never as root', () => {
    expect(value('User')).toEqual(['sc-trade-site']);
    expect(value('Group')).toEqual(['sc-trade-site']);
    expect(value('NoNewPrivileges')).toEqual(['yes']);
    expect(value('CapabilityBoundingSet')).toEqual(['']);
    expect(value('AmbientCapabilities')).toEqual(['']);
    expect(unit).not.toMatch(/^User=root|^Group=root|DynamicUser|sudo/m);
  });

  it('lets it read the system and write the folder of the messages, and nothing else', () => {
    expect(value('ProtectSystem')).toEqual(['strict']);
    expect(value('ReadWritePaths')).toEqual(['/var/lib/sc-trade-site']);
    expect(value('StateDirectory')).toEqual(['sc-trade-site']);
    expect(value('StateDirectoryMode')).toEqual(['0700']);
    expect(value('ProtectHome')).toEqual(['yes']);
    expect(value('PrivateTmp')).toEqual(['yes']);
    expect(value('PrivateDevices')).toEqual(['yes']);
    expect(value('UMask')).toEqual(['0077']);
  });

  it('gives it no network but the machine itself', () => {
    expect(value('IPAddressDeny')).toEqual(['any']);
    expect(value('IPAddressAllow')).toEqual(['localhost']);
    expect(value('RestrictAddressFamilies')).toEqual(['AF_INET AF_INET6 AF_UNIX']);
  });

  it('starts the code setup.sh puts in place, with the settings setup.sh writes, and starts it again when it falls', () => {
    expect(value('ExecStart')).toEqual(['/usr/bin/node /opt/sc-trade-site/src/main.mjs /etc/sc-trade-site/config.json']);
    expect(value('WorkingDirectory')).toEqual(['/opt/sc-trade-site']);
    expect(value('Restart')).toEqual(['on-failure']);
    // settings that are wrong are not tried again and again: the service ends with 78 (main.mjs)
    expect(value('RestartPreventExitStatus')).toEqual(['78']);
    expect(readFileSync(join(siteDir, 'server', 'src', 'main.mjs'), 'utf8')).toMatch(/const EXIT_CONFIG = 78;/);
    expect(value('WantedBy')).toEqual(['multi-user.target']);
    const setup = readFileSync(join(siteDir, 'deploy', 'setup.sh'), 'utf8');
    for (const line of ['readonly CODE_DIR=/opt/sc-trade-site', 'readonly DATA_DIR=/var/lib/sc-trade-site', 'readonly CONFIG_FILE=/etc/sc-trade-site/config.json', 'readonly SERVICE_USER=sc-trade-site']) expect(setup).toContain(line);
  });

  it('does not forbid Node what Node cannot run without, and keeps no secret in itself', () => {
    // Node makes machine code as it runs: with this switch it would not start
    expect(value('MemoryDenyWriteExecute')).toEqual([]);
    expect(lines.filter((line) => /^(Environment|EnvironmentFile|PassEnvironment)=/.test(line))).toEqual(['Environment=NODE_ENV=production']);
    expect(unit).not.toMatch(/pass(word)?\s*=|secret|token/i);
    // every line is a section or "Name=value"
    for (const line of lines) expect(line).toMatch(/^(\[(Unit|Service|Install)\]|[A-Z][A-Za-z]+=.*)$/);
    expect(lines.filter((line) => line.startsWith('['))).toEqual(['[Unit]', '[Service]', '[Install]']);
  });
});
