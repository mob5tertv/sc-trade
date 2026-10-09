import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bitrateCap, clipWindow, ffmpegCommands, makeHeroVideo, probeArguments, TARGET, videoFilter } from '../../scripts/site/video.mjs';
import { build, tempDir } from './helpers';

const MB = 1024 * 1024;

describe('the background video is prepared for the site', () => {
  it('as 1920 x 1080, 12 to 20 seconds, each file 6 MB at most', () => {
    expect(TARGET).toMatchObject({ width: 1920, height: 1080, minSeconds: 12, maxSeconds: 20, maxBytes: 6 * MB });
  });

  it('filling the frame, cut to its shape, blurred here and not in the browser', () => {
    expect(videoFilter({ blur: 8 })).toBe('scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,gblur=sigma=8,fps=30,format=yuv420p');
    expect(videoFilter({ blur: 14.5 })).toContain('gblur=sigma=14.5');
    // no blur asked: the filter is left out, not run with zero
    expect(videoFilter({ blur: 0 })).toBe('scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,fps=30,format=yuv420p');
  });

  it('with a bitrate that keeps a file under 6 MB for its length', () => {
    for (const seconds of [12, 15, 20]) {
      const kbps = bitrateCap(seconds, 6 * MB);
      expect(Number.isInteger(kbps)).toBe(true);
      const bytes = (kbps * 1000 * seconds) / 8;
      expect(bytes).toBeLessThan(6 * MB);
      expect(bytes).toBeGreaterThan(6 * MB * 0.85);
    }
  });
});

describe('the part of the source that becomes the video', () => {
  it('is the whole clip when it is 12 to 20 seconds long', () => {
    expect(clipWindow(15.4, {})).toEqual({ start: 0, seconds: 15.4 });
  });

  it('is the first 20 seconds of a longer clip, or 20 seconds from the start that was asked', () => {
    expect(clipWindow(63, {})).toEqual({ start: 0, seconds: 20 });
    expect(clipWindow(63, { start: 30 })).toEqual({ start: 30, seconds: 20 });
    expect(clipWindow(63, { start: 50 })).toEqual({ start: 50, seconds: 13 });
  });

  it('is as long as was asked, within 12 to 20 seconds', () => {
    expect(clipWindow(63, { start: 5, duration: 14 })).toEqual({ start: 5, seconds: 14 });
    expect(() => clipWindow(63, { duration: 25 })).toThrow('--duration must be from 12 to 20 seconds, not 25');
    expect(() => clipWindow(63, { duration: 8 })).toThrow('--duration must be from 12 to 20 seconds, not 8');
  });

  it('is refused with a clear phrase when the clip is too short for it', () => {
    expect(() => clipWindow(9.5, {})).toThrow('the clip is 9.5 s long: the background video needs 12 to 20 s');
    expect(() => clipWindow(63, { start: 55 })).toThrow('only 8.0 s of the clip are left after 55 s: the background video needs 12 to 20 s');
    expect(() => clipWindow(63, { start: 20, duration: 50 })).toThrow(/--duration/);
    expect(() => clipWindow(63, { start: -1 })).toThrow('--start must be 0 or more seconds, not -1');
  });
});

describe('the ffmpeg commands', () => {
  const commands = ffmpegCommands({ input: 'D:/clips/flight.mkv', outDir: 'site/assets/video', start: 3, seconds: 16, blur: 8, kbps: 2400 });
  const valueOf = (args: string[], name: string) => args[args.indexOf(name) + 1];
  const filter = videoFilter({ blur: 8 });

  it('cut the same part of the source for both files and drop the sound', () => {
    for (const args of [commands.webm, commands.mp4]) {
      expect(args.slice(0, 9)).toEqual(['-y', '-hide_banner', '-loglevel', 'error', '-ss', '3', '-t', '16', '-i']);
      expect(args[9]).toBe('D:/clips/flight.mkv');
      expect(args).toContain('-an');
      expect(valueOf(args, '-vf')).toBe(filter);
      expect(valueOf(args, '-pix_fmt')).toBe('yuv420p');
    }
  });

  it('write hero.webm as VP9 under the bitrate cap', () => {
    expect(valueOf(commands.webm, '-c:v')).toBe('libvpx-vp9');
    expect(valueOf(commands.webm, '-b:v')).toBe('2400k');
    expect(valueOf(commands.webm, '-maxrate')).toBe('2400k');
    expect(commands.webm).toContain('-crf');
    expect(commands.webm.at(-1)!.replaceAll('\\', '/')).toBe('site/assets/video/hero.webm');
  });

  it('write hero.mp4 as H.264 that starts playing before it is loaded whole', () => {
    expect(valueOf(commands.mp4, '-c:v')).toBe('libx264');
    expect(valueOf(commands.mp4, '-maxrate')).toBe('2400k');
    expect(valueOf(commands.mp4, '-bufsize')).toBe('4800k');
    expect(valueOf(commands.mp4, '-movflags')).toBe('+faststart');
    expect(commands.mp4.at(-1)!.replaceAll('\\', '/')).toBe('site/assets/video/hero.mp4');
  });

  it('write hero.jpg: the first frame of the very same part, blurred the same way', () => {
    expect(commands.poster.slice(0, 8)).toEqual(['-y', '-hide_banner', '-loglevel', 'error', '-ss', '3', '-i', 'D:/clips/flight.mkv']);
    expect(valueOf(commands.poster, '-frames:v')).toBe('1');
    expect(valueOf(commands.poster, '-vf')).toBe('scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,gblur=sigma=8');
    expect(commands.poster.at(-1)!.replaceAll('\\', '/')).toBe('site/assets/video/hero.jpg');
  });

  it('never name an address: the source is a file on the disk', () => {
    for (const args of Object.values(commands)) expect(args.join(' ')).not.toMatch(/https?:|rtmp:|udp:/);
    expect(() => ffmpegCommands({ input: 'https://example.test/clip.mp4', outDir: 'x', start: 0, seconds: 12, blur: 8, kbps: 1000 })).toThrow(/a file on this computer/);
  });

  it('ask ffprobe for the length of the source only', () => {
    expect(probeArguments('clip.mp4')).toEqual(['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', 'clip.mp4']);
  });
});

// The real thing on a two-second picture ffmpeg makes itself (`testsrc`), in a temporary folder. It takes a few
// seconds and needs ffmpeg, so it runs only when asked: SITE_VIDEO_E2E=1 npx vitest run tests/site/video.test.ts
describe.runIf(process.env.SITE_VIDEO_E2E === '1')('ffmpeg itself, on a synthetic clip', () => {
  it('writes the three files, in size, without sound, and the site is built with the video', { timeout: 180_000 }, () => {
    const dir = tempDir();
    const source = join(dir, 'source.mp4');
    const made = spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=duration=2:size=1280x720:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-shortest', source]);
    expect(made.status, String(made.stderr)).toBe(0);

    const outDir = join(dir, 'video');
    const result = makeHeroVideo({ input: source, outDir, blur: 8, minSeconds: 1 });
    expect(result.seconds).toBeCloseTo(2, 0);
    for (const name of ['hero.webm', 'hero.mp4', 'hero.jpg']) {
      expect(existsSync(join(outDir, name)), name).toBe(true);
      expect(statSync(join(outDir, name)).size).toBeGreaterThan(1000);
      expect(statSync(join(outDir, name)).size).toBeLessThanOrEqual(6 * MB);
    }
    const streams = (file: string) =>
      String(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height', '-of', 'csv=p=0', join(outDir, file)]).stdout).trim().split(/\r?\n/);
    expect(streams('hero.webm')).toEqual(['vp9,video,1920,1080']);
    expect(streams('hero.mp4')).toEqual(['h264,video,1920,1080']);

    const site = build({ videoDir: outDir });
    expect(site.result.video).toBe(true);
    const hero = /<section[^>]*\sid="top"[\s\S]*?<\/section>/.exec(site.read('index.html'))?.[0] ?? '';
    expect(hero).toMatch(/<video[^>]*\sautoplay[^>]*\smuted[^>]*\sloop[^>]*\splaysinline[^>]*\sposter="assets\/video\/hero\.jpg\?v=/);
    expect(site.files).toEqual(expect.arrayContaining(['assets/video/hero.webm', 'assets/video/hero.mp4', 'assets/video/hero.jpg']));
  });
});
