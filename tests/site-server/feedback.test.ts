import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { LIMITS } from '../../site/server/src/rules.mjs';
import {
  DAY_MS,
  everythingIn,
  feedbackReplies,
  fields,
  JPEG,
  listFiles,
  LOG_TEXT,
  logFile,
  multipart,
  OK,
  ORIGIN,
  PNG,
  rawSend,
  refused,
  request,
  send,
  SENDER,
  shot,
  start,
  START,
  stored,
  tempDir,
  until,
  WEBP,
  type Part,
} from './helpers';

const HOUR_MS = 3_600_000;
const STORED_NAME = /^[0-9a-f]{32}\.(png|jpg|webp|txt)$/;
const tmpOf = (dir: string) => readdirSync(join(dir, 'tmp'));

/** Nothing of a refused message stays: no message, no file, nothing in the work folder. */
function expectNothingKept(dir: string) {
  expect(listFiles(dir)).toEqual([]);
  expect(tmpOf(dir)).toEqual([]);
}

afterAll(() => {
  // «Страницы не ставят cookie»: of all the answers this file got from /api/feedback, not one set a cookie
  expect(feedbackReplies.length).toBeGreaterThan(50);
  for (const reply of feedbackReplies) expect(reply.headers['set-cookie']).toBeUndefined();
});

describe('POST /api/feedback takes a message', () => {
  it('keeps the text, the contact, the language and the time, and answers {"ok":true}', async () => {
    const run = await start();
    const reply = await send(run, fields(run.clock, { message: '  Цена кванта на Area 18 неверная.\r\nПроверь, пожалуйста.  ', contact: ' someone#1234 ', lang: 'ru' }));
    expect(reply.status).toBe(200);
    expect(reply.json).toEqual(OK);
    const [record] = stored(run.dir);
    expect(record).toEqual({
      id: expect.stringMatching(/^[0-9a-f]{32}$/),
      receivedAt: '2026-10-10T12:00:00.000Z',
      lang: 'ru',
      message: 'Цена кванта на Area 18 неверная.\nПроверь, пожалуйста.',
      contact: 'someone#1234',
      files: [],
    });
    expect(listFiles(run.dir)).toEqual([`messages/${record.id}.json`]);
    expect(tmpOf(run.dir)).toEqual([]);
  });

  it('needs nothing but the text', async () => {
    const run = await start();
    const reply = await send(run, [{ name: 'message', value: 'Just ten characters or more.' }]);
    expect(reply.json).toEqual(OK);
    expect(stored(run.dir)[0]).toMatchObject({ message: 'Just ten characters or more.', contact: '', lang: '', files: [] });
  });

  it('keeps three pictures and a log under names of its own, with the type their content has', async () => {
    const run = await start();
    const reply = await send(run, [...fields(run.clock), shot(PNG, 'one.png', 'image/png'), shot(JPEG, 'two.jpeg', 'image/jpeg'), shot(WEBP, 'three.webp', 'image/webp'), logFile()]);
    expect(reply.json).toEqual(OK);
    const [record] = stored(run.dir);
    expect(record.files.map(({ stored: _stored, ...rest }) => rest)).toEqual([
      { kind: 'shot', type: 'image/png', bytes: PNG.length, name: 'one.png' },
      { kind: 'shot', type: 'image/jpeg', bytes: JPEG.length, name: 'two.jpeg' },
      { kind: 'shot', type: 'image/webp', bytes: WEBP.length, name: 'three.webp' },
      { kind: 'log', type: 'text/plain; charset=utf-8', bytes: Buffer.byteLength(LOG_TEXT), name: 'sctrade.log' },
    ]);
    const names = record.files.map((file) => file.stored);
    for (const name of names) expect(name).toMatch(STORED_NAME);
    expect(names.map((name) => name.split('.')[1])).toEqual(['png', 'jpg', 'webp', 'txt']);
    expect(new Set(names).size).toBe(4);
    expect(listFiles(run.dir)).toEqual([...names.map((name) => `files/${record.id}/${name}`).sort(), `messages/${record.id}.json`]);
    const bytes = (index: number) => readFileSync(join(run.dir, 'files', record.id, names[index]));
    expect(bytes(0).equals(PNG)).toBe(true);
    expect(bytes(1).equals(JPEG)).toBe(true);
    expect(bytes(2).equals(WEBP)).toBe(true);
    expect(bytes(3).toString('utf8')).toBe(LOG_TEXT);
    expect(tmpOf(run.dir)).toEqual([]);
  });

  it('takes files of the very size the form allows', async () => {
    const run = await start();
    const bigShot = Buffer.concat([PNG, Buffer.alloc(LIMITS.shotBytes - PNG.length, 0x20)]);
    const bigLog = Buffer.alloc(LIMITS.logBytes, 0x61);
    const reply = await send(run, [...fields(run.clock), shot(bigShot), shot(bigShot), shot(bigShot), logFile(bigLog)]);
    expect(reply.json).toEqual(OK);
    expect(stored(run.dir)[0].files.map((file) => file.bytes)).toEqual([LIMITS.shotBytes, LIMITS.shotBytes, LIMITS.shotBytes, LIMITS.logBytes]);
  });

  it('listens on the server itself only', async () => {
    const run = await start();
    expect(run.service.address()).toEqual({ address: '127.0.0.1', port: run.port });
  });
});

describe('the text is counted the way the page counts it', () => {
  it('takes ten characters and refuses nine — line breaks sent as CR LF count once', async () => {
    const run = await start();
    // nine: five letters and four breaks, fourteen bytes on the wire
    expect((await send(run, fields(run.clock, { message: 'a\r\nb\r\nc\r\nd\r\ne' }))).json).toEqual(refused('too_short'));
    // ten
    expect((await send(run, fields(run.clock, { message: 'a\r\nb\r\nc\r\nd\r\nef' }))).json).toEqual(OK);
    expect(stored(run.dir)[0].message).toBe('a\nb\nc\nd\nef');
  });

  it('takes 4000 characters that are 5999 on the wire, and refuses 4001', async () => {
    const run = await start();
    const lines = `${Array.from({ length: 2000 }, () => 'x').join('\r\n')}y`; // 2001 letters, 1999 breaks
    expect(lines).toHaveLength(5999);
    expect((await send(run, fields(run.clock, { message: lines }))).json).toEqual(OK);
    expect((await send(run, fields(run.clock, { message: `${lines}z` }))).json).toEqual(refused('too_long'));
  });

  it('counts a character of two code units as one', async () => {
    const run = await start();
    const rocket = '\u{1F680}';
    expect((await send(run, fields(run.clock, { message: rocket.repeat(9) }))).json).toEqual(refused('too_short'));
    expect((await send(run, fields(run.clock, { message: rocket.repeat(10) }))).json).toEqual(OK);
    expect((await send(run, fields(run.clock, { message: rocket.repeat(4000) }))).json).toEqual(OK); // 16 000 bytes
    expect((await send(run, fields(run.clock, { message: rocket.repeat(4001) }))).json).toEqual(refused('too_long'));
    expect((await send(run, fields(run.clock, { contact: rocket.repeat(200) }))).json).toEqual(OK);
    expect((await send(run, fields(run.clock, { contact: rocket.repeat(201) }))).json).toEqual(refused('too_long'));
    expect(stored(run.dir)).toHaveLength(3);
  });
});

describe('every refusal has its code', () => {
  it('too_short: the text is missing, is spaces only, or is under ten characters', async () => {
    const run = await start();
    for (const message of [undefined, '', '   \r\n  ', 'too short', ' 123456789 ']) {
      const reply = await send(run, fields(run.clock, { message }));
      expect(reply.status, String(message)).toBe(400);
      expect(reply.json).toEqual(refused('too_short'));
    }
    expectNothingKept(run.dir);
  });

  it('too_long: the text or the contact is over its limit, or is bigger than any text of the form can be', async () => {
    const run = await start();
    for (const changed of [{ message: 'x'.repeat(4001) }, { contact: 'x'.repeat(201) }, { message: 'x'.repeat(200_000) }, { contact: 'x'.repeat(200_000) }]) {
      const reply = await send(run, fields(run.clock, changed));
      expect(reply.status).toBe(400);
      expect(reply.json).toEqual(refused('too_long'));
    }
    expectNothingKept(run.dir);
  });

  it('too_many_files: a fourth picture or a second log', async () => {
    const run = await start();
    const four = await send(run, [...fields(run.clock), shot(), shot(), shot(), shot()]);
    expect(four.status).toBe(400);
    expect(four.json).toEqual(refused('too_many_files'));
    const two = await send(run, [...fields(run.clock), logFile(), logFile()]);
    expect(two.json).toEqual(refused('too_many_files'));
    const many = await send(run, [...fields(run.clock), ...Array.from({ length: 12 }, () => shot())]);
    expect(many.json).toEqual(refused('too_many_files'));
    await until(() => tmpOf(run.dir).length === 0);
    expectNothingKept(run.dir);
  });

  it('file_too_big: a picture one byte over 5 MB, a log one byte over 2 MB', async () => {
    const run = await start();
    const bigShot = Buffer.concat([PNG, Buffer.alloc(LIMITS.shotBytes - PNG.length + 1, 0x20)]);
    const one = await send(run, [...fields(run.clock), shot(bigShot)]);
    expect(one.status).toBe(413);
    expect(one.json).toEqual(refused('file_too_big'));
    const two = await send(run, [...fields(run.clock), logFile(Buffer.alloc(LIMITS.logBytes + 1, 0x61))]);
    expect(two.status).toBe(413);
    expect(two.json).toEqual(refused('file_too_big'));
    await until(() => tmpOf(run.dir).length === 0);
    expectNothingKept(run.dir);
  });

  it('file_too_big: a body that says it is bigger than a full message is refused before a byte of it is read', async () => {
    const run = await start({ limits: { bodyBytes: 1024 * 1024 } });
    const filler = Buffer.concat([PNG, Buffer.alloc(1024 * 1024)]);
    const reply = await send(run, [...fields(run.clock), shot(filler)]);
    expect(reply.status).toBe(413);
    expect(reply.json).toEqual(refused('file_too_big'));
    expectNothingKept(run.dir);
  });

  it('bad_file_type: PHP, HTML and SVG that call themselves PNG', async () => {
    const run = await start();
    const fakes = [
      '<?php system($_GET["c"]); ?>' + ' '.repeat(100),
      '<!doctype html><html><body><script>alert(document.domain)</script></body></html>',
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script></svg>',
      '<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg"/>',
      'GIF89a' + '\u0000'.repeat(40),
      'x',
      '',
    ];
    for (const content of fakes) {
      const reply = await send(run, [...fields(run.clock), shot(content, 'shot.png', 'image/png')]);
      expect(reply.status, content.slice(0, 20)).toBe(415);
      expect(reply.json).toEqual(refused('bad_file_type'));
    }
    // and the same when a real picture goes first: one bad file refuses the whole message
    expect((await send(run, [...fields(run.clock), shot(), shot(fakes[1])])).json).toEqual(refused('bad_file_type'));
    await until(() => tmpOf(run.dir).length === 0);
    expectNothingKept(run.dir);
  });

  it('bad_file_type: a log that is not text — a zero byte, bytes that are not UTF-8, a picture, nothing at all', async () => {
    const run = await start();
    const notText = [Buffer.from('line one\n\u0000line two\n'), Buffer.from([0x5b, 0xff, 0xfe, 0x5d]), Buffer.from('﻿[INFO] started', 'utf16le'), PNG, Buffer.alloc(0), Buffer.concat([Buffer.from('ok '.repeat(50_000)), Buffer.from([0xc3])])];
    for (const content of notText) {
      const reply = await send(run, [...fields(run.clock), logFile(content, 'sctrade.log', 'text/plain')]);
      expect(reply.status).toBe(415);
      expect(reply.json).toEqual(refused('bad_file_type'));
    }
    await until(() => tmpOf(run.dir).length === 0);
    expectNothingKept(run.dir);
  });

  it('spam: the hidden field a person leaves empty is filled in', async () => {
    const run = await start();
    for (const website of ['http://spam.example.test/', ' ', 'x']) {
      const reply = await send(run, fields(run.clock, { website }));
      expect(reply.status).toBe(403);
      expect(reply.json).toEqual(refused('spam'));
    }
    expectNothingKept(run.dir);
  });

  it('spam: the form was sent less than three seconds after it was shown', async () => {
    const run = await start();
    for (const ago of [0, 1, 2999]) expect((await send(run, fields(run.clock, { started: String(run.clock.now - ago) }))).json, String(ago)).toEqual(refused('spam'));
    expect((await send(run, fields(run.clock, { started: String(run.clock.now - 3000) }))).json).toEqual(OK);
    expect(stored(run.dir)).toHaveLength(1);
  });

  it('server: there is no room left under the ceiling of the storage — and the log says so without a word of the message', async () => {
    const run = await start({ limits: { storageBytes: 700 } });
    expect((await send(run, fields(run.clock, { message: 'The first message fits.' }))).json).toEqual(OK);
    const picture = Buffer.concat([PNG, Buffer.alloc(600, 0x20)]);
    const reply = await send(run, [...fields(run.clock, { message: 'SECRET-TEXT of the second message', contact: 'SECRET-CONTACT' }), shot(picture, 'SECRET-NAME.png')]);
    expect(reply.status).toBe(503);
    expect(reply.json).toEqual(refused('server'));
    expect(stored(run.dir)).toHaveLength(1);
    await until(() => tmpOf(run.dir).length === 0);
    expect(listFiles(run.dir)).toHaveLength(1);
    expect(run.lines.filter((text) => / feedback server status=503 .* why=storage_full$/.test(text))).toHaveLength(1);
    expect(run.lines.join('\n')).not.toMatch(/SECRET/);
    // a message that fits is still taken
    expect((await send(run, fields(run.clock, { message: 'A third, small one.' }))).json).toEqual(OK);
  });

  it('server: a message that cannot fit whatever it holds is refused before a byte of it is read', async () => {
    const run = await start({ limits: { storageBytes: 1000 } });
    const picture = Buffer.concat([PNG, Buffer.alloc(200_000, 0x20)]);
    const reply = await send(run, [...fields(run.clock), shot(picture)]);
    expect(reply.status).toBe(503);
    expect(reply.json).toEqual(refused('server'));
    expect(run.lines.filter((text) => / feedback server status=503 bytes=0 .* why=storage_full$/.test(text))).toHaveLength(1);
    expectNothingKept(run.dir);
  });
});

describe('what is not the form of the page is refused', () => {
  it('any method but POST, with the JSON of the contract', async () => {
    const run = await start();
    for (const method of ['GET', 'HEAD', 'PUT', 'DELETE', 'OPTIONS', 'PATCH']) {
      const reply = await request(run.port, { method, path: '/api/feedback', headers: { Origin: ORIGIN } });
      expect(reply.status, method).toBe(405);
      expect(reply.headers.allow).toBe('POST');
      expect(reply.headers['set-cookie']).toBeUndefined();
      // no answer lets another site read it or send to it
      expect(reply.headers['access-control-allow-origin']).toBeUndefined();
      if (method !== 'HEAD') expect(reply.json).toEqual(refused('server'));
    }
  });

  it('any body that is not multipart/form-data', async () => {
    const run = await start();
    const bodies: Array<[string | undefined, string]> = [
      ['application/x-www-form-urlencoded', 'message=A+message+that+is+long+enough.'],
      ['application/json', '{"message":"A message that is long enough."}'],
      ['text/plain', 'message=A message that is long enough.'],
      ['multipart/form-data', 'no boundary is named'],
      ['multipart/mixed; boundary=x', '--x--'],
      [undefined, 'message=x'],
    ];
    for (const [type, body] of bodies) {
      const reply = await request(run.port, { method: 'POST', path: '/api/feedback', headers: { Origin: ORIGIN, 'X-Forwarded-For': SENDER, ...(type === undefined ? {} : { 'Content-Type': type }) }, body });
      expect(reply.status, String(type)).toBe(415);
      expect(reply.json).toEqual(refused('server'));
      expect(reply.headers['set-cookie']).toBeUndefined();
    }
    expectNothingKept(run.dir);
  });

  it('a form with a field the page does not have, the same field twice, or a file where a text belongs', async () => {
    const run = await start();
    const odd: Part[][] = [
      [...fields(run.clock), { name: 'admin', value: '1' }],
      [...fields(run.clock), { name: 'message', value: 'A second text of the same message.' }],
      [...fields(run.clock, { message: undefined }), { name: 'message', value: 'A message sent as a file, long enough.', filename: 'message.txt' }],
      [...fields(run.clock), { name: 'attachment', value: PNG, filename: 'x.png', type: 'image/png' }],
      [...fields(run.clock), { name: 'shots', value: PNG, filename: 'x.png', type: 'image/png' }],
      [...fields(run.clock), { name: 'shots[]', value: 'a text where a picture belongs' }],
    ];
    for (const parts of odd) {
      const reply = await send(run, parts);
      expect(reply.status).toBe(400);
      expect(reply.json).toEqual(refused('server'));
    }
    await until(() => tmpOf(run.dir).length === 0);
    expectNothingKept(run.dir);
  });

  it('a body that is cut off or is not what its head says', async () => {
    const run = await start();
    const { body, type } = multipart([...fields(run.clock), shot()]);
    for (const broken of [body.subarray(0, body.length - 20), body.subarray(0, 60), Buffer.from('garbage'), Buffer.alloc(0)]) {
      const reply = await request(run.port, { method: 'POST', path: '/api/feedback', headers: { 'Content-Type': type, Origin: ORIGIN, 'X-Forwarded-For': SENDER }, body: broken });
      expect(reply.status).toBe(400);
      expect(reply.json).toEqual(refused('server'));
    }
    await until(() => tmpOf(run.dir).length === 0);
    expectNothingKept(run.dir);
  });

  it('a request of another site: the Origin header, when there is one, must be the site itself', async () => {
    const run = await start();
    for (const origin of ['https://evil.example.test', `http://site.example.test`, `https://site.example.test.evil.example.test`, `https://www.site.example.test`, `https://site.example.test:8443`, 'null', '']) {
      const reply = await send(run, fields(run.clock), { Origin: origin });
      expect(reply.status, origin).toBe(403);
      expect(reply.json).toEqual(refused('spam'));
      expect(reply.headers['access-control-allow-origin']).toBeUndefined();
    }
    expectNothingKept(run.dir);
    // a sender that has no such header (not a browser) is judged by everything else
    expect((await send(run, fields(run.clock), { Origin: undefined })).json).toEqual(OK);
  });
});

describe('the name a sender gives a file never reaches the disk', () => {
  it('is kept as text only: slashes, dots, zero bytes and length change nothing about where a file is put', async () => {
    const outer = tempDir();
    const dir = join(outer, 'data');
    const run = await start({ dir });
    const names: Array<[Part, string]> = [
      [shot(PNG, '../../../etc/cron.d/evil.png'), 'evil.png'],
      [shot(PNG, '..\\\\..\\\\windows\\\\evil.png'), 'evil.png'],
      [{ name: 'shots[]', value: PNG, type: 'image/png', disposition: `Content-Disposition: form-data; name="shots[]"; filename*=UTF-8''a%00b%2F..%2Fc%0D%0A.png` }, 'c.png'],
      [shot(PNG, `${'A'.repeat(10_000)}.png`), 'A'.repeat(100)],
      [shot(PNG, '<img src=x onerror=alert(1)>.png'), '<img src=x onerror=alert(1)>.png'],
      [shot(PNG, '.htaccess'), '.htaccess'],
      [shot(PNG, 'evil.php'), 'evil.php'],
      [shot(PNG, '..'), ''],
      [logFile(LOG_TEXT, '../../../../root/.ssh/authorized_keys'), 'authorized_keys'],
    ];
    for (const [part, kept] of names) {
      run.clock.now += HOUR_MS; // each one a message of its own, under the limit of sending
      const reply = await send(run, [...fields(run.clock), part]);
      expect(reply.json, kept.slice(0, 30)).toEqual(OK);
      const record = stored(dir).at(-1)!;
      expect(record.files[0].name).toBe(kept);
      expect(record.files[0].stored).toMatch(STORED_NAME);
    }
    // everything that was written lies in the folder of the data, under names the service made
    const everything = listFiles(outer);
    expect(everything).toHaveLength(2 * names.length);
    for (const file of everything) expect(file).toMatch(/^data\/(messages\/[0-9a-f]{32}\.json|files\/[0-9a-f]{32}\/[0-9a-f]{32}\.(png|txt))$/);
    expect(everything.join('\n')).not.toMatch(/evil|htaccess|php|authorized|cron|AAAA/);
  });

  it('a name with a raw zero byte or one longer than a part head may be refuses the request; nothing is written', async () => {
    const run = await start();
    const zero = await send(run, [...fields(run.clock), { name: 'shots[]', value: PNG, type: 'image/png', disposition: Buffer.from('Content-Disposition: form-data; name="shots[]"; filename="a\u0000b.png"', 'latin1') }]);
    expect(zero.status).toBe(400);
    expect(zero.json).toEqual(refused('server'));
    const long = await send(run, [...fields(run.clock), shot(PNG, `${'A'.repeat(40_000)}.png`)]);
    expect(long.status).toBe(400);
    expect(long.json).toEqual(refused('server'));
    await until(() => tmpOf(run.dir).length === 0);
    expectNothingKept(run.dir);
  });
});

describe('what a file is is decided by its content', () => {
  it('a picture under the name and the type of a text is kept as the picture it is', async () => {
    const run = await start();
    expect((await send(run, [...fields(run.clock), shot(JPEG, 'notes.txt', 'text/plain')])).json).toEqual(OK);
    const [file] = stored(run.dir)[0].files;
    expect(file).toMatchObject({ kind: 'shot', type: 'image/jpeg', name: 'notes.txt' });
    expect(file.stored).toMatch(/\.jpg$/);
  });

  it('a PNG with a script written after its end is kept whole, under a name of the service, as a PNG', async () => {
    const run = await start();
    const polyglot = Buffer.concat([PNG, Buffer.from('<script>alert(document.cookie)</script><?php echo 1; ?>')]);
    expect((await send(run, [...fields(run.clock), shot(polyglot, 'x.html', 'text/html')])).json).toEqual(OK);
    const [record] = stored(run.dir);
    expect(record.files[0]).toMatchObject({ kind: 'shot', type: 'image/png', bytes: polyglot.length, name: 'x.html' });
    expect(record.files[0].stored).toMatch(/^[0-9a-f]{32}\.png$/);
    expect(readFileSync(join(run.dir, 'files', record.id, record.files[0].stored)).equals(polyglot)).toBe(true);
  });

  it('a log is kept as .txt whatever it was called', async () => {
    const run = await start();
    expect((await send(run, [...fields(run.clock), logFile('<script>alert(1)</script>\n', 'page.html', 'text/html')])).json).toEqual(OK);
    const [file] = stored(run.dir)[0].files;
    expect(file).toMatchObject({ kind: 'log', type: 'text/plain; charset=utf-8', name: 'page.html' });
    expect(file.stored).toMatch(/\.txt$/);
  });
});

describe('the sizes are cut while the body is read', () => {
  const head = (extra: string) => `POST /api/feedback HTTP/1.1\r\nHost: 127.0.0.1\r\nOrigin: ${ORIGIN}\r\nX-Forwarded-For: ${SENDER}\r\nContent-Type: multipart/form-data; boundary=cut\r\n${extra}\r\n`;
  const chunk = (bytes: Buffer) => Buffer.concat([Buffer.from(`${bytes.length.toString(16)}\r\n`), bytes, Buffer.from('\r\n')]);
  const pictureStart = Buffer.concat([Buffer.from('--cut\r\nContent-Disposition: form-data; name="message"\r\n\r\nA message that is long enough.\r\n--cut\r\nContent-Disposition: form-data; name="shots[]"; filename="big.png"\r\nContent-Type: image/png\r\n\r\n'), PNG]);

  it('a body with no end is answered file_too_big at the limit and the line is cut; nothing of it stays', async () => {
    const run = await start({ limits: { bodyBytes: 256 * 1024, lingerMs: 100 } });
    const piece = chunk(Buffer.alloc(64 * 1024, 0x20));
    // would send 64 MB if nobody stopped it
    const result = await rawSend(run.port, head('Transfer-Encoding: chunked\r\n'), { first: chunk(pictureStart), piece, pieces: 1000, then: 'wait' }).done;
    expect(result.response).toMatch(/^HTTP\/1\.1 413 /);
    expect(result.response).toContain('{"ok":false,"error":"file_too_big"}');
    expect(result.response).not.toMatch(/set-cookie/i);
    expect(result.cutByService).toBe(true);
    expect(result.sent).toBeLessThan(40 * 1024 * 1024);
    await until(() => tmpOf(run.dir).length === 0);
    expectNothingKept(run.dir);
    expect(run.lines.some((line) => / feedback file_too_big status=413 /.test(line))).toBe(true);
  });

  it('a picture with no end is cut at 5 MB, long before the limit of the whole body', async () => {
    const run = await start({ limits: { lingerMs: 100 } });
    const piece = chunk(Buffer.alloc(64 * 1024, 0x20));
    const result = await rawSend(run.port, head('Transfer-Encoding: chunked\r\n'), { first: chunk(pictureStart), piece, pieces: 1000, then: 'wait' }).done;
    expect(result.response).toMatch(/^HTTP\/1\.1 413 /);
    expect(result.response).toContain('{"ok":false,"error":"file_too_big"}');
    expect(result.cutByService).toBe(true);
    const line = run.lines.find((text) => text.includes(' feedback file_too_big ')) ?? '';
    const read = Number(/ bytes=(\d+)/.exec(line)?.[1]);
    // the reading stops a little past the limit — by what was on its way through the service when the limit was hit —
    // and far from the 18 MB a whole body may be, let alone the 64 MB the sender wanted to send
    expect(read).toBeGreaterThan(LIMITS.shotBytes);
    expect(read).toBeLessThan(LIMITS.shotBytes + 4 * 1024 * 1024);
    expect(result.sent).toBeLessThan(40 * 1024 * 1024);
    await until(() => tmpOf(run.dir).length === 0);
    expectNothingKept(run.dir);
  });

  it('a body announced as too big is refused at once, though not a byte of it was sent', async () => {
    const run = await start({ limits: { lingerMs: 100 } });
    const result = await rawSend(run.port, head('Content-Length: 99999999\r\n'), { then: 'wait' }).done;
    expect(result.response).toMatch(/^HTTP\/1\.1 413 /);
    expect(result.response).toContain('{"ok":false,"error":"file_too_big"}');
    expect(result.cutByService).toBe(true);
    expect(result.sent).toBe(0);
    expect(tmpOf(run.dir)).toEqual([]);
  });

  it('a sender that stops in the middle is not waited for longer than the time a request may take', async () => {
    const run = await start({ limits: { requestMs: 300, lingerMs: 100 } });
    const began = Date.now();
    const result = await rawSend(run.port, head('Content-Length: 5000000\r\n'), { first: pictureStart, then: 'wait' }).done;
    expect(Date.now() - began).toBeLessThan(3000);
    expect(result.response).toMatch(/^HTTP\/1\.1 408 /);
    expect(result.response).toContain('{"ok":false,"error":"server"}');
    expect(result.cutByService).toBe(true);
    await until(() => tmpOf(run.dir).length === 0);
    expectNothingKept(run.dir);
  });

  it('a sender that goes away in the middle leaves nothing behind', async () => {
    const run = await start();
    const going = rawSend(run.port, head('Content-Length: 5000000\r\n'), { first: pictureStart, then: 'wait' });
    await until(() => tmpOf(run.dir).length === 1);
    going.leave();
    await going.done;
    await until(() => tmpOf(run.dir).length === 0);
    expectNothingKept(run.dir);
    await until(() => run.lines.some((line) => line.includes(' feedback aborted ')));
  });

  it('only a few messages are read at the same time; one more is told to come back later', async () => {
    const run = await start({ limits: { uploadsAtOnce: 2 } });
    const slow = [1, 2].map(() => rawSend(run.port, head('Content-Length: 5000000\r\n'), { first: pictureStart, then: 'wait' }));
    await until(() => tmpOf(run.dir).length === 2);
    const reply = await send(run, fields(run.clock), { 'X-Forwarded-For': '198.51.100.20' });
    expect(reply.status).toBe(503);
    expect(reply.json).toEqual(refused('server'));
    for (const one of slow) one.leave();
    await Promise.all(slow.map((one) => one.done));
    await until(() => tmpOf(run.dir).length === 0);
    // and there is room again
    expect((await send(run, fields(run.clock), { 'X-Forwarded-For': '198.51.100.20' })).json).toEqual(OK);
  });
});

describe('how often one address may write', () => {
  it('five messages an hour: the sixth is refused, and an hour later the way is open again', async () => {
    const run = await start();
    for (let n = 1; n <= 5; n++) expect((await send(run, fields(run.clock))).json, `message ${n}`).toEqual(OK);
    const sixth = await send(run, fields(run.clock));
    expect(sixth.status).toBe(429);
    expect(sixth.json).toEqual(refused('rate_limited'));
    // another address is not held back by it
    expect((await send(run, fields(run.clock), { 'X-Forwarded-For': '198.51.100.20' })).json).toEqual(OK);
    run.clock.now += HOUR_MS - 1000;
    expect((await send(run, fields(run.clock))).json).toEqual(refused('rate_limited'));
    run.clock.now += 2000;
    expect((await send(run, fields(run.clock))).json).toEqual(OK);
    expect(stored(run.dir)).toHaveLength(7);
  });

  it('twenty messages a day: the twenty-first is refused until the first is a day old', async () => {
    const run = await start();
    for (let batch = 0; batch < 4; batch++) {
      for (let n = 0; n < 5; n++) expect((await send(run, fields(run.clock))).json).toEqual(OK);
      run.clock.now += HOUR_MS + 1000;
    }
    expect((await send(run, fields(run.clock))).json).toEqual(refused('rate_limited'));
    run.clock.now = START + DAY_MS - 1000;
    expect((await send(run, fields(run.clock))).json).toEqual(refused('rate_limited'));
    run.clock.now = START + DAY_MS + 1000;
    expect((await send(run, fields(run.clock))).json).toEqual(OK);
    expect(stored(run.dir)).toHaveLength(21);
  });

  it('a ceiling for everybody together: when it is reached, no address gets through', async () => {
    const run = await start({ limits: { globalHour: 3 } });
    for (let n = 1; n <= 3; n++) expect((await send(run, fields(run.clock), { 'X-Forwarded-For': `198.51.100.${n}` })).json).toEqual(OK);
    const reply = await send(run, fields(run.clock), { 'X-Forwarded-For': '198.51.100.99' });
    expect(reply.status).toBe(429);
    expect(reply.json).toEqual(refused('rate_limited'));
    run.clock.now += HOUR_MS + 1000;
    expect((await send(run, fields(run.clock), { 'X-Forwarded-For': '198.51.100.99' })).json).toEqual(OK);
  });

  it('the address is the one the web server in front wrote: what the sender put into the header does not help him', async () => {
    const run = await start();
    for (let n = 1; n <= 5; n++) expect((await send(run, fields(run.clock), { 'X-Forwarded-For': `10.0.0.${n}, ${SENDER}` })).json).toEqual(OK);
    expect((await send(run, fields(run.clock), { 'X-Forwarded-For': `10.9.9.9, 127.0.0.1, ${SENDER}` })).json).toEqual(refused('rate_limited'));
    expect((await send(run, fields(run.clock), { 'X-Forwarded-For': SENDER })).json).toEqual(refused('rate_limited'));
  });

  it('addresses of one IPv6 network are one sender, and requests with no address at all are one sender too', async () => {
    const run = await start();
    for (let n = 1; n <= 5; n++) expect((await send(run, fields(run.clock), { 'X-Forwarded-For': `2001:db8:1:2::${n}` })).json).toEqual(OK);
    expect((await send(run, fields(run.clock), { 'X-Forwarded-For': '2001:db8:1:2:aaaa:bbbb:cccc:dddd' })).json).toEqual(refused('rate_limited'));
    expect((await send(run, fields(run.clock), { 'X-Forwarded-For': '2001:db8:1:3::1' })).json).toEqual(OK);
    for (let n = 1; n <= 5; n++) expect((await send(run, fields(run.clock), { 'X-Forwarded-For': n % 2 === 0 ? undefined : 'not an address' })).json).toEqual(OK);
    expect((await send(run, fields(run.clock), { 'X-Forwarded-For': undefined })).json).toEqual(refused('rate_limited'));
  });

  it('refused messages are counted as well: an address cannot make the service read bodies without end', async () => {
    const run = await start({ limits: { attemptsPerAddressHour: 6 } });
    for (let n = 1; n <= 6; n++) expect((await send(run, [...fields(run.clock), shot('not a picture')])).json).toEqual(refused('bad_file_type'));
    const reply = await send(run, fields(run.clock));
    expect(reply.status).toBe(429);
    expect(reply.json).toEqual(refused('rate_limited'));
    run.clock.now += HOUR_MS + 1000;
    expect((await send(run, fields(run.clock))).json).toEqual(OK);
  });

  it('two messages sent at the same moment do not both slip under the limit', async () => {
    const run = await start({ limits: { perAddressHour: 1 } });
    const replies = await Promise.all([1, 2, 3].map(() => send(run, [...fields(run.clock), shot()])));
    expect(replies.map((reply) => (reply.json as { ok: boolean }).ok).filter(Boolean)).toHaveLength(1);
    expect(replies.filter((reply) => reply.status === 429)).toHaveLength(2);
    await until(() => tmpOf(run.dir).length === 0);
    expect(stored(run.dir)).toHaveLength(1);
  });
});

describe('«О данных»: the address of a sender', () => {
  it('is not kept with the message, is written to no file and to no line of the log — nor are the headers of the request', async () => {
    const run = await start();
    const headers = { 'X-Forwarded-For': `10.1.2.3, ${SENDER}`, 'User-Agent': 'TestBrowser/9.9 (marker-agent)', Referer: `${ORIGIN}/?marker-referer`, 'Accept-Language': 'xx-marker', 'X-Real-IP': '203.0.113.99', Forwarded: 'for=203.0.113.98' };
    expect((await send(run, [...fields(run.clock), shot(), logFile()], headers)).json).toEqual(OK);
    expect((await send(run, fields(run.clock, { message: 'short' }), headers)).json).toEqual(refused('too_short'));
    const disk = everythingIn(run.dir).toString('latin1');
    const log = run.lines.join('\n');
    for (const secret of [SENDER, '203.0.113', '10.1.2.3', 'marker-agent', 'marker-referer', 'xx-marker', 'TestBrowser']) {
      expect(disk, secret).not.toContain(secret);
      expect(log, secret).not.toContain(secret);
    }
    // the message holds what the sender typed and attached, and nothing about the sender
    expect(Object.keys(stored(run.dir)[0]).sort()).toEqual(['contact', 'files', 'id', 'lang', 'message', 'receivedAt']);
  });

  it('is remembered by the limiter for a day at the most, and only as an HMAC under a secret that lives in memory', async () => {
    const run = await start();
    expect((await send(run, fields(run.clock))).json).toEqual(OK);
    const { limiter } = run.service;
    expect(limiter.size()).toBeGreaterThan(0);
    expect(JSON.stringify(limiter.keys())).not.toContain(SENDER);
    expect(limiter.keys().some((key) => key.includes(limiter.addressKey(SENDER)))).toBe(true);

    run.clock.now = START + DAY_MS - 1000;
    limiter.prune();
    expect(limiter.size()).toBeGreaterThan(0);

    run.clock.now = START + DAY_MS + 1000;
    limiter.prune();
    expect(limiter.size()).toBe(0);
    // and the secret is written nowhere: a service started again on the same data makes another one
    const disk = everythingIn(run.dir).toString('latin1');
    expect(disk).not.toContain(limiter.addressKey(SENDER));
    const again = await start({ dir: run.dir });
    expect(again.service.limiter.addressKey(SENDER)).not.toBe(limiter.addressKey(SENDER));
  });
});

describe('the log of the service', () => {
  it('says the time, the result and the sizes — never the text, the contact, a file name or an address', async () => {
    const run = await start();
    run.lines.length = 0;
    expect((await send(run, [...fields(run.clock, { message: 'TEXT-MARKER of a message.', contact: 'CONTACT-MARKER' }), shot(PNG, 'NAME-MARKER.png'), logFile('LOG-MARKER\n')])).json).toEqual(OK);
    expect((await send(run, fields(run.clock, { message: 'TEXT-MARKER', website: 'TRAP-MARKER' }))).json).toEqual(refused('spam'));
    expect(run.lines).toHaveLength(2);
    expect(run.lines[0]).toMatch(/^2026-10-10T12:00:00\.000Z feedback ok status=200 bytes=\d+ files=2 kept=\d+$/);
    expect(run.lines[1]).toMatch(/^2026-10-10T12:00:00\.000Z feedback spam status=403 bytes=\d+ files=0 kept=0 why=trap$/);
    expect(run.lines.join('\n')).not.toMatch(/MARKER|203\.0\.113/);
  });
});

describe('the other addresses under /api', () => {
  it('/api and /api/ give the same answer, which is not 404: a sign that the service is up', async () => {
    const run = await start();
    const bare = await request(run.port, { path: '/api' });
    const slash = await request(run.port, { path: '/api/' });
    expect(bare.status).toBe(200);
    expect(bare.json).toEqual({ ok: true });
    expect({ status: slash.status, text: slash.text, type: slash.headers['content-type'] }).toEqual({ status: bare.status, text: bare.text, type: bare.headers['content-type'] });
    for (const reply of [bare, slash]) {
      expect(reply.headers['set-cookie']).toBeUndefined();
      expect(reply.headers['cache-control']).toBe('no-store');
    }
  });

  it('anything else under /api is 404 in the JSON of the contract', async () => {
    const run = await start();
    for (const path of ['/api/feedback/', '/api/feedback/x', '/api/other', '/api/../admin/', '/api/feedback%2f..', '/', '/index.html', '/apifeedback']) {
      const reply = await request(run.port, { path });
      expect(reply.status, path).toBe(404);
      expect(reply.json).toEqual(refused('server'));
      expect(reply.headers['set-cookie']).toBeUndefined();
    }
  });

  it('a query after the address changes nothing', async () => {
    const run = await start();
    const { body, type } = multipart(fields(run.clock));
    const reply = await request(run.port, { method: 'POST', path: '/api/feedback?x=1&website=spam', headers: { 'Content-Type': type, Origin: ORIGIN, 'X-Forwarded-For': SENDER }, body });
    expect(reply.json).toEqual(OK);
  });
});

describe('the service looks after its storage', () => {
  it('removes what is past its term when it starts, and again when the daily check runs', async () => {
    const first = await start();
    expect((await send(first, [...fields(first.clock), shot()])).json).toEqual(OK);
    await first.stop();
    expect(stored(first.dir)).toHaveLength(1);

    // started again 100 days later: the message is still there
    const second = await start({ dir: first.dir, now: START + 100 * DAY_MS });
    expect(stored(second.dir)).toHaveLength(1);
    expect((await send(second, fields(second.clock))).json).toEqual(OK);
    // the daily check, 79 days on: the first message has reached its term, the second has not
    second.clock.now = START + 179 * DAY_MS;
    await second.service.sweep();
    expect(stored(second.dir)).toHaveLength(1);
    expect(listFiles(second.dir)).toEqual([`messages/${stored(second.dir)[0].id}.json`]);
    expect(second.lines.some((line) => / sweep ok expired=1 strays=0 /.test(line))).toBe(true);
    await second.stop();

    // started again long after: nothing is left
    const third = await start({ dir: first.dir, now: START + 400 * DAY_MS });
    expect(listFiles(third.dir)).toEqual([]);
    expect(third.lines.some((line) => / sweep ok expired=1 strays=0 /.test(line))).toBe(true);
  });

  it('clears the work folder of a run that was killed, when it starts', async () => {
    const dir = tempDir();
    mkdirSync(join(dir, 'tmp', 'a'.repeat(32)), { recursive: true });
    writeFileSync(join(dir, 'tmp', 'a'.repeat(32), 'half.part'), 'x');
    const run = await start({ dir });
    expect(tmpOf(run.dir)).toEqual([]);
    expect(existsSync(join(dir, 'messages'))).toBe(true);
  });
});
