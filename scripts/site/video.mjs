// `npm run site:video`: turns a clip recorded in the game into the background video of the first screen, with
// ffmpeg (it must be installed; nothing is downloaded).
//
//   npm run site:video -- <clip> [--blur N] [--start S] [--duration D]
//
// It writes three files into site/assets/video/: hero.webm (VP9), hero.mp4 (H.264) and hero.jpg (the first frame, shown
// before the video plays and instead of it on a narrow screen). 1920 x 1080, no sound, 12 to 20 seconds, each video
// 6 MB at most. The picture is blurred HERE (--blur, default 8; 0 switches it off): a blurred video is several times
// smaller than a sharp one, and a blur filter in the browser would cost every visitor's processor instead.
// The files are encoded in a temporary folder and put into site/assets/video/ together, only when all three are made:
// a run that fails leaves the folder as it was. The next `npm run site:build` finds the files and puts the video on
// the page. What to record: site/VIDEO.md.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { siteDir } from './config.mjs';

export const TARGET = Object.freeze({ width: 1920, height: 1080, fps: 30, minSeconds: 12, maxSeconds: 20, maxBytes: 6 * 1024 * 1024, blur: 8 });

/** How many times the encoding is tried again with a lower bitrate when a file comes out over the limit. */
const ATTEMPTS = 4;

/** The frame filled and cut to 1920 x 1080; the same for the video and for the still frame. */
const frameFilter = (/** @type {number} */ blur) => {
  const fit = `scale=${TARGET.width}:${TARGET.height}:force_original_aspect_ratio=increase,crop=${TARGET.width}:${TARGET.height}`;
  return blur > 0 ? `${fit},gblur=sigma=${blur}` : fit;
};

/** @param {{ blur: number }} options */
export function videoFilter({ blur }) {
  return `${frameFilter(blur)},fps=${TARGET.fps},format=yuv420p`;
}

/**
 * The bitrate, in kbit/s, at which a video of this length stays under the size limit (with 8 % to spare for the
 * container and for an encoder that overshoots).
 * @param {number} seconds
 * @param {number} maxBytes
 */
export function bitrateCap(seconds, maxBytes) {
  return Math.floor((maxBytes * 8 * 0.92) / seconds / 1000);
}

/**
 * Which part of the source becomes the video.
 * @param {number} sourceSeconds the length of the source
 * @param {{ start?: number, duration?: number, minSeconds?: number }} asked `minSeconds` is for the tests (a synthetic clip is short)
 * @returns {{ start: number, seconds: number }}
 */
export function clipWindow(sourceSeconds, asked) {
  const min = asked.minSeconds ?? TARGET.minSeconds;
  const max = TARGET.maxSeconds;
  const start = asked.start ?? 0;
  if (!(start >= 0)) throw new Error(`--start must be 0 or more seconds, not ${start}`);
  if (asked.duration !== undefined && !(asked.duration >= min && asked.duration <= max)) {
    throw new Error(`--duration must be from ${min} to ${max} seconds, not ${asked.duration}`);
  }
  const left = sourceSeconds - start;
  if (left < min) {
    const have = start === 0 ? `the clip is ${sourceSeconds.toFixed(1)} s long` : `only ${left.toFixed(1)} s of the clip are left after ${start} s`;
    throw new Error(`${have}: the background video needs ${min} to ${max} s`);
  }
  const seconds = Math.min(asked.duration ?? max, left);
  return { start, seconds: Number(seconds.toFixed(3)) };
}

/**
 * The arguments of ffmpeg for the three files.
 * @param {{ input: string, outDir: string, start: number, seconds: number, blur: number, kbps: number }} options
 * @returns {{ webm: string[], mp4: string[], poster: string[] }}
 */
export function ffmpegCommands({ input, outDir, start, seconds, blur, kbps }) {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(input)) throw new Error(`the source must be a file on this computer, not an address: ${input}`);
  const quiet = ['-y', '-hide_banner', '-loglevel', 'error'];
  const part = [...quiet, '-ss', String(start), '-t', String(seconds), '-i', input, '-an', '-vf', videoFilter({ blur })];
  return {
    webm: [...part, '-c:v', 'libvpx-vp9', '-crf', '34', '-b:v', `${kbps}k`, '-maxrate', `${kbps}k`, '-deadline', 'good', '-cpu-used', '2', '-row-mt', '1', '-pix_fmt', 'yuv420p', join(outDir, 'hero.webm')],
    mp4: [
      ...part,
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '26', '-maxrate', `${kbps}k`, '-bufsize', `${kbps * 2}k`,
      '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
      join(outDir, 'hero.mp4'),
    ],
    poster: [...quiet, '-ss', String(start), '-i', input, '-frames:v', '1', '-vf', frameFilter(blur), '-q:v', '4', '-update', '1', join(outDir, 'hero.jpg')],
  };
}

/** The arguments of ffprobe that print the length of a file in seconds. */
export function probeArguments(/** @type {string} */ input) {
  return ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', input];
}

/**
 * Runs a program of ffmpeg and gives what it printed; a failure is an error with what the program said.
 * @type {(program: string, args: string[]) => string}
 */
function runProgram(program, args) {
  const result = spawnSync(program, args, { encoding: 'utf8', windowsHide: true });
  if (result.error) throw new Error(`${program} could not be started (${result.error.message}): install ffmpeg and make sure it is on the PATH`);
  if (result.status !== 0) throw new Error(`${program} failed (exit code ${result.status}):\n${result.stderr.trim()}`);
  return result.stdout;
}

/** The three files of the video, in the order they are made. */
const FILES = ['hero.webm', 'hero.mp4', 'hero.jpg'];

/**
 * Puts the new files (`<name>.part`, already in the folder) in the place of the old ones, all of them or none: the
 * old ones are moved aside first, and put back when anything fails — a file held open by a player cannot be moved,
 * and the site must not be left with a new video next to an old still frame.
 * @param {string} dir
 */
function putInPlace(dir) {
  /** @type {string[]} */
  const aside = [];
  /** @type {string[]} */
  const placed = [];
  try {
    for (const name of FILES) {
      if (!existsSync(join(dir, name))) continue;
      renameSync(join(dir, name), join(dir, `${name}.old`));
      aside.push(name);
    }
    for (const name of FILES) {
      renameSync(join(dir, `${name}.part`), join(dir, name));
      placed.push(name);
    }
  } catch (err) {
    for (const name of placed) rmSync(join(dir, name), { force: true });
    for (const name of aside) renameSync(join(dir, `${name}.old`), join(dir, name));
    throw err;
  }
  for (const name of aside) rmSync(join(dir, `${name}.old`), { force: true });
}

/**
 * Makes hero.webm, hero.mp4 and hero.jpg in `outDir` from a clip. The files are encoded in a temporary folder and
 * reach `outDir` only when all three are made: a run that fails leaves the folder exactly as it was, so the build
 * never meets a new video with an old still frame, or a part of a video.
 * @param {{
 *   input: string, outDir: string, blur?: number, start?: number, duration?: number, minSeconds?: number,
 *   run?: (program: string, args: string[]) => string,
 * }} options `run` starts ffprobe and ffmpeg (the tests put a stand-in there)
 * @returns {{ start: number, seconds: number, blur: number, files: Array<{ file: string, bytes: number }> }}
 */
export function makeHeroVideo(options) {
  const run = options.run ?? runProgram;
  const input = resolve(options.input);
  if (!existsSync(input) || !statSync(input).isFile()) throw new Error(`the clip ${input} does not exist`);
  const blur = options.blur ?? TARGET.blur;
  if (!(blur >= 0 && blur <= 60)) throw new Error(`--blur must be from 0 to 60, not ${blur}`);

  const sourceSeconds = Number(run('ffprobe', probeArguments(input)).trim());
  if (!(sourceSeconds > 0)) throw new Error(`ffprobe could not tell how long ${input} is: is it a video?`);
  const window = clipWindow(sourceSeconds, { start: options.start, duration: options.duration, minSeconds: options.minSeconds });

  const work = mkdtempSync(join(tmpdir(), 'sc-trade-video-'));
  /** @type {string[]} */
  const parts = [];
  try {
    let kbps = bitrateCap(window.seconds, TARGET.maxBytes);
    for (const kind of /** @type {const} */ (['webm', 'mp4'])) {
      for (let attempt = 1; ; attempt++) {
        run('ffmpeg', ffmpegCommands({ input, outDir: work, ...window, blur, kbps })[kind]);
        const bytes = statSync(join(work, `hero.${kind}`)).size;
        if (bytes <= TARGET.maxBytes) break;
        if (attempt === ATTEMPTS) {
          throw new Error(`hero.${kind} is ${(bytes / 1024 / 1024).toFixed(1)} MB after ${ATTEMPTS} attempts, over the limit of 6 MB: blur it more (--blur) or make it shorter (--duration)`);
        }
        kbps = Math.floor(kbps * 0.8);
      }
    }
    run('ffmpeg', ffmpegCommands({ input, outDir: work, ...window, blur, kbps }).poster);
    const files = FILES.map((file) => ({ file, bytes: statSync(join(work, file)).size }));

    // all three are made. They are copied next to their places first (the temporary folder may be on another disk),
    // then put in place together.
    mkdirSync(options.outDir, { recursive: true });
    for (const file of FILES) {
      parts.push(join(options.outDir, `${file}.part`));
      copyFileSync(join(work, file), join(options.outDir, `${file}.part`));
    }
    putInPlace(options.outDir);
    return { ...window, blur, files };
  } catch (err) {
    for (const part of parts) rmSync(part, { force: true });
    throw err;
  } finally {
    rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

const USAGE = `usage: npm run site:video -- <clip> [--blur N] [--start S] [--duration D]
  <clip>          the recording of the game (a file on this computer)
  --blur N        how much to blur, 0 to 60; default ${TARGET.blur}, 0: not at all
  --start S       where the part begins, in seconds; default 0
  --duration D    how long the part is, ${TARGET.minSeconds} to ${TARGET.maxSeconds} seconds; default: up to ${TARGET.maxSeconds}`;

function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { blur: { type: 'string' }, start: { type: 'string' }, duration: { type: 'string' }, help: { type: 'boolean' } },
  });
  if (values.help) return console.log(USAGE);
  if (positionals.length !== 1) throw new Error(`name one clip\n${USAGE}`);
  const number = (/** @type {string | undefined} */ text, /** @type {string} */ name) => {
    if (text === undefined) return undefined;
    if (text.trim() === '' || Number.isNaN(Number(text))) throw new Error(`${name} must be a number, not "${text}"`);
    return Number(text);
  };
  const outDir = join(siteDir, 'assets', 'video');
  const result = makeHeroVideo({ input: positionals[0], outDir, blur: number(values.blur, '--blur'), start: number(values.start, '--start'), duration: number(values.duration, '--duration') });
  console.log(`background video: ${result.seconds} s from ${result.start} s, blur ${result.blur}`);
  for (const { file, bytes } of result.files) console.log(`  ${relative(process.cwd(), join(outDir, file)).replaceAll('\\', '/')}: ${(bytes / 1024 / 1024).toFixed(2)} MB`);
  console.log('next: npm run site:build — the first screen will play it');
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
