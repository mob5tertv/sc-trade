import { beforeAll, describe, expect, it } from 'vitest';
import { loadConfig, loadDictionaries, siteDir } from '../../scripts/site/config.mjs';
import { checkFeedback, countChars, ERROR_CODES, LIMITS, progressPercent, readReply } from '../../site/js/feedback-rules.js';
import { build, type Built } from './helpers';

const config = loadConfig(siteDir);
const dictionaries = loadDictionaries(siteDir);
const MB = 1024 * 1024;

const png = (size = 1000, name = 'screen.png') => ({ name, size, type: 'image/png' });
const log = (size = 1000, name = 'sctrade.log') => ({ name, size, type: '' });
const good = () => ({ message: 'The window does not unfold after an update.', contact: '', shots: [png()], logs: [log()] });

describe('the limits of the feedback form are those of the contract with the server', () => {
  it('message 10–4000, contact up to 200, three pictures of 5 MB, one log of 2 MB', () => {
    expect(LIMITS).toEqual({ messageMin: 10, messageMax: 4000, contactMax: 200, shotsMax: 3, shotBytes: 5 * MB, logsMax: 1, logBytes: 2 * MB });
  });

  it('knows every error code of the contract', () => {
    expect([...ERROR_CODES].sort()).toEqual(['bad_file_type', 'file_too_big', 'rate_limited', 'server', 'spam', 'too_long', 'too_many_files', 'too_short']);
  });
});

describe('the page checks a message before it is sent', () => {
  it('lets a good message through', () => {
    expect(checkFeedback(good())).toBeNull();
    expect(checkFeedback({ message: '1234567890', contact: '', shots: [], logs: [] })).toBeNull();
  });

  it('refuses a message shorter than 10 characters, spaces at the ends not counted', () => {
    expect(checkFeedback({ ...good(), message: '123456789' })).toBe('too_short');
    expect(checkFeedback({ ...good(), message: '   12345   \n\n ' })).toBe('too_short');
    expect(checkFeedback({ ...good(), message: '' })).toBe('too_short');
  });

  it('refuses a message longer than 4000 characters and a contact longer than 200', () => {
    expect(checkFeedback({ ...good(), message: 'я'.repeat(4000) })).toBeNull();
    expect(checkFeedback({ ...good(), message: 'я'.repeat(4001) })).toBe('too_long');
    expect(checkFeedback({ ...good(), contact: 'c'.repeat(200) })).toBeNull();
    expect(checkFeedback({ ...good(), contact: 'c'.repeat(201) })).toBe('too_long');
  });

  it('counts characters, not the halves of a character that takes two', () => {
    expect(countChars('abc')).toBe(3);
    expect(countChars('🚀🚀')).toBe(2);
    expect(checkFeedback({ ...good(), message: '🚀'.repeat(4000) })).toBeNull();
  });

  it('refuses more than three pictures and more than one log', () => {
    expect(checkFeedback({ ...good(), shots: [png(), png(), png()] })).toBeNull();
    expect(checkFeedback({ ...good(), shots: [png(), png(), png(), png()] })).toBe('too_many_files');
    expect(checkFeedback({ ...good(), logs: [log(), log()] })).toBe('too_many_files');
  });

  it('takes PNG, JPEG and WebP pictures only', () => {
    for (const shot of [
      { name: 'a.PNG', size: 1, type: 'image/png' },
      { name: 'a.jpg', size: 1, type: 'image/jpeg' },
      { name: 'a.jpeg', size: 1, type: 'image/jpeg' },
      { name: 'a.webp', size: 1, type: 'image/webp' },
      { name: 'a.png', size: 1, type: '' }, // a browser that does not know the type: the name decides
    ]) {
      expect(checkFeedback({ ...good(), shots: [shot] }), shot.name).toBeNull();
    }
    for (const shot of [
      { name: 'a.gif', size: 1, type: 'image/gif' },
      { name: 'a.bmp', size: 1, type: 'image/bmp' },
      { name: 'a.png', size: 1, type: 'application/pdf' },
      { name: 'a.exe', size: 1, type: 'image/png' },
      { name: 'a.svg', size: 1, type: 'image/svg+xml' },
      { name: 'noextension', size: 1, type: '' },
    ]) {
      expect(checkFeedback({ ...good(), shots: [shot] }), `${shot.name} ${shot.type}`).toBe('bad_file_type');
    }
  });

  it('takes a .log or a .txt file as the log, nothing else', () => {
    expect(checkFeedback({ ...good(), logs: [log(1, 'sctrade.log')] })).toBeNull();
    expect(checkFeedback({ ...good(), logs: [log(1, 'SCTRADE.TXT')] })).toBeNull();
    expect(checkFeedback({ ...good(), logs: [log(1, 'sctrade.log.zip')] })).toBe('bad_file_type');
    expect(checkFeedback({ ...good(), logs: [log(1, 'sctrade.db')] })).toBe('bad_file_type');
  });

  it('refuses a picture over 5 MB and a log over 2 MB', () => {
    expect(checkFeedback({ ...good(), shots: [png(5 * MB)] })).toBeNull();
    expect(checkFeedback({ ...good(), shots: [png(5 * MB + 1)] })).toBe('file_too_big');
    expect(checkFeedback({ ...good(), logs: [log(2 * MB)] })).toBeNull();
    expect(checkFeedback({ ...good(), logs: [log(2 * MB + 1)] })).toBe('file_too_big');
  });

  it('names the text first: a short message with a wrong file is a short message', () => {
    expect(checkFeedback({ message: 'short', contact: '', shots: [png(9 * MB, 'a.gif')], logs: [] })).toBe('too_short');
  });
});

describe('the answer of the server', () => {
  it('is a success only when the server says ok: true', () => {
    expect(readReply(200, '{"ok":true}')).toEqual({ ok: true });
    expect(readReply(200, '{"ok":"yes"}')).toEqual({ ok: false, error: 'server' });
    expect(readReply(200, '{}')).toEqual({ ok: false, error: 'server' });
  });

  it.each(ERROR_CODES)('carries the code %s of the contract', (code) => {
    expect(readReply(code === 'rate_limited' ? 429 : 400, JSON.stringify({ ok: false, error: code }))).toEqual({ ok: false, error: code });
  });

  it('is a failure of the server when it is not what the contract says', () => {
    expect(readReply(200, '<html>502 Bad Gateway</html>')).toEqual({ ok: false, error: 'server' });
    expect(readReply(502, '')).toEqual({ ok: false, error: 'server' });
    expect(readReply(200, '{"ok":false,"error":"something_new"}')).toEqual({ ok: false, error: 'server' });
    expect(readReply(200, '{"ok":false}')).toEqual({ ok: false, error: 'server' });
    expect(readReply(200, 'null')).toEqual({ ok: false, error: 'server' });
    // a success that came with an error status is not a success
    expect(readReply(500, '{"ok":true}')).toEqual({ ok: false, error: 'server' });
  });

  it('reads the two refusals a web server gives before the service is asked', () => {
    expect(readReply(413, 'Request Entity Too Large')).toEqual({ ok: false, error: 'file_too_big' });
    expect(readReply(429, '')).toEqual({ ok: false, error: 'rate_limited' });
  });
});

describe('the progress of sending', () => {
  it('is a whole percent between 0 and 100', () => {
    expect(progressPercent(0, 1000)).toBe(0);
    expect(progressPercent(333, 1000)).toBe(33);
    expect(progressPercent(1000, 1000)).toBe(100);
    expect(progressPercent(1500, 1000)).toBe(100);
    expect(progressPercent(10, 0)).toBe(0);
  });
});

describe('the form on the page', () => {
  let site: Built;
  beforeAll(() => {
    site = build();
  });

  const formOf = (page: string) => /<form[\s\S]*?<\/form>/.exec(site.read(page))?.[0] ?? '';

  it.each([
    ['ru', 'index.html'],
    ['en', 'en/index.html'],
  ] as const)('sends every field of the contract, as multipart/form-data, to the endpoint of the settings (%s)', (lang, page) => {
    const form = formOf(page);
    expect(config.feedback.endpoint).toBe('/api/feedback');
    expect(form).toMatch(/<form[^>]*\saction="\/api\/feedback"/);
    expect(form).toMatch(/<form[^>]*\smethod="post"/);
    expect(form).toMatch(/<form[^>]*\senctype="multipart\/form-data"/);

    expect(form).toMatch(/<textarea[^>]*\sname="message"[^>]*\srequired[^>]*\sminlength="10"[^>]*\smaxlength="4000"/);
    expect(form).toMatch(/<input[^>]*\stype="text"[^>]*\sname="contact"[^>]*\smaxlength="200"/);
    expect(form).toMatch(/<input[^>]*\stype="file"[^>]*\sname="shots\[\]"[^>]*\smultiple[^>]*\saccept="image\/png,image\/jpeg,image\/webp"/);
    expect(form).toMatch(/<input[^>]*\stype="file"[^>]*\sname="log"[^>]*\saccept="\.log,\.txt,text\/plain"/);
    expect(form).toMatch(new RegExp(`<input[^>]*\\stype="hidden"[^>]*\\sname="lang"[^>]*\\svalue="${lang}"`));
    expect(form).toMatch(/<input[^>]*\stype="hidden"[^>]*\sname="started"/);
    // the trap for robots: an ordinary text field nobody sees, not reachable with Tab, empty
    expect(form).toMatch(/<input[^>]*\stype="text"[^>]*\sname="website"[^>]*\stabindex="-1"[^>]*\sautocomplete="off"/);
    expect(form).not.toMatch(/name="website"[^>]*\svalue="[^"]/);
    expect([...form.matchAll(/\sname="([^"]+)"/g)].map((match) => match[1]).sort()).toEqual(['contact', 'lang', 'log', 'message', 'shots[]', 'started', 'website']);
  });

  it.each([
    ['ru', 'index.html'],
    ['en', 'en/index.html'],
  ] as const)('has a text in its own language for every error code (%s)', (lang, page) => {
    const form = formOf(page);
    const errors = (dictionaries[lang].feedback as { errors: Record<string, string> }).errors;
    expect(Object.keys(errors).sort()).toEqual([...ERROR_CODES].sort());
    for (const code of ERROR_CODES) {
      const text = new RegExp(`\\sdata-error-${code}="([^"]+)"`).exec(form)?.[1];
      expect(text, code).toBeTruthy();
      expect(text).toBe(errors[code].replaceAll('&', '&amp;').replaceAll('"', '&quot;'));
    }
  });

  it('is hidden until the script shows it; without a script the visitor reads where to write instead', () => {
    for (const page of ['index.html', 'en/index.html']) {
      const html = site.read(page);
      const part = /<section[^>]*\sid="feedback"[\s\S]*?<\/section>/.exec(html)?.[0] ?? '';
      expect(formOf(page)).toMatch(/<form[^>]*\shidden/);
      expect(part).toMatch(/<noscript>[\s\S]*<\/noscript>/);
      expect(part).toMatch(new RegExp(`<a[^>]*href="${config.links.twitch}"[^>]*rel="noopener noreferrer"`));
      // the link to Twitch stands outside the form and outside <noscript>: it is there with and without a script
      const outside = part.replace(/<form[\s\S]*?<\/form>/, '').replace(/<noscript>[\s\S]*?<\/noscript>/, '');
      expect(outside).toContain(config.links.twitch);
    }
  });

  it('says next to the form what is sent and who sees it, and where the log of the application is', () => {
    for (const [lang, page] of [['ru', 'index.html'], ['en', 'en/index.html']] as const) {
      const form = formOf(page);
      const texts = dictionaries[lang].feedback as Record<string, string>;
      expect(form).toContain(texts.privacy);
      expect(form).toContain('sctrade.log');
      expect(form).toMatch(/<a[^>]*href="data\.html"/);
    }
  });

  it('carries the rules of the form in the script of the page', () => {
    const script = site.read('assets/js/site.js');
    expect(script).toContain('function checkFeedback');
    expect(script).toContain("'shots[]'");
    expect(script).toContain('XMLHttpRequest');
  });
});
