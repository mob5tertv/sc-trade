import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { siteDir } from '../../scripts/site/config.mjs';
import { build, tempDir, type Built } from './helpers';

// site/deploy/setup.sh sets up the server. Nobody runs it here: there is no server, and it needs root. What is done
// with it instead: bash reads it (`bash -n`); it is started with --dry-run, which starts no program at all (the
// test proves that); its small questions about a text — "is this a plain key", "is the rule for SSH there" — are
// asked directly; and the rest is read, line by line, for what it must and must not do.

const scriptFile = join(siteDir, 'deploy', 'setup.sh');
const script = readFileSync(scriptFile, 'utf8').replaceAll('\r\n', '\n');
const lines = script.split('\n');
/** The script without its comments: what bash does. */
const code = lines.filter((line) => !line.trim().startsWith('#')).join('\n');

/** bash itself: on Windows the one that comes with Git (the "bash" of Windows starts WSL instead). */
function findBash(): string {
  if (process.platform !== 'win32') return '/bin/bash';
  const found = [
    ...(() => {
      const git = spawnSync('git', ['--exec-path'], { encoding: 'utf8' });
      const root = git.status === 0 ? resolve(git.stdout.trim(), '..', '..', '..') : '';
      return root === '' ? [] : [join(root, 'bin', 'bash.exe'), join(root, 'usr', 'bin', 'bash.exe')];
    })(),
    join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'bin', 'bash.exe'),
  ].find((candidate) => existsSync(candidate));
  if (found === undefined) throw new Error('bash was not found: the tests of setup.sh need the bash of Git for Windows');
  return found;
}
const bash = findBash();
/** A path as bash wants it. */
const forBash = (path: string) => path.replaceAll('\\', '/');

/**
 * A folder to be the whole PATH of a run: it holds nothing but stand-ins for the programs the script would start on
 * a server. A stand-in does nothing except write its name and arguments into `record`.
 */
function emptyPath(): { dir: string; record: string } {
  const dir = join(tempDir(), 'bin');
  mkdirSync(dir);
  const record = join(dirname(dir), 'started.txt');
  const names = ['apt-get', 'apt', 'env', 'useradd', 'adduser', 'usermod', 'getent', 'cut', 'install', 'cp', 'mv', 'rm', 'chown', 'chmod', 'mkdir', 'mktemp', 'cat', 'grep', 'sleep', 'node', 'caddy', 'ufw', 'systemctl', 'sshd', 'id', 'tee', 'sed', 'awk', 'curl', 'wget', 'sudo', 'su', 'runuser', 'dirname', 'readlink', 'logrotate'];
  for (const name of names) {
    writeFileSync(join(dir, name), `#!/bin/bash\nprintf '%s\\n' "${name} $*" >> "${forBash(record)}"\n`);
    chmodSync(join(dir, name), 0o755);
  }
  return { dir, record };
}

function runBash(args: string[], options: { path: string; cwd?: string; env?: Record<string, string> }) {
  const run = spawnSync(bash, args, { encoding: 'utf8', cwd: options.cwd, timeout: 60_000, env: { PATH: options.path, ...options.env } });
  return { status: run.status, out: run.stdout, err: run.stderr };
}

/** Asks one of the small questions of the script: the file is read in as a library, which starts nothing. */
function ask(name: string, ...args: string[]) {
  const { dir, record } = emptyPath();
  const run = runBash(['-c', 'source "$1"; shift; "$@"', 'ask', forBash(scriptFile), name, ...args], { path: dir });
  expect(existsSync(record), `"${name}" started a program`).toBe(false);
  return run;
}
const yes = (name: string, ...args: string[]) => ask(name, ...args).status === 0;

describe('site/deploy/setup.sh, read by bash', () => {
  it('has no error of syntax (bash -n)', () => {
    const run = spawnSync(bash, ['-n', forBash(scriptFile)], { encoding: 'utf8' });
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
  });

  it('is plain ASCII with Unix line ends in the repository, so that it reads the same on any console and any system', () => {
    expect(readFileSync(scriptFile).includes(13), 'a CR in setup.sh (site/deploy/.gitattributes keeps it LF)').toBe(false);
    expect(/^[\t\n\x20-\x7e]*$/.test(script)).toBe(true);
    expect(lines[0]).toBe('#!/usr/bin/env bash');
    expect(readFileSync(join(siteDir, 'deploy', '.gitattributes'), 'utf8').split(/\r?\n/)).toContain('setup.sh text eol=lf');
  });

  it('stops at the first command that fails, at a variable that is not set and at a failure inside a pipe', () => {
    expect(code).toMatch(/^set -Eeuo pipefail$/m);
  });

  it('starts nothing when it is read in as a library: its work begins only when it is run as a program', () => {
    const { dir, record } = emptyPath();
    const run = runBash(['-c', 'source "$1"; echo loaded', 'x', forBash(scriptFile)], { path: dir });
    expect(run.err).toBe('');
    expect(run.out).toBe('loaded\n');
    expect(existsSync(record)).toBe(false);
    expect(code).toMatch(/^if \[\[ \$\{BASH_SOURCE\[0\]:-\} == "\$0" \]\]; then\n  main "\$@"\nfi$/m);
  });
});

describe('what setup.sh must never do', () => {
  it('downloads nothing but packages of Ubuntu’s own repositories: no script from the internet is ever run', () => {
    expect(code).not.toMatch(/\b(curl|wget)\b/);
    expect(code).not.toMatch(/\|\s*(sudo\s+)?(ba)?sh\b/);
    expect(code).not.toMatch(/\brun (add-apt-repository|apt-key|snap|npm|npx|pip|pip3|corepack)\b|nodesource|deb\.nodesource|ppa:|sources\.list/);
    // what it installs, all of it, by name
    const installs = code.match(/apt-get install[^\n]*/g) ?? [];
    expect(installs).toHaveLength(1);
    expect(installs[0]).toBe('apt-get install -y caddy nodejs ufw logrotate; then');
    // the dependencies of the service come in the folder: nothing is installed for it on the server
    expect(code).not.toMatch(/npm (ci|install)/);
  });

  it('opens no file or folder to everybody', () => {
    expect(code).not.toMatch(/chmod[^\n]*(777|666|a\+w|o\+w|a=rwx|ugo\+w)/);
    expect(code).not.toMatch(/-m 0?(777|666|[0-7][0-7][2367])\b/);
    for (const mode of code.matchAll(/-m (0[0-7]{3})\b/g)) expect(['0755', '0700', '0750', '0644', '0640', '0600']).toContain(mode[1]);
  });

  it('never takes the password from the command line, never shows it, never hands it on as an argument', () => {
    // no option of the script carries a password, and an argument it does not know is not printed back
    const options = [...code.matchAll(/^\s+(--?[a-z-]+(?: \| --?[a-z-]+)*)\)/gm)].map((match) => match[1]);
    expect(options.sort()).toEqual(['--deploy-key', '--dry-run', '--reset-password', '-h | --help']);
    const unknown = /^\s+\*\)\s*\n?\s*fail '([^']*)'/m.exec(code)?.[1] ?? '';
    expect(unknown).toMatch(/The password is never given here/);
    expect(/\*\)[^\n]*\n?[^\n]*\$1/.test(code.slice(code.indexOf('--reset-password)')))).toBe(false);
    // it is typed on the keyboard, twice, with nothing shown
    const reads = code.match(/read -rs[^\n]*/g) ?? [];
    expect(reads).toHaveLength(2);
    for (const read of reads) expect(read).toMatch(/^read -rs -p '[^']*' \w+ < \/dev\/tty$/);
    // and reaches the tool that makes the hash on its standard input, from a builtin of bash
    const handed = code.match(/[^\n]*\| node [^\n]*/g) ?? [];
    expect(handed).toHaveLength(2);
    for (const line of handed) expect(line.trim()).toMatch(/^printf '%s' "\$typed_password" \| node "\$CODE_DIR\/src\/configure\.mjs" --config "\$CONFIG_FILE" /);
    for (const line of code.split('\n')) {
      if (!/typed_password|\$first|\$second/.test(line)) continue;
      // never in a command that is printed or started with it as an argument, never exported, never written to a file
      expect(line, line).not.toMatch(/\brun\b|\bnote\b|\bsay\b|\bfail\b|\becho\b|export|>>?\s*["$/\w]|\btee\b/);
    }
    expect(code).toMatch(/unset typed_password/);
    // a trace would print it: tracing is switched off at the top and never on
    expect(code).toMatch(/^set \+x$/m);
    expect(code).not.toMatch(/set -[a-zA-Z]*x|xtrace/);
  });

  it('does not touch the settings of the SSH server: it only says, at the end, what is worth doing by hand', () => {
    expect(code).not.toMatch(/systemctl (restart|reload|stop|disable|mask) (ssh|sshd)\b/);
    for (const line of code.split('\n').filter((row) => /sshd_config|PasswordAuthentication|PermitRootLogin/.test(row))) {
      expect(line.trim(), line).toMatch(/^(note|printf) /);
    }
    // the one thing it asks the SSH server: which ports it listens on — a question, not a change
    expect(code.match(/\bsshd\b[^\n]*/g)?.filter((line) => !/^sshd -T/.test(line.trim()) && !/note |printf /.test(line))).toEqual([]);
    expect(script).toMatch(/NOT done by this script/);
  });

  it('removes nothing but its own work folders, each named in full', () => {
    const removals = code.match(/\brm [^\n]*/g) ?? [];
    for (const removal of removals) expect(removal, removal).toMatch(/^rm -(rf|f) "\$(CODE_DIR\.(new|old)|CADDYFILE\.new|keys)"$/);
    expect(code).toMatch(/^readonly CODE_DIR=\/opt\/sc-trade-site$/m);
    expect(code).toMatch(/^readonly CADDYFILE=\/etc\/caddy\/Caddyfile$/m);
  });
});

describe('the order of what setup.sh does', () => {
  const at = (text: string) => {
    const index = code.indexOf(text);
    expect(index, `"${text}" is not in the script`).toBeGreaterThan(-1);
    return index;
  };

  it('turns the firewall on only after the rule for SSH is in place — and not at all if the rule is not there', () => {
    const firewall = code.slice(at('firewall() {'), code.indexOf('\n}\n', at('firewall() {')));
    // one place turns it on, and it comes last
    expect(code.match(/ufw (--force )?enable/g)).toEqual(['ufw --force enable']);
    const allow = firewall.indexOf('run ufw allow "$port/tcp"');
    const shown = firewall.indexOf('added=$(ufw show added)');
    const check = firewall.indexOf('if ! rule_is_added "$added" "$port"; then');
    const enable = firewall.indexOf('run ufw --force enable');
    expect(allow).toBeGreaterThan(-1);
    expect(shown).toBeGreaterThan(allow);
    expect(check).toBeGreaterThan(shown);
    expect(enable).toBeGreaterThan(check);
    // between the check and the switch stands a stop
    expect(firewall.slice(check, enable)).toMatch(/fail "[^"]*NOT turned on/);
    // the ports are the ones the SSH server and this very session use, not a guess — and with no port at all
    // nothing of the firewall is touched
    expect(firewall).toMatch(/ssh_ports "\$\(sshd -T 2> \/dev\/null \|\| true\)" "\$\{SSH_CONNECTION:-\}"/);
    const none = firewall.indexOf('if ((${#ports[@]} == 0)); then');
    expect(none).toBeGreaterThan(-1);
    expect(none).toBeLessThan(firewall.indexOf('run ufw default deny incoming'));
    expect(firewall.slice(none, none + 200)).toMatch(/fail '[^']*NOT touched/);
    // every rule that is checked is a rule that was asked for: the same list of ports, twice
    expect(firewall.match(/for port in "\$\{ports\[@\]\}"; do/g)).toHaveLength(2);
    for (const rule of ['run ufw allow 80/tcp', 'run ufw allow 443/tcp', 'run ufw allow 443/udp', 'run ufw default deny incoming', 'run ufw default allow outgoing']) {
      expect(firewall.indexOf(rule), rule).toBeGreaterThan(-1);
      expect(firewall.indexOf(rule)).toBeLessThan(enable);
    }
  });

  it('asks Caddy whether the new Caddyfile is good before it is put in place, and leaves the old one if it is not', () => {
    const validate = at('if ! run caddy validate --config "$CADDYFILE.new" --adapter caddyfile; then');
    const place = at('run mv "$CADDYFILE.new" "$CADDYFILE"');
    const reload = at('run systemctl reload caddy');
    expect(validate).toBeLessThan(place);
    expect(place).toBeLessThan(reload);
    const refused = code.slice(validate, place);
    expect(refused).toMatch(/run rm -f "\$CADDYFILE\.new"\n\s+fail "[^"]*untouched/);
    // the one before is kept, and comes back if Caddy does not take the new one after all
    expect(code).toMatch(/run cp -p "\$CADDYFILE" "\$CADDYFILE\.previous"/);
    expect(code.slice(place)).toMatch(/run cp -p "\$CADDYFILE\.previous" "\$CADDYFILE"/);
    // the file Caddy logs to exists, as Caddy's, before anything of Caddy opens it as root
    expect(at('run install -m 0640 -o caddy -g caddy /dev/null "$CADDY_LOG"')).toBeLessThan(validate);
  });

  it('does its eight steps in the order the guide tells, and the service starts last', () => {
    const steps = [...code.matchAll(/say '(\d)\/8 /g)].map((match) => Number(match[1]));
    expect(steps).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(at('run systemctl restart "$SERVICE"')).toBeGreaterThan(at('run ufw --force enable'));
    expect(at("say '5/8 ")).toBeGreaterThan(at('run mv "$CODE_DIR.new" "$CODE_DIR"'));
  });

  it('makes each folder for the one who needs it', () => {
    for (const line of [
      'run install -d -m 0755 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$root"',
      'run install -d -m 0700 -o "$SERVICE_USER" -g "$SERVICE_USER" "$DATA_DIR"',
      'run install -d -m 0750 -o root -g "$SERVICE_USER" "$CONFIG_DIR"',
      'run install -d -m 0750 -o caddy -g caddy "$CADDY_LOG_DIR"',
      'run chown -R root:root "$CODE_DIR.new"',
      'run chown root:"$SERVICE_USER" "$CONFIG_FILE"',
      'run chmod 0640 "$CONFIG_FILE"',
    ]) {
      at(line);
    }
    expect(code).toMatch(/^readonly DATA_DIR=\/var\/lib\/sc-trade-site$/m);
    expect(code).toMatch(/^readonly CONFIG_FILE=\/etc\/sc-trade-site\/config\.json$/m);
  });

  it('makes a user only when it is not there, and gives the service one that cannot log in', () => {
    expect(code).toMatch(/if user_exists "\$SERVICE_USER"; then[\s\S]{0,120}else\n\s+run useradd --system --user-group --no-create-home --home-dir \/nonexistent --shell \/usr\/sbin\/nologin "\$SERVICE_USER"/);
    expect(code).toMatch(/if user_exists "\$DEPLOY_USER"; then[\s\S]{0,120}else\n\s+run useradd --create-home --user-group --shell \/bin\/bash "\$DEPLOY_USER"/);
    // no password is ever set for a user, and nobody is added to a group that may become root
    expect(code).not.toMatch(/\b(chpasswd|usermod|gpasswd|visudo)\b|sudoers|-G sudo|--groups|--password/);
    // "passwd" stands only where the list of users is asked about a name
    for (const line of code.split('\n').filter((row) => /\bpasswd\b/.test(row))) expect(line.trim()).toMatch(/^getent passwd "\$1"( > \/dev\/null| \| cut -d: -f6)$/);
  });

  it('does not ask for the password again when the settings are there, unless told to', () => {
    expect(code).toMatch(/if \[\[ -f \$CONFIG_FILE \]\] && ! \$reset_password; then\n\s+note "[^"]*left as it is/);
  });

  it('never writes as root through a link the upload user could have put into its own folder', () => {
    const link = at('if [[ -L $home/.ssh || -L $home/.ssh/authorized_keys ]]; then');
    expect(link).toBeLessThan(at('run install -d -m 0700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$home/.ssh"'));
    expect(link).toBeLessThan(at('cat "$home/.ssh/authorized_keys" > "$keys"'));
    // keys that are there stay, and only plain keys are added
    expect(code).toMatch(/if is_plain_key "\$line" && ! grep -qxF -- "\$line" "\$keys"; then/);
  });

  it('finds the programs of the system wherever it is started from — but only when it is not a dry run', () => {
    const path = code.match(/^\s*PATH=[^\n]*/gm) ?? [];
    expect(path.map((line) => line.trim())).toEqual(['PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin']);
    const before = code.slice(0, code.indexOf('PATH=/usr/local/sbin'));
    expect(before.slice(before.lastIndexOf('if $dry_run; then'))).toMatch(/^if \$dry_run; then\n(\s+printf [^\n]*\n)+\s+else\n\s+$/);
    // no folder a visitor or the upload user can write to is on it
    expect(path[0]).not.toMatch(/\.|~|home|tmp|www/);
  });
});

describe('the small questions of setup.sh', () => {
  it('knows a host name, a full path and a port from what is not one', () => {
    for (const domain of ['sc-trade.space', 'site.example', 'a-b.c-d.example']) expect(yes('valid_domain', domain), domain).toBe(true);
    for (const domain of ['', 'localhost', 'Site.Example', 'site.example/', 'https://site.example', 'site.example; rm -rf /', '-site.example', 'site..example', '$(id).example']) {
      expect(yes('valid_domain', domain), domain).toBe(false);
    }
    for (const root of ['/var/www/sc-trade.space', '/srv/site']) expect(yes('valid_root', root), root).toBe(true);
    for (const root of ['', '/', 'var/www', '/var/www/', '/var/www/../etc', '/var/www/my site', '/var/www/$(id)', '/var/www/a;b']) expect(yes('valid_root', root), root).toBe(false);
    for (const port of ['8787', '1024', '65535']) expect(yes('valid_port', port), port).toBe(true);
    for (const port of ['', '80', '1023', '65536', '99999', '8787 ', '87a7', '-8787', '08787x']) expect(yes('valid_port', port), port).toBe(false);
  });

  it('reads a value of the file the build wrote for it', () => {
    const file = join(tempDir(), 'site.conf');
    writeFileSync(file, '# a comment\ndomain=site.example\r\nroot=/var/www/site.example\nport=8787');
    expect(ask('conf_value', forBash(file), 'domain').out).toBe('site.example');
    expect(ask('conf_value', forBash(file), 'root').out).toBe('/var/www/site.example');
    expect(ask('conf_value', forBash(file), 'port').out).toBe('8787');
    expect(ask('conf_value', forBash(file), 'colour').out).toBe('');
  });

  it('takes a line of authorized_keys for a key only when it is a key and nothing else', () => {
    const key = 'AAAAC3NzaC1lZDI1NTE5AAAAIMadeUpForTheTestsOnlyNotAKeyOfAnybody0123456789';
    for (const line of [`ssh-ed25519 ${key}`, `ssh-ed25519 ${key} sc-trade`, `ssh-rsa ${key}== me@my computer`, `ecdsa-sha2-nistp256 ${key}= x`, `sk-ssh-ed25519@openssh.com ${key}`]) {
      expect(yes('is_plain_key', line), line).toBe(true);
    }
    for (const line of [
      '',
      '# a comment',
      key,
      `ssh-dss ${key}`,
      `command="echo 'Please login as the user ubuntu';exit 142" ssh-ed25519 ${key}`,
      `no-port-forwarding,no-agent-forwarding,command="x" ssh-rsa ${key}`,
      `from="203.0.113.5" ssh-ed25519 ${key}`,
      ` ssh-ed25519 ${key}`,
      `ssh-ed25519`,
      `ssh-ed25519 not base64 !`,
      `ssh-ed25519 ${key}\tx\u0007`,
    ]) {
      expect(yes('is_plain_key', line), line).toBe(false);
    }
  });

  it('finds every port SSH comes in through: 22, what the SSH server says, and the port of this very session', () => {
    const sshd = 'port 22\naddressfamily any\nlistenaddress [::]:22\nlistenaddress 0.0.0.0:22\nusepam yes\npermitrootlogin without-password\n';
    expect(ask('ssh_ports', sshd, '').out).toBe('22\n');
    expect(ask('ssh_ports', 'port 2222\nPort 22022\nport abc\nports 1\n', '').out).toBe('22\n2222\n22022\n');
    expect(ask('ssh_ports', sshd, '203.0.113.5 51234 198.51.100.7 2200').out).toBe('22\n2200\n');
    expect(ask('ssh_ports', 'port 2200\n', '203.0.113.5 51234 198.51.100.7 2200').out).toBe('22\n2200\n');
    // nothing sensible to read: still 22, and nothing that is not a number
    expect(ask('ssh_ports', '', '').out).toBe('22\n');
    expect(ask('ssh_ports', 'port $(id)\nport 22; rm\n', 'a b c d; rm -rf /').out).toBe('22\n');
    expect(ask('ssh_ports', '', '2001:db8::5 51234 2001:db8::7 22').out).toBe('22\n');
  });

  it('hands the ports over to the firewall step whole: the very line of the script, with a made-up answer of the SSH server', () => {
    const { dir, record } = emptyPath();
    const line = 'mapfile -t ports < <(ssh_ports "$1" "$2"); printf "%s:" "${#ports[@]}" "${ports[@]}"';
    const list = (sshd: string, session: string) => runBash(['-c', `source "$1"; shift; ${line}`, 'ask', forBash(scriptFile), sshd, session], { path: dir }).out;
    expect(list('port 22\n', '')).toBe('1:22:');
    expect(list('port 2222\nport 22022\n', '203.0.113.5 51234 198.51.100.7 2200')).toBe('4:22:2222:22022:2200:');
    expect(list('', '')).toBe('1:22:');
    expect(existsSync(record)).toBe(false);
    // the script has that line, with the real question to the SSH server in place of the made-up answer
    expect(code).toContain('mapfile -t ports < <(ssh_ports "$(sshd -T 2> /dev/null || true)" "${SSH_CONNECTION:-}")');
  });

  it('believes that the rule for SSH is in place only when ufw lists it', () => {
    const added = "Added user rules (see 'ufw status' for running firewall):\nufw allow 22/tcp\nufw allow 80/tcp\nufw allow 443/tcp\nufw allow 443/udp\nufw allow 2200/tcp comment 'ssh'\n";
    expect(yes('rule_is_added', added, '22')).toBe(true);
    expect(yes('rule_is_added', added, '2200')).toBe(true);
    expect(yes('rule_is_added', added, '443')).toBe(true);
    for (const port of ['2', '220', '2222', '53', '']) expect(yes('rule_is_added', added, port), port).toBe(false);
    for (const text of [
      '',
      "Added user rules (see 'ufw status' for running firewall):\n(None)\n",
      'ufw allow 80/tcp\nufw allow 443/tcp\n',
      'ufw deny 22/tcp\n',
      'ufw allow 22/udp\n',
      'ufw allow 122/tcp\nufw allow 221/tcp\n',
      'ERROR: problem running\n',
      '# ufw allow 22/tcp\n',
    ]) {
      expect(yes('rule_is_added', text, '22'), text).toBe(false);
    }
  });
});

describe('sudo bash setup.sh --dry-run', () => {
  let site: Built;
  beforeAll(() => {
    site = build();
  });

  it('prints every step and starts no program at all', () => {
    const { dir, record } = emptyPath();
    const before = readdirSync(site.deploy).sort();
    const run = runBash([forBash(join(site.deploy, 'setup.sh')), '--dry-run'], { path: dir, cwd: site.deploy });
    expect(run.err).toBe('');
    expect(run.status).toBe(0);
    // not one of the programs it would start on a server was started — and a program that is not among the
    // stand-ins would have stopped the script with "command not found"
    expect(existsSync(record), existsSync(record) ? readFileSync(record, 'utf8') : '').toBe(false);
    expect(readdirSync(site.deploy).sort()).toEqual(before);

    expect(run.out).toMatch(/dry run: nothing is changed/);
    const said = [...run.out.matchAll(/^==> (\d)\/8 /gm)].map((match) => Number(match[1]));
    expect(said).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    const would = run.out.split('\n').filter((line) => line.startsWith('    would run: ')).map((line) => line.slice('    would run: '.length));
    expect(would.length).toBeGreaterThan(30);
    expect(run.out).not.toMatch(/^ {4}\+ /m);
    for (const command of [
      'apt-get update',
      'env DEBIAN_FRONTEND=noninteractive apt-get install -y caddy nodejs ufw logrotate',
      'useradd --system --user-group --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin sc-trade-site',
      'useradd --create-home --user-group --shell /bin/bash deploy',
      'install -d -m 0755 -o deploy -g deploy /var/www/sc-trade.space',
      'install -d -m 0700 -o sc-trade-site -g sc-trade-site /var/lib/sc-trade-site',
      'install -d -m 0750 -o root -g sc-trade-site /etc/sc-trade-site',
      'mv /opt/sc-trade-site.new /opt/sc-trade-site',
      'chown root:sc-trade-site /etc/sc-trade-site/config.json',
      'install -m 0644 -o root -g root logrotate.conf /etc/logrotate.d/sc-trade-site',
      'caddy validate --config /etc/caddy/Caddyfile.new --adapter caddyfile',
      'mv /etc/caddy/Caddyfile.new /etc/caddy/Caddyfile',
      'systemctl reload caddy',
      'ufw allow 22/tcp',
      'ufw allow 80/tcp',
      'ufw allow 443/tcp',
      'ufw allow 443/udp',
      'ufw --force enable',
      'install -m 0644 -o root -g root sc-trade-site.service /etc/systemd/system/sc-trade-site.service',
      'systemctl daemon-reload',
      'systemctl enable sc-trade-site',
      'systemctl restart sc-trade-site',
    ]) {
      // (what lies in the folder of the script is named here without the path of that folder)
      expect(would.some((line) => line.replace(/ \S*\/dist-deploy\//g, ' ') === command), command).toBe(true);
    }
    // the order that matters, in what it says it would do
    const index = (command: string) => would.findIndex((line) => line.startsWith(command));
    expect(index('ufw allow 22/tcp')).toBeLessThan(index('ufw --force enable'));
    expect(index('caddy validate')).toBeLessThan(index('mv /etc/caddy/Caddyfile.new'));
    expect(index('apt-get update')).toBe(0);
    expect(index('systemctl restart sc-trade-site')).toBeGreaterThan(index('ufw --force enable'));
    // the password: it says that it would ask, asks nothing, and shows no command that carries one
    expect(run.out).toMatch(/would ask for the password/);
    expect(would.filter((line) => /configure\.mjs/.test(line))).toEqual([]);
    // the site it is for comes from the settings of the build
    expect(run.out).toMatch(/the site: sc-trade\.space, served from \/var\/www\/sc-trade\.space; the service on 127\.0\.0\.1:8787/);
  });

  it('stays a dry run with the other options, and asks for nothing', () => {
    const { dir, record } = emptyPath();
    const key = join(tempDir(), 'id_ed25519.pub');
    writeFileSync(key, 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMadeUpForTheTestsOnly sc-trade\n');
    const run = runBash([forBash(join(site.deploy, 'setup.sh')), '--reset-password', '--deploy-key', forBash(key), '--dry-run'], { path: dir, cwd: site.deploy });
    expect(run.err).toBe('');
    expect(run.status).toBe(0);
    expect(existsSync(record)).toBe(false);
    expect(run.out).toMatch(/would ask for the password/);
    expect(run.out).toContain(forBash(key));
  });

  it('stops before anything else at an argument it does not know, without printing it back', () => {
    const { dir, record } = emptyPath();
    for (const args of [['--password', 'TYPED-BY-MISTAKE'], ['TYPED-BY-MISTAKE'], ['--dry-run', '--yes'], ['--deploy-key']]) {
      const run = runBash([forBash(join(site.deploy, 'setup.sh')), ...args], { path: dir, cwd: site.deploy });
      expect(run.status, args.join(' ')).toBe(1);
      expect(run.err).toMatch(/^\nSTOPPED: /);
      expect(run.out + run.err).not.toContain('TYPED-BY-MISTAKE');
      expect(run.out).not.toMatch(/==> 1\/8/);
    }
    expect(existsSync(record)).toBe(false);
  });

  // (not when the tests themselves run as root: then the script would go on, and it must not be started here)
  it.skipIf(process.getuid?.() === 0)('without --dry-run does nothing unless it is root — and here it is not', () => {
    const { dir, record } = emptyPath();
    const run = runBash([forBash(join(site.deploy, 'setup.sh'))], { path: dir, cwd: site.deploy });
    if (run.status === 0) throw new Error('the script went on without being root');
    expect(run.err).toMatch(/STOPPED: (run it as root|this script is written for Ubuntu 24\.04)/);
    expect(run.out).not.toMatch(/==> 1\/8/);
    expect(existsSync(record)).toBe(false);
  });

  it('prints its help and does nothing', () => {
    const { dir, record } = emptyPath();
    const run = runBash([forBash(join(site.deploy, 'setup.sh')), '--help'], { path: dir, cwd: site.deploy });
    expect(run.status).toBe(0);
    expect(run.out).toMatch(/sudo bash setup\.sh --dry-run/);
    expect(run.out).toMatch(/--reset-password/);
    expect(run.out).toMatch(/--deploy-key FILE/);
    expect(existsSync(record)).toBe(false);
  });
});
