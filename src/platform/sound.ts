// The one sound of the application (spec 14.19, item 11): a short chime when a favourite route has a full hold waiting.
// It is made by the webview itself, two soft tones through the audio output of Windows: no file, no network, nothing is sent to
// the game and the window takes no focus for it. Where there is no audio (a test, a preview without a sound device) it is silent.

interface AudioWindow { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }

let context: AudioContext | null = null;

/** The two tones of the chime: frequency in Hz, when it starts and how long it lasts, in seconds. */
const TONES = [
  { hz: 880, at: 0, sec: 0.16 },
  { hz: 1318.5, at: 0.14, sec: 0.26 },
];

/** A chime that could not start for this long is not played at all: a sound that comes later says nothing about now. */
const LATE_MS = 2000;

/**
 * Plays the chime at `volume` (0 … 1). Never throws and never waits: a webview that will not play a sound (no device, a policy
 * that holds the audio back until the window is clicked) simply stays silent. While the audio is held back nothing is scheduled:
 * the clock of a suspended output stands still, and every chime asked for in that time would sound at once when it starts.
 */
export function playChime(volume: number): void {
  try {
    const Ctor = (globalThis as AudioWindow).AudioContext ?? (globalThis as AudioWindow).webkitAudioContext;
    if (Ctor === undefined) return;
    context ??= new Ctor();
    const ctx = context;
    const level = Math.min(1, Math.max(0, volume)) * 0.35;   // a full volume is still a soft sound beside the game
    if (!(level > 0)) return;
    if (ctx.state === 'running') {
      tones(ctx, level);
      return;
    }
    const asked = Date.now();
    void ctx.resume()
      .then(() => { if (ctx.state === 'running' && Date.now() - asked < LATE_MS) tones(ctx, level); })
      .catch(() => undefined);
  } catch {
    // a hint that makes no sound is still a hint on the screen
  }
}

function tones(ctx: AudioContext, level: number): void {
  try {
    for (const tone of TONES) {
      const start = ctx.currentTime + tone.at;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(level, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + tone.sec);
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(tone.hz, start);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + tone.sec + 0.02);
    }
  } catch {
    // a hint that makes no sound is still a hint on the screen
  }
}
