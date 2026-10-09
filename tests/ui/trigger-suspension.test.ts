import { describe, expect, it } from 'vitest';
import { bindNeeded, triggerSuspension, type Timers } from '../../src/ui/vm/trigger-suspension';

// A clock of the test: a timer is a job that waits until `tick` reaches its time.
function fakeTimers(): Timers & { tick(ms: number): void; waiting(): number } {
  let now = 0;
  let next = 1;
  const jobs = new Map<number, { at: number; run: () => void }>();
  return {
    set: (run, ms) => {
      jobs.set(next, { at: now + ms, run });
      return next++;
    },
    clear: (handle) => void jobs.delete(handle as number),
    tick(ms) {
      now += ms;
      for (const [id, job] of [...jobs]) {
        if (job.at <= now) {
          jobs.delete(id);
          job.run();
        }
      }
    },
    waiting: () => jobs.size,
  };
}

function setup(delayMs = 50) {
  const calls: string[] = [];
  const timers = fakeTimers();
  const suspension = triggerSuspension({ suspend: () => calls.push('suspend'), resume: () => calls.push('resume') }, delayMs, timers);
  return { calls, timers, suspension };
}

describe('triggerSuspension: the assigned keys do not fire while a key field has the focus', () => {
  it('suspends the keys when a key field gets the focus, once however many times it is told', () => {
    const { calls, suspension } = setup();
    suspension.focus();
    suspension.focus();
    expect(calls).toEqual(['suspend']);
    expect(suspension.suspended).toBe(true);
  });

  it('resumes the keys a moment after the focus left, not at once', () => {
    const { calls, timers, suspension } = setup(50);
    suspension.focus();
    suspension.blur();
    expect(calls).toEqual(['suspend']);
    timers.tick(49);
    expect(calls).toEqual(['suspend']);
    timers.tick(1);
    expect(calls).toEqual(['suspend', 'resume']);
    expect(suspension.suspended).toBe(false);
  });

  it('does not resume and suspend again when the focus goes from one key field to another: the blur and the next focus come together', () => {
    const { calls, timers, suspension } = setup();
    suspension.focus();
    suspension.blur(); // the first field lets go
    suspension.focus(); // the second takes it, in the same moment
    timers.tick(1000);
    expect(calls).toEqual(['suspend']);
    expect(suspension.suspended).toBe(true);
    expect(timers.waiting()).toBe(0);
  });

  it('suspends again after the keys were resumed, when a key field gets the focus later', () => {
    const { calls, timers, suspension } = setup();
    suspension.focus();
    suspension.blur();
    timers.tick(100);
    suspension.focus();
    expect(calls).toEqual(['suspend', 'resume', 'suspend']);
  });

  it('says nothing for a blur when nothing is suspended, and keeps one waiting resume for any number of blurs', () => {
    const { calls, timers, suspension } = setup();
    suspension.blur();
    timers.tick(100);
    expect(calls).toEqual([]);
    suspension.focus();
    suspension.blur();
    suspension.blur();
    expect(timers.waiting()).toBe(1);
    timers.tick(100);
    expect(calls).toEqual(['suspend', 'resume']);
  });

  describe('release: the field goes away without a blur (the screen of the settings is gone, the window is folded)', () => {
    it('resumes the keys at once', () => {
      const { calls, suspension } = setup();
      suspension.focus();
      suspension.release();
      expect(calls).toEqual(['suspend', 'resume']);
      expect(suspension.suspended).toBe(false);
    });

    it('resumes at once while the resume of a blur is still waiting, and the waiting one does not resume a second time', () => {
      const { calls, timers, suspension } = setup();
      suspension.focus();
      suspension.blur();
      suspension.release();
      timers.tick(1000);
      expect(calls).toEqual(['suspend', 'resume']);
      expect(timers.waiting()).toBe(0);
    });

    it('does nothing when nothing is suspended, and not twice', () => {
      const { calls, suspension } = setup();
      suspension.release();
      suspension.focus();
      suspension.release();
      suspension.release();
      expect(calls).toEqual(['suspend', 'resume']);
    });

    it('leaves no suspension behind: after a release the next focus suspends again', () => {
      const { calls, suspension } = setup();
      suspension.focus();
      suspension.release();
      suspension.focus();
      expect(calls).toEqual(['suspend', 'resume', 'suspend']);
    });
  });
});

describe('bindNeeded (task 44): a call that would only say "no keys" again is left out', () => {
  const none = { panel: '', depart: '', arrive: '' };

  it('is not needed when no key is saved and nothing was bound: a visit to a key field costs no call', () => {
    expect(bindNeeded(none, false)).toBe(false);
    expect(bindNeeded({ panel: '  ', depart: '', arrive: '\t' }, false)).toBe(false);
  });

  it('is needed while something is bound, even with no key saved any more: the key that was taken off must be unbound', () => {
    expect(bindNeeded(none, true)).toBe(true);
  });

  it('is needed when a key is saved, whether anything was bound or not', () => {
    expect(bindNeeded({ ...none, panel: 'F8' }, false)).toBe(true);
    expect(bindNeeded({ ...none, arrive: 'Ctrl+Alt+T' }, true)).toBe(true);
    expect(bindNeeded({ panel: 'F8', depart: 'F9', arrive: 'F10' }, false)).toBe(true);
  });
});
