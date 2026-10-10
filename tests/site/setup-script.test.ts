import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { siteDir } from '../../scripts/site/config.mjs';
import { build, tempDir, type Built } from './helpers';

// site/deploy/setup.sh sets up the server. Nobody runs it here: there is no server, and it needs root. What is done
// with it instead: bash reads it (`bash -n`); it is started with --dry-run, which changes nothing and starts only
// three programs that ask the system a question (the test proves that, with stand-ins for every program); its small
// questions about a text — "is this a plain key", "which ports does SSH come in through", "is the rule for SSH
// there" — are asked directly; and the rest is read, line by line, for what it must and must not do.

const scriptFile = join(siteDir, 'deploy', 'setup.sh');
const script = readFileSync(scriptFile, 'utf8').replaceAll('\r\n', '\n');
const lines = script.split('\n');
/** The script without its comments: what bash does. */
const code = lines.filter((line) => !line.trim().startsWith('#')).join('\n');
/** The lines that do something: not the ones that only print (`note`, `printf`, `say`, `fail`). */
const doing = code.split('\n').filter((line) => !/^\s*(note|printf|say|fail) /.test(line));
/** The body of a function of the script. */
function body(name: string): string {
  const start = code.indexOf(`\n${name}() {\n`);
  expect(start, `the function ${name} is not in the script`).toBeGreaterThan(-1);
  return code.slice(start, code.indexOf('\n}\n', start));
}

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

/** The three programs a dry run may start: each only asks the system which ports SSH comes in through. */
const QUESTIONS = ['sshd -T', 'systemctl show ssh.socket -p Listen', 'ss -Hltnp'];

/**
 * A folder to be the whole PATH of a run: it holds nothing but stand-ins for the programs the script would start on
 * a server. A stand-in does nothing except write its name and arguments into `record` — and, for the three that
 * ask the system a question, print the answer a test gives them.
 */
function standIns(answers: { sshd?: string; systemctl?: string; ss?: string } = {}): { dir: string; record: string; started: () => string[] } {
  const dir = join(tempDir(), 'bin');
  mkdirSync(dir);
  const record = join(dirname(dir), 'started.txt');
  const names = ['apt-get', 'apt', 'env', 'useradd', 'adduser', 'usermod', 'getent', 'cut', 'install', 'cp', 'mv', 'rm', 'chown', 'chmod', 'mkdir', 'mktemp', 'cat', 'grep', 'sleep', 'node', 'caddy', 'ufw', 'systemctl', 'sshd', 'ss', 'id', 'tee', 'sed', 'awk', 'curl', 'wget', 'sudo', 'su', 'runuser', 'dirname', 'readlink', 'logrotate', 'tail', 'wc'];
  for (const name of names) {
    // the answer, if there is one, is printed with nothing but what bash has built in
    writeFileSync(join(dir, name), `#!/bin/bash\nprintf '%s\\n' "${name} $*" >> "${forBash(record)}"\nif [[ -f "$0.answer" ]]; then while IFS= read -r line; do printf '%s\\n' "$line"; done < "$0.answer"; fi\n`);
    chmodSync(join(dir, name), 0o755);
  }
  for (const [name, answer] of Object.entries(answers)) writeFileSync(join(dir, `${name}.answer`), answer);
  return { dir, record, started: () => (existsSync(record) ? readFileSync(record, 'utf8').trim().split('\n') : []) };
}

function runBash(args: string[], options: { path: string; cwd?: string; env?: Record<string, string> }) {
  const run = spawnSync(bash, args, { encoding: 'utf8', cwd: options.cwd, timeout: 60_000, env: { PATH: options.path, ...options.env } });
  return { status: run.status, out: run.stdout, err: run.stderr };
}

/** Asks one of the small questions of the script: the file is read in as a library, which starts nothing. */
function ask(name: string, ...args: string[]) {
  const { dir, started } = standIns();
  const run = runBash(['-c', 'source "$1"; shift; "$@"', 'ask', forBash(scriptFile), name, ...args], { path: dir });
  expect(started(), `"${name}" started a program`).toEqual([]);
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
    const { dir, started } = standIns();
    const run = runBash(['-c', 'source "$1"; echo loaded', 'x', forBash(scriptFile)], { path: dir });
    expect(run.err).toBe('');
    expect(run.out).toBe('loaded\n');
    expect(started()).toEqual([]);
    expect(code).toMatch(/^if \[\[ \$\{BASH_SOURCE\[0\]:-\} == "\$0" \]\]; then\n  main "\$@"\nfi$/m);
  });
});

describe('what setup.sh must never do', () => {
  it('downloads nothing but packages of Ubuntu’s own repositories: no script from the internet is ever run', () => {
    expect(code).not.toMatch(/\b(curl|wget)\b/);
    expect(code).not.toMatch(/\|\s*(sudo\s+)?(ba)?sh\b/);
    expect(code).not.toMatch(/\brun (add-apt-repository|apt-key|snap|npm|npx|pip|pip3|corepack)\b|nodesource|deb\.nodesource|ppa:|sources\.list/);
    // what it installs, all of it, by name — without a question on the way, and keeping the settings that are there
    const installs = code.match(/apt-get install[^\n]*/g) ?? [];
    expect(installs).toEqual(['apt-get install -y -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold caddy nodejs ufw logrotate; then']);
    for (const line of doing.filter((row) => /\bapt-get\b/.test(row))) expect(line, line).toMatch(/run env DEBIAN_FRONTEND=noninteractive (NEEDRESTART_SUSPEND=1 )?apt-get (update$|install )/);
    // the dependencies of the service come in the folder: nothing is installed for it on the server
    expect(code).not.toMatch(/npm (ci|install)/);
  });

  it('upgrades nothing: it installs four packages and leaves every other one of the system as it is', () => {
    /** The lines that make apt change a package nobody named: an upgrade of the system, or a removal. */
    const upgrades = (rows: string[]) =>
      rows.filter((row) => /\b(apt|apt-get|aptitude)\b[^\n|;&]*\s(upgrade|dist-upgrade|full-upgrade|autoremove|purge|remove)\b|--only-upgrade|do-release-upgrade|unattended-upgrade/.test(row));
    expect(upgrades(code.split('\n'))).toEqual([]);
    // the test itself knows an upgrade when it sees one, whatever stands between the program and the word
    for (const upgrade of [
      'run apt-get upgrade',
      'run apt-get -y dist-upgrade',
      'run env DEBIAN_FRONTEND=noninteractive apt-get -y -o Dpkg::Options::=--force-confold upgrade',
      'run apt -y full-upgrade',
      'run apt-get -y autoremove',
      'run apt-get install --only-upgrade openssh-server',
      'run do-release-upgrade',
    ]) {
      expect(upgrades([upgrade]), upgrade).toEqual([upgrade]);
    }
    expect(upgrades(['run env DEBIAN_FRONTEND=noninteractive apt-get update', 'run env DEBIAN_FRONTEND=noninteractive apt-get install -y caddy'])).toEqual([]);
  });

  it('opens no file or folder to everybody, and gives nobody but the owner the right to write — outside the folder of the site', () => {
    expect(code).not.toMatch(/-m 0?(777|666)\b/);
    for (const mode of code.matchAll(/-m (0[0-7]{3})\b/g)) expect(['0755', '0700', '0750', '0644', '0640', '0600']).toContain(mode[1]);
    // every chmod of the script, one by one
    const chmods = doing.flatMap((line) => [...line.matchAll(/\bchmod ((?:-\S+ )*)(\S+) (\S+)/g)]).map((match) => ({ mode: match[2], target: match[3] }));
    expect(chmods.map(({ mode, target }) => `${mode} ${target}`).sort()).toEqual(['0640 "$CADDY_LOG"', '0640 "$CONFIG_FILE"', '0640 "$CONFIG_FILE"', 'u=rwX,go=rX "$CODE_DIR.new"']);
    /** Does a mode let the group or the others write? */
    const givesWrite = (mode: string) => (/^[0-7]{3,4}$/.test(mode) ? /[2367]$/.test(mode) || /[2367].$/.test(mode) : mode.split(',').some((part) => /^[ugoa]*[goa][ugoa]*[+=][rxXst]*w/.test(part) || /^[+=][rxXst]*w/.test(part)));
    for (const { mode, target } of chmods) if (!target.startsWith('"$root')) expect(givesWrite(mode), `chmod ${mode} ${target}`).toBe(false);
    // the test itself knows a mode that opens too much when it sees one
    for (const open of ['777', '0666', '0775', '0664', '0722', 'a+w', 'go+w', 'g=rwx', 'u=rw,o+w', '+w', 'o=w']) expect(givesWrite(open), open).toBe(true);
    for (const closed of ['0755', '0640', '0600', 'u=rwX,go=rX', 'u+w', 'go-w', 'a+r']) expect(givesWrite(closed), closed).toBe(false);
    // the same for what "install" makes
    for (const mode of code.matchAll(/\binstall (?:-d )?-m (\S+) /g)) expect(givesWrite(mode[1]), `install -m ${mode[1]}`).toBe(false);
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
    // sixteen characters at the least: the same number the service itself holds a password to
    expect(reads[0]).toContain('16 characters or more');
    expect(code).toMatch(/elif \(\(\$\{#first\} < 16\)\); then/);
    expect(readFileSync(join(siteDir, 'server', 'src', 'password.mjs'), 'utf8')).toMatch(/^export const PASSWORD_MIN = 16;$/m);
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

  it('gets the password from the prompt and from nowhere else: no other line gives it a value', () => {
    const assigned = code.split('\n').filter((line) => /\btyped_password=/.test(line)).map((line) => line.trim());
    expect(assigned).toEqual(["typed_password=''", 'typed_password=$first']);
    /** The lines that touch the password in any way but the four the script is allowed. */
    const otherUses = (rows: string[]) =>
      rows
        .map((row) => row.trim())
        .filter((row) => /typed_password/.test(row))
        .filter((row) => !["typed_password=''", 'typed_password=$first', 'unset typed_password'].includes(row) && !/^printf '%s' "\$typed_password" \| node "\$CODE_DIR\/src\/configure\.mjs" --config "\$CONFIG_FILE" [^|>;&]*( \|\| written=false)?$/.test(row));
    expect(otherUses(code.split('\n'))).toEqual([]);
    // the test itself knows another source, or another destination, when it sees one
    for (const other of [
      'typed_password=$1',
      'typed_password=${ADMIN_KEY:-}',
      'typed_password+=$2',
      'read -r typed_password < "$file"',
      "printf -v typed_password '%s' \"$2\"",
      'typed_password=$(cat "$file")',
      'printf \'%s\' "$typed_password" | node "$CODE_DIR/src/configure.mjs" --config "$CONFIG_FILE" --reset-password > /tmp/x',
      'printf \'%s\' "$typed_password" > /root/x',
    ]) {
      expect(otherUses([other]), other).toEqual([other]);
    }
    // what was typed lives in two variables that only the prompt fills
    for (const name of ['first', 'second']) {
      expect(code.split('\n').filter((line) => new RegExp(`\\b${name}\\+?=|-v ${name}\\b`).test(line)), name).toEqual([]);
      const reads = code.split('\n').filter((line) => new RegExp(`\\bread\\b.*\\b${name}\\b`).test(line)).map((line) => line.trim());
      expect(reads, name).toHaveLength(1);
      expect(reads[0]).toMatch(new RegExp(`^IFS= read -rs -p '[^']*' ${name} < /dev/tty$`));
    }
    const uses = code.split('\n').filter((line) => /\$\{?#?(first|second)\b/.test(line)).map((line) => line.trim());
    expect(uses).toEqual(['if [[ $first != "$second" ]]; then', 'elif ((${#first} < 16)); then', 'typed_password=$first']);
    // nothing of the environment or of the arguments is ever read as a password
    expect(code).not.toMatch(/\$\{?[A-Z_]*PASS[A-Z_]*\b|\$\{?[A-Z_]*SECRET/);
  });

  it('writes nothing under /etc/ssh and does not touch the SSH server: it only says, at the end, what is worth doing by hand', () => {
    expect(code).not.toMatch(/systemctl (restart|reload|stop|disable|mask|start|enable) (ssh|sshd)\b/);
    /** The lines that name the settings of the SSH server and are anything but a line that only prints to the screen. */
    const sshWrites = (rows: string[]) =>
      rows.filter((row) => /\/etc\/ssh|sshd_config|PasswordAuthentication|PermitRootLogin|KbdInteractiveAuthentication/.test(row) && !(/^\s*(note|printf) /.test(row) && !/>|\btee\b/.test(row)));
    expect(sshWrites(code.split('\n'))).toEqual([]);
    expect(doing.filter((line) => /\/etc\/ssh/.test(line))).toEqual([]);
    // the test itself knows a write when it sees one
    for (const write of [
      "printf 'PasswordAuthentication no\\n' > /etc/ssh/sshd_config.d/00-sc-trade.conf",
      "printf '%s\\n' 'PermitRootLogin no' | tee /etc/ssh/sshd_config.d/00-sc-trade.conf",
      'run install -m 0644 "$here/ssh.conf" /etc/ssh/sshd_config.d/00-sc-trade.conf',
      'run sed -i s/yes/no/ /etc/ssh/sshd_config',
      'echo KbdInteractiveAuthentication no >> "$config"',
    ]) {
      expect(sshWrites([write]), write).toEqual([write]);
    }
    expect(sshWrites(["  note 'PasswordAuthentication no'", "printf '%s\\n' 'in a file of your own under /etc/ssh/sshd_config.d/'"])).toEqual([]);
    // the one thing it asks the SSH server: which ports it listens on — a question, not a change
    const sshd = doing.flatMap((line) => line.match(/\bsshd -[^)]*/g) ?? []);
    expect(sshd).toEqual(['sshd -T 2> /dev/null || true']);
    // nor does it start, stop or signal anything of SSH
    expect(doing.filter((line) => /\b(systemctl|service|kill|pkill)\b.*\bssh/.test(line) && !/systemctl show ssh\.socket -p Listen/.test(line))).toEqual([]);
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

  it('does its eight steps in an order that leaves the least certain one for last: the firewall, the service, then Caddy', () => {
    const steps = [...code.matchAll(/say '(\d)\/8 ([^']*)'/g)].map((match) => `${match[1]} ${match[2].split(/[ :(]/)[0]}`);
    const order = /\n  packages\n  users\n  folders\n  code\n  settings\n  firewall\n  service\n  web_server\n  closing_words\n/;
    expect(code).toMatch(order);
    expect(steps.map((step) => Number(step[0])).sort()).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    for (const [name, number] of [['packages', 1], ['users', 2], ['folders', 3], ['code', 4], ['settings', 5], ['firewall', 6], ['service', 7], ['web_server', 8]] as const) {
      expect(body(name), name).toContain(`say '${number}/8 `);
    }
    // if Caddy refuses its file on a first run, the server is already behind the firewall and the service already runs
    expect(body('web_server')).toContain('caddy validate');
    expect(body('firewall')).not.toMatch(/caddy/);
  });

  it('turns the firewall on only for ports it has evidence of, only after their rules are in place — and not at all otherwise', () => {
    const firewall = body('firewall');
    // one place turns it on
    expect(code.match(/ufw (--force )?enable/g)).toEqual(['ufw --force enable']);
    // the ports come from what the system says, four ways; nothing is assumed
    expect(firewall).toContain('mapfile -t ports < <(ssh_ports "$(sshd -T 2> /dev/null || true)" "${SSH_CONNECTION:-}" "$(systemctl show ssh.socket -p Listen 2> /dev/null || true)" "$(ss -Hltnp 2> /dev/null || true)")');
    expect(body('ssh_ports')).not.toMatch(/ports=\(22\)|\b22\b/);
    const none = firewall.indexOf('if ((${#ports[@]} == 0)); then');
    const stays = firewall.indexOf('note "SSH stays open on: ${ports[*]}"');
    const allow = firewall.indexOf('run ufw allow "$port/tcp"');
    const shown = firewall.indexOf('added=$(ufw show added)');
    const check = firewall.indexOf('if ! rule_is_added "$added" "$port"; then');
    const deny = firewall.indexOf('run ufw default deny incoming');
    const enable = firewall.indexOf('run ufw --force enable');
    for (const [name, index] of Object.entries({ none, stays, allow, shown, check, deny, enable })) expect(index, name).toBeGreaterThan(-1);
    // no evidence: nothing of the firewall is touched, the script says so and goes on with the rest
    expect(none).toBeLessThan(firewall.indexOf('run ufw'));
    expect(firewall.slice(none, stays)).toMatch(/NOT touched[\s\S]*return 0/);
    expect(firewall.slice(none, stays)).not.toMatch(/\bfail\b|\bexit\b|run ufw/);
    // evidence: the rule first, then what ufw itself lists, then the default that shuts the rest, then the switch
    expect(stays).toBeLessThan(allow);
    expect(allow).toBeLessThan(shown);
    expect(shown).toBeLessThan(check);
    expect(check).toBeLessThan(deny);
    expect(deny).toBeLessThan(enable);
    // a rule that ufw does not list: no switch, said so, and the rest goes on
    expect(firewall.slice(check, deny)).toMatch(/NOT turned on[\s\S]*return 0/);
    expect(firewall.slice(check, deny)).not.toMatch(/\bfail\b|\bexit\b/);
    // every rule that is checked is a rule that was asked for: the same list of ports, twice
    expect(firewall.match(/for port in "\$\{ports\[@\]\}"; do/g)).toHaveLength(2);
    for (const rule of ['run ufw allow 80/tcp', 'run ufw allow 443/tcp', 'run ufw allow 443/udp', 'run ufw default allow outgoing']) {
      expect(firewall.indexOf(rule), rule).toBeGreaterThan(-1);
      expect(firewall.indexOf(rule)).toBeLessThan(enable);
    }
    // what was not done is said once more at the very end, where it is read
    expect(body('closing_words')).toContain('$firewall_left');
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

  it('takes "the service runs" to mean that it answers on the machine itself, not only that systemd started it', () => {
    const service = body('service');
    expect(service).toContain('run systemctl restart "$SERVICE"');
    expect(service.indexOf('await_service')).toBeGreaterThan(service.indexOf('run systemctl restart "$SERVICE"'));
    expect(body('await_service')).toContain('if service_answers "$port"; then');
    expect(body('await_service')).toMatch(/fail "the service does not answer on 127\.0\.0\.1:\$port/);
    expect(body('await_service')).not.toMatch(/is-active/);
    expect(body('service_answers')).toContain('exec 3<> "/dev/tcp/127.0.0.1/$1"');
    expect(body('service_answers')).toContain("printf 'GET /api/ HTTP/1.0\\r\\nHost: 127.0.0.1\\r\\n\\r\\n' >&3");
    expect(code).not.toContain("note 'the service runs'");
  });

  it('with --reset-password does the password and the restart of the service, and nothing else: no package, no user, no firewall, no Caddy', () => {
    expect(code).toMatch(/\n  if \$reset_password; then\n    new_password\n    return 0\n  fi\n/);
    expect(at('\n  if $reset_password; then\n    new_password')).toBeLessThan(at('\n  packages\n  users\n'));
    const only = body('new_password');
    expect(only).toContain('ask_password');
    expect(only).toContain('--reset-password');
    expect(only).toContain('run systemctl restart "$SERVICE"');
    expect(only.indexOf('await_service')).toBeGreaterThan(only.indexOf('run systemctl restart "$SERVICE"'));
    expect(only).not.toMatch(/apt-get|useradd|ufw|caddy|install -d|cp -R/);
    // there must be something to give a new password to
    expect(only).toMatch(/if \[\[ ! -f \$CONFIG_FILE \|\| ! -f \$CODE_DIR\/src\/configure\.mjs \]\]; then/);
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

  it('does not ask for the password again when the settings are there', () => {
    expect(body('settings')).toMatch(/if \[\[ -f \$CONFIG_FILE \]\]; then\n\s+note "[^"]*left as it is/);
    // and tells the tool where the site lies, so that the service refuses to keep its data there
    expect(body('settings')).toContain('--domain "$domain" --port "$port" --data "$DATA_DIR" --root "$root"');
  });

  it('never writes as root through a link the upload user could have put into its own folder', () => {
    const link = at('if [[ -L $home/.ssh || -L $home/.ssh/authorized_keys ]]; then');
    expect(link).toBeLessThan(at('run install -d -m 0700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$home/.ssh"'));
    expect(link).toBeLessThan(at('merge_keys "$home/.ssh/authorized_keys" "$given" > "$keys"'));
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
    // a path of one level would be a folder that holds half the system: the site is never put there
    for (const root of ['', '/', 'var/www', '/var/www/', '/var/www/../etc', '/var/www/my site', '/var/www/$(id)', '/var/www/a;b', '/var', '/srv', '/home', '/etc']) expect(yes('valid_root', root), root).toBe(false);
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

  const key = 'AAAAC3NzaC1lZDI1NTE5AAAAIMadeUpForTheTestsOnlyNotAKeyOfAnybody0123456789';

  it('takes a line of authorized_keys for a key only when it is a key and nothing else', () => {
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

  it('adds the new keys to the ones that are there, each on a line of its own — also when the file did not end with a line break', () => {
    const dir = tempDir();
    const existing = join(dir, 'authorized_keys');
    const given = join(dir, 'given');
    const old = `ssh-ed25519 ${key}OLD old-laptop`;
    const fresh = `ssh-ed25519 ${key}NEW new-laptop`;
    // no line break at the end of what is there: the new key must not be glued to its last line
    writeFileSync(existing, `# keys of the upload user\n${old}`);
    writeFileSync(given, `${old}\r\n${fresh}\r\ncommand="x" ssh-ed25519 ${key}FORCED\n# a comment\n\n${fresh}`);
    const merged = ask('merge_keys', forBash(existing), forBash(given));
    expect(merged.status).toBe(0);
    expect(merged.out).toBe(`# keys of the upload user\n${old}\n${fresh}\n`);
    // no file there yet: the plain keys of the given file, once each
    expect(ask('merge_keys', forBash(join(dir, 'none')), forBash(given)).out).toBe(`${old}\n${fresh}\n`);
    // nothing new to add: what is there, whole, with its last line closed
    writeFileSync(given, `${old}\n`);
    expect(ask('merge_keys', forBash(existing), forBash(given)).out).toBe(`# keys of the upload user\n${old}\n`);
    // it is what the script writes the file of the upload user from, and it counts the keys with nothing but bash
    expect(body('users')).toContain('merge_keys "$home/.ssh/authorized_keys" "$given" > "$keys"');
    expect(body('users')).not.toMatch(/\bgrep\b|\bcat\b/);
  });

  it('finds the ports SSH comes in through from what the system says — and assumes none', () => {
    const sshd = 'port 22\naddressfamily any\nlistenaddress [::]:22\nlistenaddress 0.0.0.0:22\nusepam yes\npermitrootlogin without-password\n';
    const ports = (...evidence: string[]) => ask('ssh_ports', ...evidence, ...Array.from({ length: 4 - evidence.length }, () => '')).out;
    // no evidence at all: no port — not even 22
    expect(ports('', '', '', '')).toBe('');
    // what the SSH server says of its settings
    expect(ports(sshd)).toBe('22\n');
    expect(ports('port 2222\nPort 22022\nport abc\nports 1\nport 0\nport 70000\n')).toBe('2222\n22022\n');
    // the port this very session came in through
    expect(ports('', '203.0.113.5 51234 198.51.100.7 2200')).toBe('2200\n');
    expect(ports('', '2001:db8::5 51234 2001:db8::7 22')).toBe('22\n');
    // a port set for the socket of systemd, which the settings of the SSH server do not show
    expect(ports('', '', 'Listen=[::]:2222 (Stream)\n')).toBe('2222\n');
    expect(ports('', '', 'Listen=0.0.0.0:2222 (Stream) [::]:2222 (Stream)\n')).toBe('2222\n');
    expect(ports('', '', 'Listen=0.0.0.0:22 (Stream)\nListen=[::]:2200 (Stream)\n')).toBe('22\n2200\n');
    expect(ports('', '', 'Listen=\n')).toBe('');
    // the sockets the SSH server really listens on
    const sockets = [
      'LISTEN 0      4096         0.0.0.0:2222      0.0.0.0:*    users:(("sshd",pid=812,fd=3),("systemd",pid=1,fd=118))',
      'LISTEN 0      4096            [::]:2222         [::]:*    users:(("sshd",pid=812,fd=4),("systemd",pid=1,fd=119))',
      'LISTEN 0      511          127.0.0.1:8787      0.0.0.0:*    users:(("node",pid=900,fd=21))',
      'LISTEN 0      4096               *:443             *:*    users:(("caddy",pid=700,fd=7))',
      'LISTEN 0      128          127.0.0.1:6010      0.0.0.0:*    users:(("sshd-session",pid=950,fd=9))',
      // a socket of the SSH server that only this machine can reach (a forwarded display) is no way in from outside
      'LISTEN 0      128          127.0.0.1:6011      0.0.0.0:*    users:(("sshd",pid=951,fd=9))',
      'LISTEN 0      128              [::1]:6011         [::]:*    users:(("sshd",pid=951,fd=8))',
    ].join('\n');
    expect(ports('', '', '', sockets)).toBe('2222\n');
    // everything together: each port once, in the order it was found
    expect(ports(sshd, '203.0.113.5 51234 198.51.100.7 2200', 'Listen=[::]:2222 (Stream)\n', sockets)).toBe('22\n2200\n2222\n');
    // nothing that is not a number between 1 and 65535 comes out, whatever the texts hold
    expect(ports('port $(id)\nport 22; rm\n', 'a b c d; rm -rf /', 'Listen=[::]:99999 (Stream) x:$(id) (Stream)', 'LISTEN 0 1 0.0.0.0:abc 0.0.0.0:* users:(("sshd",pid=1,fd=3))')).toBe('');
  });

  it('hands the ports over to the firewall step whole: the very line of the script, with made-up answers of the system', () => {
    const { dir, started } = standIns();
    const line = 'mapfile -t ports < <(ssh_ports "$1" "$2" "$3" "$4"); printf "%s:" "${#ports[@]}" "${ports[@]}"';
    const list = (...evidence: string[]) => runBash(['-c', `source "$1"; shift; ${line}`, 'ask', forBash(scriptFile), ...evidence], { path: dir }).out;
    expect(list('port 22\n', '', '', '')).toBe('1:22:');
    expect(list('port 2222\nport 22022\n', '203.0.113.5 51234 198.51.100.7 2200', '', '')).toBe('3:2222:22022:2200:');
    // no evidence: an empty list, which the step takes for "do not touch the firewall"
    expect(list('', '', '', '')).toBe('0:');
    expect(started()).toEqual([]);
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

  it('knows whether the service answers by asking it, on 127.0.0.1, with nothing but bash', async () => {
    /** A server of the test on 127.0.0.1 that answers every request with a status. */
    const listen = (status: number) =>
      new Promise<{ port: number; close: () => Promise<void> }>((done) => {
        const server = http.createServer((_req, res) => {
          res.writeHead(status, { 'Content-Type': 'application/json' });
          res.end('{"ok":true}');
        });
        server.listen(0, '127.0.0.1', () => done({ port: (server.address() as net.AddressInfo).port, close: () => new Promise((closed) => server.close(() => closed())) }));
      });
    const up = await listen(200);
    const broken = await listen(500);
    // spawnSync would hold this process still while the server of the test has to answer: asked without waiting
    const answers = (port: number) =>
      new Promise<number | null>((done) => {
        const { dir } = standIns();
        const child = spawn(bash, ['-c', 'source "$1"; service_answers "$2"', 'ask', forBash(scriptFile), String(port)], { env: { PATH: dir }, stdio: 'ignore' });
        child.on('exit', (code) => done(code));
      });
    try {
      expect(await answers(up.port)).toBe(0);
      expect(await answers(broken.port)).toBe(1);
    } finally {
      await up.close();
      await broken.close();
    }
    // a port nobody listens on
    expect(await answers(up.port)).toBe(1);
  }, 30_000);
});

describe('when setup.sh stops', () => {
  it('says in one line what this run has done and what it has not, and that running it again is safe', () => {
    const { dir, started } = standIns();
    const stop = (prepare: string) => runBash(['-c', `source "$1"; ${prepare}; fail 'the reason'`, 'x', forBash(scriptFile)], { path: dir });
    const early = stop('started=true');
    expect(early.status).toBe(1);
    expect(early.err).toBe('\nSTOPPED: the reason\nThe server now: nothing of the set-up was done by this run. Running the script again is safe.\n');
    const middle = stop('started=true; steps_done=(packages users folders code settings firewall)');
    expect(middle.err).toBe(
      '\nSTOPPED: the reason\nThe server now: this run has done: packages, users, folders, code, settings, firewall; not done: service, web server. Running the script again is safe: what is done is not undone.\n',
    );
    // before the set-up has begun (a wrong argument, not root) there is no state to speak of
    expect(stop('true').err).toBe('\nSTOPPED: the reason\n');
    expect(started()).toEqual([]);
    // every step is written down when it is over, in the order of the run
    expect(code).toMatch(/readonly STEPS=\(packages users folders code settings firewall service 'web server'\)/);
    for (const step of ['packages', 'users', 'folders', 'code', 'settings', 'firewall', 'service', 'web_server']) expect(code).toMatch(new RegExp(`\\n  ${step}\\n`));
    expect(code.match(/steps_done\+=\(/g)).toHaveLength(8);
  });

  it('names the line of the step when a command fails, not the line of the helper that started the command', () => {
    const { dir, started } = standIns();
    // a step of the test: its second line starts a command that fails ("false" is built into bash: no program is started)
    const run = runBash(['-c', `source "$1"\ndry_run=false; started=true; steps_done=(packages)\ntrap 'on_error "$LINENO"' ERR\na_step() {\n  run true\n  run false\n  run true\n}\na_step`, 'x', forBash(scriptFile)], { path: dir });
    expect(run.status).toBe(1);
    expect(run.out).toBe('    + true\n    + false\n');
    expect(run.err).toMatch(/^\nSTOPPED: a command failed in "a_step" \(line 6 of the script; what it said is above\)\.\nThe server now: this run has done: packages; not done: users, folders, code, settings, firewall, service, web server\. Running the script again is safe: what is done is not undone\.\n$/);
    expect(started()).toEqual([]);
    // the script sets the very trap this test set
    expect(code).toContain(`trap 'on_error "$LINENO"' ERR`);
  });
});

describe('sudo bash setup.sh --dry-run', () => {
  let site: Built;
  beforeAll(() => {
    site = build();
  });
  const script = () => forBash(join(site.deploy, 'setup.sh'));
  /** The commands a dry run says it would start; what lies in the folder of the script is named without its path. */
  const wouldRun = (out: string) =>
    out
      .split('\n')
      .filter((line) => line.startsWith('    would run: '))
      .map((line) => line.slice('    would run: '.length).replace(/ \S*\/dist-deploy\//g, ' '));

  it('prints every step, changes nothing, and starts no program but the three that ask which ports SSH comes in through', () => {
    const { dir, started } = standIns({ sshd: 'port 22\n', systemctl: 'Listen=[::]:22 (Stream)\n', ss: 'LISTEN 0 4096 0.0.0.0:22 0.0.0.0:* users:(("sshd",pid=1,fd=3))\n' });
    const before = readdirSync(site.deploy).sort();
    const run = runBash([script(), '--dry-run'], { path: dir, cwd: site.deploy });
    expect(run.err).toBe('');
    expect(run.status).toBe(0);
    // a program that is not among the stand-ins would have stopped the script with "command not found"; of the
    // stand-ins only the three questions were started, once each
    expect(started()).toEqual(QUESTIONS);
    expect(readdirSync(site.deploy).sort()).toEqual(before);

    expect(run.out).toMatch(/dry run: nothing is changed/);
    const said = [...run.out.matchAll(/^==> (\d)\/8 /gm)].map((match) => Number(match[1]));
    expect(said).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    const would = wouldRun(run.out);
    expect(run.out).not.toMatch(/^ {4}\+ /m);
    expect(would).toEqual([
      'env DEBIAN_FRONTEND=noninteractive apt-get update',
      'env DEBIAN_FRONTEND=noninteractive NEEDRESTART_SUSPEND=1 apt-get install -y -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold caddy nodejs ufw logrotate',
      'useradd --system --user-group --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin sc-trade-site',
      'useradd --create-home --user-group --shell /bin/bash deploy',
      'install -d -m 0755 -o deploy -g deploy /var/www/sc-trade.space',
      'install -d -m 0700 -o sc-trade-site -g sc-trade-site /var/lib/sc-trade-site',
      'install -d -m 0750 -o root -g sc-trade-site /etc/sc-trade-site',
      'install -d -m 0750 -o caddy -g caddy /var/log/caddy',
      'install -m 0640 -o caddy -g caddy /dev/null /var/log/caddy/sc-trade-error.log',
      'chown caddy:caddy /var/log/caddy/sc-trade-error.log',
      'chmod 0640 /var/log/caddy/sc-trade-error.log',
      'rm -rf /opt/sc-trade-site.new',
      'cp -R server /opt/sc-trade-site.new',
      'chown -R root:root /opt/sc-trade-site.new',
      'chmod -R u=rwX\\,go=rX /opt/sc-trade-site.new',
      'rm -rf /opt/sc-trade-site.old',
      'mv /opt/sc-trade-site.new /opt/sc-trade-site',
      'rm -rf /opt/sc-trade-site.old',
      'chown root:sc-trade-site /etc/sc-trade-site/config.json',
      'chmod 0640 /etc/sc-trade-site/config.json',
      // the firewall: the rule for SSH, the web, what ufw lists (not asked in a dry run), the defaults, the switch
      'ufw allow 22/tcp',
      'ufw allow 80/tcp',
      'ufw allow 443/tcp',
      'ufw allow 443/udp',
      'ufw default deny incoming',
      'ufw default allow outgoing',
      'ufw --force enable',
      'ufw status verbose',
      // the service
      'install -m 0644 -o root -g root sc-trade-site.service /etc/systemd/system/sc-trade-site.service',
      'systemctl daemon-reload',
      'systemctl enable sc-trade-site',
      'systemctl restart sc-trade-site',
      // Caddy, last
      'install -m 0644 -o root -g root logrotate.conf /etc/logrotate.d/sc-trade-site',
      'install -m 0644 -o root -g root Caddyfile /etc/caddy/Caddyfile.new',
      'caddy validate --config /etc/caddy/Caddyfile.new --adapter caddyfile',
      'mv /etc/caddy/Caddyfile.new /etc/caddy/Caddyfile',
      'systemctl enable caddy',
      'systemctl reload caddy',
    ]);
    // it says which ports stay open for SSH before it speaks of the switch
    expect(run.out.indexOf('    SSH stays open on: 22\n')).toBeGreaterThan(-1);
    expect(run.out.indexOf('    SSH stays open on: 22\n')).toBeLessThan(run.out.indexOf('would run: ufw --force enable'));
    // the password: it says that it would ask, asks nothing, and shows no command that carries one
    expect(run.out).toMatch(/would ask for the password/);
    expect(would.filter((line) => /configure\.mjs/.test(line))).toEqual([]);
    // the site it is for comes from the settings of the build
    expect(run.out).toMatch(/the site: sc-trade\.space, served from \/var\/www\/sc-trade\.space; the service on 127\.0\.0\.1:8787/);
  });

  it('opens the port SSH really comes in through — 2222 here, which only the socket of systemd and the listening socket show', () => {
    // the settings of the SSH server still say 22 (they do not know of a port set for the socket), and "sudo" has
    // taken SSH_CONNECTION away: the two other questions give the port away
    const { dir, started } = standIns({
      sshd: 'port 22\n',
      systemctl: 'Listen=[::]:2222 (Stream)\n',
      ss: 'LISTEN 0 4096 [::]:2222 [::]:* users:(("sshd",pid=812,fd=3),("systemd",pid=1,fd=118))\n',
    });
    const run = runBash([script(), '--dry-run'], { path: dir, cwd: site.deploy });
    expect(run.status).toBe(0);
    expect(started()).toEqual(QUESTIONS);
    const would = wouldRun(run.out);
    expect(run.out).toContain('    SSH stays open on: 22 2222\n');
    const rule = would.indexOf('ufw allow 2222/tcp');
    expect(rule).toBeGreaterThan(-1);
    expect(rule).toBeLessThan(would.indexOf('ufw default deny incoming'));
    expect(rule).toBeLessThan(would.indexOf('ufw --force enable'));
    expect(would.filter((line) => line.startsWith('ufw allow ')).slice(0, 2)).toEqual(['ufw allow 22/tcp', 'ufw allow 2222/tcp']);
  });

  it('takes the port of this very session when it is told of it (sudo --preserve-env=SSH_CONNECTION)', () => {
    const { dir } = standIns({ sshd: 'port 22\n' });
    const run = runBash([script(), '--dry-run'], { path: dir, cwd: site.deploy, env: { SSH_CONNECTION: '203.0.113.5 51234 198.51.100.7 2200' } });
    expect(run.status).toBe(0);
    expect(run.out).toContain('    SSH stays open on: 22 2200\n');
    expect(wouldRun(run.out)).toContain('ufw allow 2200/tcp');
  });

  it('does not touch the firewall when nothing says which port SSH comes in through — says so, and goes on with the rest', () => {
    // every question comes back empty
    const { dir, started } = standIns();
    const run = runBash([script(), '--dry-run'], { path: dir, cwd: site.deploy });
    expect(run.err).toBe('');
    expect(run.status).toBe(0);
    expect(started()).toEqual(QUESTIONS);
    const would = wouldRun(run.out);
    expect(would.filter((line) => line.startsWith('ufw'))).toEqual([]);
    expect(run.out).not.toMatch(/SSH stays open on/);
    expect(run.out).toMatch(/the firewall is NOT touched: nothing on this system says which port SSH comes in through/);
    // the steps after it are done all the same
    expect(would).toContain('systemctl restart sc-trade-site');
    expect(would).toContain('caddy validate --config /etc/caddy/Caddyfile.new --adapter caddyfile');
    expect([...run.out.matchAll(/^==> (\d)\/8 /gm)].map((match) => Number(match[1]))).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    // and the end says it once more, where it is read
    expect(run.out.slice(run.out.lastIndexOf('dry run:'))).toMatch(/the firewall is NOT touched/);
  });

  it('with --deploy-key names the file the keys of the upload user would come from', () => {
    const { dir, started } = standIns({ sshd: 'port 22\n' });
    const key = join(tempDir(), 'id_ed25519.pub');
    writeFileSync(key, 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMadeUpForTheTestsOnly sc-trade\n');
    const run = runBash([script(), '--deploy-key', forBash(key), '--dry-run'], { path: dir, cwd: site.deploy });
    expect(run.err).toBe('');
    expect(run.status).toBe(0);
    expect(started()).toEqual(QUESTIONS);
    expect(run.out).toContain(forBash(key));
    expect(run.out).toMatch(/would ask for the password/);
  });

  it('with --reset-password speaks of the password and the restart of the service only', () => {
    const { dir, started } = standIns({ sshd: 'port 22\n' });
    const run = runBash([script(), '--reset-password', '--dry-run'], { path: dir, cwd: site.deploy });
    expect(run.err).toBe('');
    expect(run.status).toBe(0);
    // not even the questions about SSH: the firewall is none of its business
    expect(started()).toEqual([]);
    expect(run.out).toMatch(/would ask for the new password/);
    expect(wouldRun(run.out)).toEqual(['chown root:sc-trade-site /etc/sc-trade-site/config.json', 'chmod 0640 /etc/sc-trade-site/config.json', 'systemctl restart sc-trade-site']);
    expect(run.out).not.toMatch(/==> \d\/8|apt-get|ufw|caddy|useradd/);
  });

  it('stops before anything else at an argument it does not know, without printing it back', () => {
    const { dir, started } = standIns();
    for (const args of [['--password', 'TYPED-BY-MISTAKE'], ['TYPED-BY-MISTAKE'], ['--dry-run', '--yes'], ['--deploy-key']]) {
      const run = runBash([script(), ...args], { path: dir, cwd: site.deploy });
      expect(run.status, args.join(' ')).toBe(1);
      expect(run.err).toMatch(/^\nSTOPPED: /);
      // nothing has begun: there is no state of the server to speak of
      expect(run.err).not.toMatch(/The server now/);
      expect(run.out + run.err).not.toContain('TYPED-BY-MISTAKE');
      expect(run.out).not.toMatch(/==> 1\/8/);
    }
    expect(started()).toEqual([]);
  });

  // (not when the tests themselves run as root: then the script would go on, and it must not be started here)
  it.skipIf(process.getuid?.() === 0)('without --dry-run does nothing unless it is root — and here it is not', () => {
    const { dir, started } = standIns();
    for (const args of [[], ['--reset-password']]) {
      const run = runBash([script(), ...args], { path: dir, cwd: site.deploy });
      if (run.status === 0) throw new Error('the script went on without being root');
      expect(run.err).toMatch(/STOPPED: (run it as root|this script is written for Ubuntu 24\.04)/);
      expect(run.out).not.toMatch(/==> 1\/8/);
    }
    expect(started()).toEqual([]);
  });

  it('prints its help and does nothing', () => {
    const { dir, started } = standIns();
    const run = runBash([script(), '--help'], { path: dir, cwd: site.deploy });
    expect(run.status).toBe(0);
    expect(run.out).toMatch(/sudo bash setup\.sh --dry-run/);
    expect(run.out).toMatch(/--reset-password/);
    expect(run.out).toMatch(/--deploy-key FILE/);
    expect(started()).toEqual([]);
  });
});

describe('the closing words of setup.sh', () => {
  it('tell the owner to test the login of the ADMINISTRATOR in a new window before he forbids passwords — a login as "deploy" does not count', () => {
    const words = body('closing_words');
    expect(words).toContain("'NOT done by this script: the settings of the SSH server are exactly as they were.'");
    expect(words).toMatch(/open a NEW window and log in as the administrator/);
    expect(words).toContain('ssh $admin@<this server>');
    expect(words).toMatch(/It must let you in WITHOUT asking for a password/);
    expect(words).toMatch(/A login as \\"\$DEPLOY_USER\\" does not count/);
    expect(words).toMatch(/site\/DEPLOY\.md/);
    // the administrator is the one who started the script, by name
    expect(words).toMatch(/local admin=\$\{SUDO_USER:-root\}/);
  });
});
