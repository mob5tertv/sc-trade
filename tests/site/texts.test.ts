import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadDictionaries, siteDir } from '../../scripts/site/config.mjs';
import { readSettings } from '../../site/server/src/config.mjs';
import { hashPassword } from '../../site/server/src/password.mjs';

// What the site says about the application must not be worded more strongly than its source (README.md, the part
// «Чего программа не делает»), and must not leave out what that part discloses.

const dictionaries = loadDictionaries(siteDir);
type Lang = 'ru' | 'en';
interface Item {
  title: string;
  text: string;
}
const items = (lang: Lang) => (dictionaries[lang].safety as unknown as { items: Item[] }).items;
const group = (lang: Lang, name: string) => dictionaries[lang][name] as Record<string, string>;
const guide = (name: string) => readFileSync(join(siteDir, name), 'utf8');

describe('the section about the game says what README says, no more', () => {
  it('names its six facts by what the source states', () => {
    expect(items('ru').map((item) => item.title)).toEqual([
      'Окно поверх игры',
      'Не забирает клавиатуру само',
      'Не внедряется и не читает память игры',
      'Не нажимает за тебя',
      'В сеть — только за данными UEX',
      'Данные — на твоём диске',
    ]);
    expect(items('en').map((item) => item.title)).toEqual([
      'A window over the game',
      'Never takes the keyboard by itself',
      "No injection, no reading of the game's memory",
      'Presses nothing for you',
      'Online only for UEX data',
      'Your data stays on your disk',
    ]);
  });

  it('claims nothing about reading in general or about the files of the game: README speaks of the memory only', () => {
    const ru = items('ru').map((item) => `${item.title} ${item.text}`).join(' ');
    const en = items('en').map((item) => `${item.title} ${item.text}`).join(' ');
    expect(ru).not.toMatch(/файл\S* игры/i);
    expect(ru).not.toMatch(/ничего не (внедряет и не )?читает/i);
    expect(en).not.toMatch(/game'?s files/i);
    expect(en).not.toMatch(/reads nothing/i);
    // and the keyboard is said to go to the window while typing, not to "stay with the game"
    expect(ru).not.toMatch(/клавиатура остаётся у игры/i);
    expect(en).not.toMatch(/keyboard stays with the game/i);
  });

  it('says where the keyboard goes back to: the window that had it (README:18)', () => {
    expect(items('ru')[1].text).toContain('только на время ввода в текстовое поле');
    expect(items('ru')[1].text).toContain('возвращается тому окну, у которого была (обычно это окно игры)');
    expect(items('en')[1].text).toContain('only while you type into a text field');
    expect(items('en')[1].text).toContain('goes back to the window that had it (usually the game)');
  });

  it('does not say that the program asks Windows one thing only: it also learns which window to give the keyboard back to', () => {
    expect(items('ru')[2].text).not.toMatch(/спрашивает у Windows одно/);
    expect(items('en')[2].text).not.toMatch(/one thing/);
  });

  it('says what the program asks Windows about other windows (README:18)', () => {
    const ru = items('ru')[2].text;
    expect(ru).toContain('не читает память игры');
    expect(ru).toContain('ничего не внедряет в чужие процессы');
    expect(ru).toContain('какому процессу принадлежит активное окно');
    expect(ru).toMatch(/не сохраняется и не пишется в лог/);
    const en = items('en')[2].text;
    expect(en).toContain("does not read the game's memory");
    expect(en).toContain('which process the active window belongs to');
    expect(en).toMatch(/not kept anywhere and not written to the log/);
  });

  it('discloses that Windows calls the program for every key press while a key is assigned (README:16)', () => {
    const ru = items('ru')[3].text;
    expect(ru).toContain('не посылает нажатий клавиш и кликов');
    expect(ru).toContain('по умолчанию не назначено ничего');
    expect(ru).toContain('Пока назначена хотя бы одна, Windows вызывает программу при каждом нажатии любой клавиши');
    expect(ru).toContain('не читает состояние Ctrl, Alt и Shift и ничего не запоминает');
    expect(ru).toMatch(/Любое нажатие она передаёт дальше: игра получает его, как обычно/);
    const en = items('en')[3].text;
    expect(en).toContain('sends no key presses and no clicks');
    expect(en).toContain('nothing is assigned by default');
    expect(en).toContain('While at least one is assigned, Windows calls the app on every press of any key');
    expect(en).toContain('does not read the state of Ctrl, Alt and Shift and remembers nothing');
    expect(en).toMatch(/It passes every press on: the game gets it as usual/);
  });
});

describe('other wordings', () => {
  it('the download section speaks of the page, not of what is kept on the server (old installers stay reachable there)', () => {
    expect(group('ru', 'download').latest_only).toBe('На странице — только последняя версия.');
    expect(group('en', 'download').latest_only).toBe('This page offers only the latest version.');
  });

  it('the line under the form does not say that nothing else is sent: every request also carries what any request carries', () => {
    expect(group('ru', 'feedback').privacy).not.toMatch(/только то, что/);
    expect(group('en', 'feedback').privacy).not.toMatch(/^Only what/);
    expect(group('ru', 'feedback').privacy).toMatch(/увидит только автор/);
    expect(group('en', 'feedback').privacy).toMatch(/Only the author sees it/);
  });
});

describe('the guides for the user', () => {
  it('do not speak of the numbers of our tasks', () => {
    for (const name of ['DEPLOY.md', 'VIDEO.md']) expect(guide(name), name).not.toMatch(/задач\S*\s*\(?53|task 53/i);
  });

  it('ask for a random password of sixteen characters or more, and say why a made-up one will not do', () => {
    const text = guide('DEPLOY.md');
    expect(text).toContain('The password of the admin page (16 characters or more; nothing is shown while you type):');
    expect(text).toMatch(/Пароль должен быть \*\*случайным\*\*: создай его в менеджере паролей \(16 знаков или больше\)/);
    expect(text).toMatch(/подбор\s+пароля служба только тормозит/);
    expect(text).toMatch(/не больше одного пароля в секунду/);
    // the guide never shows a password and never asks to send one anywhere
    expect(text).not.toMatch(/пароль\s*[:=]\s*\S|password\s*[:=]\s*\S/i);
  });

  it('say what the author can do when the storage fills up, and what keeps it from filling within the hour', () => {
    const text = guide('DEPLOY.md');
    expect(text).toMatch(/«Удалить\s+отмеченные»/);
    expect(text).toMatch(/«Удалить всё найденное»/);
    expect(text).toMatch(/больше 80 %/);
    expect(text).toMatch(/не больше 40 МБ в сутки с одного адреса и не больше 200 МБ в\s+час от всех вместе/);
  });

  it('give the key for uploads to the upload user, not to root', () => {
    const text = guide('DEPLOY.md');
    expect(text).not.toMatch(/root@\S+ "mkdir -p ~\/\.ssh/);
    expect(text).toContain('ssh deploy@АДРЕС');
    // a command that writes a key into authorized_keys by hand is for the administrator's own login, wherever the
    // guide gives it: the upload user gets its keys from setup.sh
    const written = text.split(/\r?\n/).filter((line) => />>?\s*\S*authorized_keys/.test(line));
    expect(written.length).toBeGreaterThanOrEqual(1);
    for (const line of written) {
      expect(line).toContain('ssh АДМИН@АДРЕС');
      expect(line).not.toMatch(/deploy/);
    }
  });

  /** A part of the guide, from its heading to the next heading of the same depth. */
  const part = (heading: RegExp) => {
    const text = guide('DEPLOY.md').replaceAll('\r\n', '\n');
    const start = text.search(heading);
    expect(start, String(heading)).toBeGreaterThan(-1);
    const depth = /^#+/.exec(text.slice(start))![0];
    const rest = text.slice(start + depth.length);
    const end = rest.search(new RegExp(`^#{1,${depth.length}} `, 'm'));
    return text.slice(start, end === -1 ? undefined : start + depth.length + end);
  };

  it('name no version of the installer in their examples: they do not go stale at the next one', () => {
    const text = guide('DEPLOY.md');
    expect(text).not.toMatch(/\d+\.\d+\.\d+[-_]|_\d+\.\d+\.\d+/);
    expect(text).toContain('SC Trade_<версия>_x64-setup.exe');
    expect(text.match(/SC-Trade-<версия>-setup\.exe/g)!.length).toBeGreaterThanOrEqual(2);
  });

  it('start the script one way, for the dry run and for the real one: with the port of the session handed on', () => {
    const text = guide('DEPLOY.md');
    // plain "sudo" hides the port; the only run that does not need it is the one that leaves the firewall alone
    const plain = text.split(/\r?\n/).filter((line) => /sudo bash setup\.sh/.test(line) && !/--reset-password/.test(line));
    expect(plain).toEqual([]);
    expect(part(/^### 4\.4\. /m)).toContain('\nsudo --preserve-env=SSH_CONNECTION bash setup.sh --dry-run\n');
    expect(part(/^### 4\.5\. /m)).toContain('\nsudo --preserve-env=SSH_CONNECTION bash setup.sh\n');
    expect(part(/^### 4\.9\. /m)).toContain('\nsudo bash setup.sh --reset-password\n');
    // and a port that is not 22 is named when logging in and when copying
    expect(text).toContain('ssh -p ПОРТ АДМИН@АДРЕС');
    expect(text).toMatch(/scp -P ПОРТ /);
  });

  it('make the owner look at his server before the script is run: a way back in, the system, the port of SSH, his own key', () => {
    const before = part(/^### 4\.3\. /m);
    expect(before).toMatch(/^### 4\.3\. Перед запуском: порт SSH и свой ключ$/m);
    // what the list of checks used to begin with belongs here: it is done before the run, not after it
    expect(before).toMatch(/второе окно/);
    expect(before).toMatch(/веб-консоль/);
    expect(before).toContain("grep -E '^(ID|VERSION_ID)=' /etc/os-release");
    expect(before).toContain('apt-cache policy caddy nodejs');
    expect(before).toContain("sudo sshd -T | grep -i '^port'");
    expect(before).toContain('echo $SSH_CONNECTION');
    // the one command, and why it is harmless where the port is 22
    expect(before).toContain('\nsudo --preserve-env=SSH_CONNECTION bash setup.sh\n');
    expect(before).toMatch(/При порте 22[^.]*ничего не меняют/);
    // a hoster that gave only a password for root: the public key goes up first, with the exact command
    expect(before).toContain(`Get-Content $env:USERPROFILE\\.ssh\\id_ed25519.pub | ssh АДМИН@АДРЕС "mkdir -p ~/.ssh && chmod 700 ~/.ssh && tr -d '\\r' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"`);
    expect(before).toMatch(/спросит пароль[^.]*в последний раз|последний раз[^.]*парол/);
    // and how to give the upload user another key than one's own
    expect(before).toContain('scp $env:USERPROFILE\\.ssh\\id_ed25519.pub АДМИН@АДРЕС:');
    expect(before).toContain('sudo --preserve-env=SSH_CONNECTION bash setup.sh --deploy-key ~/id_ed25519.pub');
  });

  it('say what the dry run must show', () => {
    const dry = part(/^### 4\.4\. /m);
    for (const seen of ['`==> 1/8`', '`==> 8/8`', '`the site: sc-trade.space, served from /var/www/sc-trade.space; the service on 127.0.0.1:8787`', '`SSH stays open on: …`', '`dry run: nothing is changed`', '`the firewall is NOT touched`']) {
      expect(dry, seen).toContain(seen);
    }
  });

  it('tell the steps of the script in the order it does them, each with the line it prints: the firewall and the service before Caddy', () => {
    const run = part(/^### 4\.5\. /m);
    const order = ['`caddy`, `nodejs`, `ufw`, `logrotate`', '`sc-trade-site`', '/var/www/sc-trade.space', '/opt/sc-trade-site', 'спрашивает пароль страницы автора', 'включает брандмауэр', 'запускает службу', 'caddy validate'].map((mark) => run.indexOf(mark));
    for (const index of order) expect(index).toBeGreaterThan(-1);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // what the owner must see, in the order the script prints it
    const seen = ['`Node 18`', '`keys of deploy:', '`SSH stays open on:', '`Status: active`', '`the service answers on 127.0.0.1:8787`', '`Valid configuration`', '`Done.`'].map((mark) => run.indexOf(mark));
    for (const index of seen) expect(index).toBeGreaterThan(-1);
    expect([...seen].sort((a, b) => a - b)).toEqual(seen);
    // the lock of the packages on a fresh server, a ufw that cannot be switched on, and what the end says then
    expect(run).toMatch(/ждёт до двух минут/);
    expect(run).toMatch(/не удалось включить[\s\S]*идёт дальше/);
    expect(run).toContain('`NOT ALL DONE - the firewall is OFF`');
    // what a second run does, said as it is
    expect(run).not.toMatch(/то, что уже на месте, он не трогает/);
    expect(run).toMatch(/Повторный запуск[\s\S]*заменяет код службы[\s\S]*перезапускает службу[\s\S]*Caddy/);
    expect(run).toMatch(/пароль во второй раз не\s+спрашивает/);
  });

  it('carry the ordered list of what to verify on the server AFTER the run, with every command as it is typed', () => {
    const check = part(/^### 4\.6\. /m);
    expect(check).toMatch(/^### 4\.6\. Проверка после настройки$/m);
    const steps = check.split('\n').filter((line) => /^\d+\. /.test(line)).map((line) => Number(line.split('.')[0]));
    expect(steps).toEqual(Array.from({ length: 15 }, (_, index) => index + 1));
    // it begins with the first thing to check once the script has ended: the new window. What is done before the
    // run stands where it is done (4.3, 4.4), and what the run prints stands with the run (4.5)
    expect(check).toMatch(/^1\. Открой новое окно и войди: `ssh АДМИН@АДРЕС`/m);
    expect(check).not.toMatch(/apt-cache|--dry-run|sshd -T|os-release|SSH_CONNECTION bash setup\.sh --/);
    for (const command of [
      'ssh АДМИН@АДРЕС',
      'ssh deploy@АДРЕС',
      'sudo -n true',
      'systemctl is-active caddy sc-trade-site',
      'sudo ufw status',
      'sudo journalctl -u sc-trade-site -n 20 --no-pager',
      "sudo ss -ltnp | grep -E ':(8787|2019|80|443)\\b'",
      "sudo stat -c '%A %U:%G %n' /etc/sc-trade-site /etc/sc-trade-site/config.json /var/lib/sc-trade-site /opt/sc-trade-site /var/www/sc-trade.space /var/log/caddy/sc-trade-error.log /etc/logrotate.d/sc-trade-site /home/deploy/.ssh/authorized_keys",
      'sudo -u deploy cat /etc/sc-trade-site/config.json',
      'sudo -u deploy ls /var/lib/sc-trade-site',
      'sudo -u deploy touch /opt/sc-trade-site/x',
      'curl.exe https://sc-trade.space/api/',
      'curl.exe -i https://sc-trade.space/admin/',
      'curl.exe --max-time 5 http://АДРЕС:8787/api/',
      'npm run site:deploy -- --yes',
      'ssh deploy@АДРЕС "ls -l /var/www/sc-trade.space"',
      'sudo systemctl stop sc-trade-site',
      'sudo tail -n 1 /var/log/caddy/sc-trade-error.log',
      'sudo logrotate --debug /etc/logrotate.conf 2>&1 | grep -i -A12 sc-trade-error',
      'sudo ls -ls /var/log/caddy/',
      'systemd-analyze verify /etc/systemd/system/sc-trade-site.service',
      'sudo reboot',
      'sudo --preserve-env=SSH_CONNECTION bash setup.sh',
    ]) {
      expect(check, command).toContain(command);
    }
    // the new window is refused: the way back is in the window that is still open — said at that very step
    const first = check.slice(check.indexOf('\n1. '), check.indexOf('\n2. '));
    expect(first).toContain('`sudo ufw disable`');
    expect(first).toContain('`sudo ufw allow ПОРТ/tcp`');
    expect(first).toMatch(/веб-консоль хостера/);
    // whether the firewall is on is asked of ufw itself: systemd says "active" of a ufw that is switched off
    expect(check).not.toMatch(/is-active[^\n`]*ufw/);
    expect(check).toMatch(/`sudo ufw status`[^.]*`Status: active`/);
    for (const expected of ['`drwxr-x--- root:sc-trade-site`', '`-rw-r----- root:sc-trade-site`', '`drwx------ sc-trade-site:sc-trade-site`', '`drwxr-xr-x root:root`', '`drwxr-xr-x deploy:deploy`', '`-rw-r----- caddy:caddy`', '`-rw-r--r-- root:root`', '`-rw------- deploy:deploy`', '`226/NAMESPACE`', '`218/CAPABILITIES`', '`remote_ip`', '`headers`', '`{"ok":true}`', '`of them new: 0`']) {
      expect(check, expected).toContain(expected);
    }
    // the rotated part of the log is there after the second night, not the first
    expect(check).toMatch(/Через два дня[\s\S]*`sc-trade-error\.log\.1`/);
    // the last step sends to the SSH section, and says whose login is to be tested there
    expect(check).toMatch(/15\. [\s\S]*4\.11[\s\S]*администратор[\s\S]*не\s+`deploy`/);
  });

  it('cannot lock the administrator out when he forbids passwords: the login to test is his own, in a new window', () => {
    const ssh = part(/^### 4\.11\. /m);
    expect(ssh).toMatch(/^### 4\.11\. SSH: запретить вход по паролю$/m);
    // whose login, how, and what does not count
    const login = ssh.indexOf('ssh АДМИН@АДРЕС');
    expect(login).toBeGreaterThan(-1);
    expect(ssh).toMatch(/\*\*нов\S+ окн\S+\*\*/);
    expect(ssh).toMatch(/не должен спросить пароль/);
    expect(ssh).toMatch(/Вход пользователем `deploy` не считается/);
    expect(ssh).toMatch(/не закрывая окно/);
    // the key of the administrator is in place first: the exact command that puts it there, the same as before the
    // set-up, and the one that shows it is there
    const put = ssh.indexOf(`Get-Content $env:USERPROFILE\\.ssh\\id_ed25519.pub | ssh АДМИН@АДРЕС "mkdir -p ~/.ssh && chmod 700 ~/.ssh && tr -d '\\r' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"`);
    expect(put).toBeGreaterThan(-1);
    expect(ssh).toContain('ssh АДМИН@АДРЕС "grep -c . ~/.ssh/authorized_keys"');
    // a window that is refused altogether is the firewall, not the key: the way back is named here as well
    expect(ssh).toContain('`sudo ufw disable`');
    expect(ssh).toContain('`sudo ufw allow ПОРТ/tcp`');
    expect(ssh.indexOf('`sudo ufw disable`')).toBeLessThan(ssh.indexOf('| sudo tee '));
    // the file is made by one command, typed as it stands — and it loosens nothing a hoster has set: it forbids
    // passwords and says no word about the login of root
    const made = ssh.indexOf(`printf '%s\\n' 'PasswordAuthentication no' 'KbdInteractiveAuthentication no' | sudo tee /etc/ssh/sshd_config.d/00-sc-trade.conf`);
    expect(made).toBeGreaterThan(login);
    expect(made).toBeGreaterThan(put);
    expect(ssh).not.toMatch(/'PermitRootLogin|PermitRootLogin (prohibit-password|yes|no|without-password)/);
    expect(ssh).toMatch(/`PermitRootLogin`[^.]*нет[\s\S]*не ослаб/);
    const checked = ssh.indexOf('sudo sshd -t');
    const applied = ssh.indexOf('sudo systemctl reload ssh');
    expect(checked).toBeGreaterThan(made);
    expect(applied).toBeGreaterThan(checked);
    // a check that prints anything: the file goes, and nothing is applied
    const said = ssh.slice(checked, applied);
    expect(said).toMatch(/что-нибудь напечатала/);
    expect(said).toContain('sudo rm /etc/ssh/sshd_config.d/00-sc-trade.conf');
    expect(said).toMatch(/не\s+выполняй следующий шаг/);
    // after it: the same test once more, and the way back if it fails
    expect(ssh.indexOf('ssh АДМИН@АДРЕС', applied)).toBeGreaterThan(applied);
    expect(ssh.indexOf('sudo rm /etc/ssh/sshd_config.d/00-sc-trade.conf', applied)).toBeGreaterThan(applied);
  });

  it('say what to do when there is no certificate, and for each thing the script may say of the firewall — the same thing the script says', () => {
    const trouble = part(/^### 4\.12\. /m);
    expect(trouble).toMatch(/^### 4\.12\. Если что-то не работает$/m);
    expect(trouble).toMatch(/Нет сертификата/);
    const from = trouble.indexOf('Нет сертификата');
    expect(trouble.indexOf('sudo tail -n 20 /var/log/caddy/sc-trade-error.log', from)).toBeGreaterThan(from);
    expect(trouble.indexOf('nslookup sc-trade.space', from)).toBeGreaterThan(from);
    expect(trouble.indexOf('sudo systemctl reload caddy', from)).toBeGreaterThan(from);
    // and every check of a Caddyfile by hand goes through sudo
    for (const line of guide('DEPLOY.md').split(/\r?\n/).filter((row) => /caddy validate --config/.test(row))) expect(line).toMatch(/sudo caddy validate/);

    // the three messages of the firewall step, each with its own advice
    const setup = readFileSync(join(siteDir, 'deploy', 'setup.sh'), 'utf8');
    const entry = (words: string) => {
      const start = trouble.indexOf(words);
      expect(start, words).toBeGreaterThan(-1);
      const end = trouble.indexOf('\n- ', start);
      return trouble.slice(start, end === -1 ? undefined : end);
    };
    // no port was named: look at the port, start again the one way
    expect(setup).toContain('the firewall is NOT touched: nothing on this system says which port SSH comes in through');
    expect(entry('`the firewall is NOT touched`')).toMatch(/4\.3[\s\S]*той же командой/);
    // ufw does not list the rule: the script says to look at "ufw show added" for "ufw allow PORT/tcp" — so does the guide
    expect(setup).toMatch(/the firewall is NOT turned on: ufw does not list a rule that lets SSH in on port \$port\. Nothing is shut\. Look at what 'ufw show added' prints: once 'ufw allow \$port\/tcp' is among its lines, start this script again\./);
    const listed = entry('`the firewall is NOT turned on: ufw does not list a rule');
    expect(listed).toContain('sudo ufw show added');
    expect(listed).toContain('`ufw allow ПОРТ/tcp`');
    expect(listed).toMatch(/запусти скрипт\s+ещё раз/);
    expect(listed).not.toMatch(/4\.3/);
    // ufw cannot be switched on at all: the firewall of the hoster
    expect(setup).toContain('the firewall is NOT turned on: ufw could not be switched on');
    expect(entry('`the firewall is NOT turned on: ufw could not be switched on')).toMatch(/в панели хостера[\s\S]*порт SSH, 80 и 443/);
    // ufw was on before the run and did not come on again: the script never switches it off — what to look at
    expect(setup).toContain('ufw was already ON before this run, and it is NOT switched off');
    const wasOn = entry('`ufw was already ON before this run');
    expect(wasOn).toMatch(/не выключил/);
    expect(wasOn).toContain('sudo ufw status verbose');
    // and the end of the script names the state the firewall is really in
    expect(setup).toContain('NOT ALL DONE - the firewall is $firewall_now. Everything else is set up.');
    expect(trouble).toContain('`NOT ALL DONE - the firewall is ON as it was before this run`');
  });

  it('keep the copy of the messages closed to other users of the server, and say who else can keep the author out of his page', () => {
    const data = part(/^### 4\.10\. /m);
    expect(data).toContain("sudo sh -c 'umask 077; tar -czf sc-trade-messages.tar.gz -C /var/lib sc-trade-site'");
    expect(data).toMatch(/sc-trade-site\.marker/);
    const page = part(/^### 4\.7\. /m);
    expect(page).toMatch(/с одного адреса[\s\S]*(общий|одним)[\s\S]*пятью неверными паролями[\s\S]*15 минут/);
  });

  it('say honestly what the service does not promise: it can be made unavailable for a time, not read and not emptied', () => {
    const honest = part(/^### 4\.13\. /m);
    expect(honest).toMatch(/^### 4\.13\. Чего служба не обещает$/m);
    // the form: the limits of the hour, and the four places
    expect(honest).toMatch(/120 сообщений[\s\S]*200 МБ в час/);
    expect(honest).toMatch(/считается последний час/);
    expect(honest).toMatch(/четырёх сообщений сразу[\s\S]*16 КБ в секунду/);
    // the login
    expect(honest).toContain('«Сервер занят»');
    expect(honest).toMatch(/32 места[\s\S]*по одному на адрес/);
    expect(honest).toMatch(/отличить тебя от\s+чужого адреса[^.]*не может/);
    // what it cannot do
    expect(honest).toMatch(/прочитать или удалить сообщения[^.]*нельзя/);
    // what the author does then
    expect(honest).toMatch(/подождать/);
    expect(honest).toContain('`sudo systemctl restart sc-trade-site`');
    expect(honest).toMatch(/обнуляет все счётчики/);
    expect(honest).toMatch(/брандмауэром в панели хостера/);
    // one network of IPv6 is one sender
    expect(honest).toMatch(/IPv6[\s\S]*\/64[\s\S]*один отправитель/);
    // and the numbers it names are the ones the service has
    const limits = readSettings({ domain: 'site.example', dataDir: '/var/lib/sc-trade-site', passwordHash: hashPassword('a password of this test only', { N: 16384, r: 8, p: 1 }) }).limits;
    expect([limits.globalHour, limits.globalHourBytes / 1024 / 1024, limits.uploadsAtOnce, limits.minBytesPerSecond / 1024, limits.loginQueue, limits.rateWindowMs * 2]).toEqual([120, 200, 4, 16, 32, 10_000]);
    expect(honest).toMatch(/через десять секунд/);
  });
});
