import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadDictionaries, siteDir } from '../../scripts/site/config.mjs';

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
    expect(text).not.toMatch(/authorized_keys"/);
    expect(text).toContain('ssh deploy@АДРЕС');
  });
});
