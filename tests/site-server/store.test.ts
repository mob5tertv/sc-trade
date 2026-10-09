import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createStore, StorageFull, type MessageRecord } from '../../site/server/src/store.mjs';
import { DAY_MS, listFiles, listFolders, PNG, START, tempDir } from './helpers';

const STORED_PNG = `${'ab'.repeat(16)}.png`;
const STORED_TXT = `${'cd'.repeat(16)}.txt`;

function open(options: { dir?: string; storageBytes?: number; retentionDays?: number; now?: number } = {}) {
  const dir = options.dir ?? tempDir();
  const clock = { now: options.now ?? START };
  const store = createStore({ dir, now: () => clock.now, storageBytes: options.storageBytes ?? 1024 * 1024, retentionMs: (options.retentionDays ?? 180) * DAY_MS });
  return { dir, clock, store };
}

/** Keeps a message with a picture and a log, the way the service does it: the files first, in a work folder. */
async function keep(store: ReturnType<typeof createStore>, changed: Partial<MessageRecord> = {}, withFiles = true): Promise<MessageRecord> {
  const id = store.newId();
  const record: MessageRecord = {
    receivedAt: new Date(store.timeOf(id)).toISOString(),
    lang: 'ru',
    message: 'A message that is long enough.',
    contact: 'someone',
    files: withFiles
      ? [
          { kind: 'shot', stored: STORED_PNG, type: 'image/png', bytes: PNG.length, name: 'shot.png' },
          { kind: 'log', stored: STORED_TXT, type: 'text/plain; charset=utf-8', bytes: 5, name: 'sctrade.log' },
        ]
      : [],
    ...changed,
    id,
  };
  if (record.files.length > 0) {
    const work = await store.workDir(id);
    writeFileSync(join(work, STORED_PNG), PNG);
    writeFileSync(join(work, STORED_TXT), 'hello');
  }
  await store.save(record);
  return record;
}

describe('the storage of messages', () => {
  it('makes its folders when it is opened, and nothing else', async () => {
    const { dir, store } = open();
    await store.open();
    expect(listFolders(dir)).toEqual(['files', 'messages', 'tmp']);
    expect(listFiles(dir)).toEqual([]);
    expect(store.usedBytes()).toBe(0);
  });

  it('keeps a message as one JSON file and a folder with its files', async () => {
    const { dir, store } = open();
    await store.open();
    const record = await keep(store);
    expect(listFiles(dir)).toEqual([`files/${record.id}/${STORED_PNG}`, `files/${record.id}/${STORED_TXT}`, `messages/${record.id}.json`]);
    expect(JSON.parse(readFileSync(join(dir, 'messages', `${record.id}.json`), 'utf8'))).toEqual(record);
    expect(readFileSync(join(dir, 'files', record.id, STORED_PNG)).equals(PNG)).toBe(true);
    expect(await store.read(record.id)).toEqual(record);
    // nothing is left of the work
    expect(readdirSync(join(dir, 'tmp'))).toEqual([]);
  });

  it('keeps a message without files as its JSON alone', async () => {
    const { dir, store } = open();
    await store.open();
    const record = await keep(store, {}, false);
    expect(listFiles(dir)).toEqual([`messages/${record.id}.json`]);
    expect(listFolders(dir)).toEqual(['files', 'messages', 'tmp']);
  });

  it('gives every message an id of its own that starts with its time, so that names sort by age', async () => {
    const { clock, store } = open();
    await store.open();
    const first = store.newId();
    const same = store.newId();
    clock.now += 1;
    const later = store.newId();
    for (const id of [first, same, later]) expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(first).not.toBe(same);
    expect(first.slice(0, 12)).toBe(same.slice(0, 12));
    expect(later > first && later > same).toBe(true);
    expect(store.timeOf(first)).toBe(START);
    expect(store.timeOf(later)).toBe(START + 1);
  });

  it('lists the messages newest first and takes nothing else in its folder for a message', async () => {
    const { dir, clock, store } = open();
    await store.open();
    const old = await keep(store, {}, false);
    clock.now += 60_000;
    const middle = await keep(store, {}, false);
    clock.now += 60_000;
    const recent = await keep(store, {}, false);
    writeFileSync(join(dir, 'messages', 'notes.txt'), 'x');
    writeFileSync(join(dir, 'messages', 'abc.json'), '{}');
    writeFileSync(join(dir, 'messages', `${'F'.repeat(32)}.json`), '{}');
    expect(await store.ids()).toEqual([recent.id, middle.id, old.id]);
  });

  it('reads nothing for an id that is not an id: no name of a visitor ever becomes a path', async () => {
    const { dir, store } = open();
    await store.open();
    const record = await keep(store);
    writeFileSync(join(dir, 'secret.json'), JSON.stringify(record));
    for (const id of ['..', '../secret', '../../etc/passwd', '..%2fsecret', `${record.id}/../${record.id}`, record.id.toUpperCase(), record.id.slice(1), `${record.id}0`, `${record.id}.json`, '', '.', 'a\u0000b']) {
      expect(await store.read(id), id).toBeNull();
      expect(await store.remove(id), id).toBe(false);
      expect(store.filePath(id, STORED_PNG), id).toBeNull();
    }
    // and nothing for a name of a file that is not one the service gives
    for (const name of ['../x.png', `../${record.id}.json`, 'shot.png', `${'ab'.repeat(16)}.php`, `${'ab'.repeat(16)}.png/..`, '', `${'AB'.repeat(16)}.png`]) {
      expect(store.filePath(record.id, name), name).toBeNull();
    }
    expect(store.filePath(record.id, STORED_PNG)).toBe(join(dir, 'files', record.id, STORED_PNG));
    expect(existsSync(join(dir, 'secret.json'))).toBe(true);
  });

  it('reads nothing for a file that is damaged or is not what the service writes', async () => {
    const { dir, store } = open();
    await store.open();
    const record = await keep(store, {}, false);
    const file = join(dir, 'messages', `${record.id}.json`);
    const broken: unknown[] = [
      'not json',
      '[]',
      'null',
      { ...record, id: 'f'.repeat(32) }, // says it is another message
      { ...record, message: 5 },
      { ...record, files: [{ kind: 'shot', stored: '../../x.png', type: 'image/png', bytes: 1, name: 'x' }] },
      { ...record, files: [{ kind: 'shot', stored: STORED_PNG, type: 'text/html', bytes: 1, name: 'x' }] },
      { ...record, files: 'none' },
      { ...record, lang: 'de' },
    ];
    for (const content of broken) {
      writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
      expect(await store.read(record.id), JSON.stringify(content).slice(0, 60)).toBeNull();
    }
  });

  it('deletes a message with its files', async () => {
    const { dir, store } = open();
    await store.open();
    const gone = await keep(store);
    const stays = await keep(store);
    expect(await store.remove(gone.id)).toBe(true);
    expect(listFiles(dir)).toEqual([`files/${stays.id}/${STORED_PNG}`, `files/${stays.id}/${STORED_TXT}`, `messages/${stays.id}.json`]);
    expect(await store.read(gone.id)).toBeNull();
    expect(await store.remove(gone.id)).toBe(false);
    expect(await store.ids()).toEqual([stays.id]);
  });

  it('knows how much it holds, and counts again what it finds when it is opened', async () => {
    const { dir, store } = open();
    await store.open();
    const record = await keep(store);
    const onDisk = () => listFiles(dir).reduce((total, file) => total + readFileSync(join(dir, file)).length, 0);
    expect(store.usedBytes()).toBe(onDisk());
    expect(store.usedBytes()).toBeGreaterThan(PNG.length);
    const again = open({ dir }).store;
    await again.open();
    expect(again.usedBytes()).toBe(onDisk());
    await again.remove(record.id);
    expect(again.usedBytes()).toBe(0);
  });

  it('refuses a message that does not fit under the ceiling, and keeps nothing of it', async () => {
    const { dir, store } = open({ storageBytes: 600 });
    await store.open();
    const first = await keep(store, {}, false); // some 150 bytes of JSON
    const used = store.usedBytes();
    const id = store.newId();
    const work = await store.workDir(id);
    writeFileSync(join(work, STORED_PNG), Buffer.alloc(500));
    const record: MessageRecord = { id, receivedAt: new Date(START).toISOString(), lang: '', message: 'A message that is long enough.', contact: '', files: [{ kind: 'shot', stored: STORED_PNG, type: 'image/png', bytes: 500, name: '' }] };
    await expect(store.save(record)).rejects.toBeInstanceOf(StorageFull);
    await store.discard(id);
    expect(store.usedBytes()).toBe(used);
    expect(listFiles(dir)).toEqual([`messages/${first.id}.json`]);
    expect(readdirSync(join(dir, 'tmp'))).toEqual([]);
    // a small one still fits
    await keep(store, {}, false);
    expect((await store.ids()).length).toBe(2);
  });

  it('clears what a crash left in the work folder when it is opened', async () => {
    const { dir, store } = open();
    mkdirSync(join(dir, 'tmp', 'a'.repeat(32)), { recursive: true });
    writeFileSync(join(dir, 'tmp', 'a'.repeat(32), 'half.part'), 'x');
    writeFileSync(join(dir, 'tmp', `${'b'.repeat(32)}.json`), '{');
    await store.open();
    expect(readdirSync(join(dir, 'tmp'))).toEqual([]);
    expect(store.usedBytes()).toBe(0);
  });
});

describe('how long a message is kept', () => {
  it('is 180 days at the most: the daily check removes a message one day before, so that none outlives the term', async () => {
    const { dir, clock, store } = open();
    await store.open();
    const old = await keep(store);
    clock.now = START + 100 * DAY_MS;
    const young = await keep(store);

    clock.now = START + 179 * DAY_MS - 1;
    expect(await store.sweep()).toEqual({ expired: 0, strays: 0 });
    expect(await store.ids()).toEqual([young.id, old.id]);

    clock.now = START + 179 * DAY_MS;
    expect(await store.sweep()).toEqual({ expired: 1, strays: 0 });
    expect(await store.ids()).toEqual([young.id]);
    expect(listFiles(dir)).toEqual([`files/${young.id}/${STORED_PNG}`, `files/${young.id}/${STORED_TXT}`, `messages/${young.id}.json`]);
    expect(store.usedBytes()).toBe(listFiles(dir).reduce((total, file) => total + readFileSync(join(dir, file)).length, 0));

    clock.now = START + 279 * DAY_MS;
    expect(await store.sweep()).toEqual({ expired: 1, strays: 0 });
    expect(listFiles(dir)).toEqual([]);
  });

  it('is over at 180 days even if no check has run: such a message is not listed, not read and its files are not handed out', async () => {
    const { clock, store } = open();
    await store.open();
    const record = await keep(store);
    clock.now = START + 180 * DAY_MS - 1;
    expect(await store.ids()).toEqual([record.id]);
    expect(await store.read(record.id)).not.toBeNull();
    clock.now = START + 180 * DAY_MS;
    expect(await store.ids()).toEqual([]);
    expect(await store.read(record.id)).toBeNull();
    expect(store.filePath(record.id, STORED_PNG)).toBeNull();
  });

  it('can be made shorter in the settings', async () => {
    const { clock, store } = open({ retentionDays: 30 });
    await store.open();
    const record = await keep(store, {}, false);
    clock.now = START + 29 * DAY_MS;
    expect(await store.sweep()).toEqual({ expired: 1, strays: 0 });
    expect(await store.read(record.id)).toBeNull();
  });

  it('removes files that belong to no message, once they are older than an hour', async () => {
    const { dir, clock, store } = open();
    await store.open();
    const kept = await keep(store);
    // a folder of files whose message was never written, and a work folder nobody came back for
    const orphan = store.newId();
    mkdirSync(join(dir, 'files', orphan));
    writeFileSync(join(dir, 'files', orphan, STORED_PNG), PNG);
    const work = store.newId();
    await store.workDir(work);

    // younger than an hour: it may be a message that is being kept this very moment
    clock.now = START + 59 * 60_000;
    expect(await store.sweep()).toEqual({ expired: 0, strays: 0 });
    expect(existsSync(join(dir, 'files', orphan))).toBe(true);
    expect(existsSync(join(dir, 'tmp', work))).toBe(true);

    // a folder under a name the service never gives goes whatever its age
    mkdirSync(join(dir, 'files', 'strange'));
    clock.now = START + 61 * 60_000;
    expect(await store.sweep()).toEqual({ expired: 0, strays: 3 });
    expect(listFolders(dir)).toEqual(['files', `files/${kept.id}`, 'messages', 'tmp']);
    expect(await store.read(kept.id)).not.toBeNull();
  });
});
