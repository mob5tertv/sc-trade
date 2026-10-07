import { describe, expect, it } from 'vitest';
import { runTimeSec } from '../../src/ui/vm/run-rate';
import { ev } from '../helpers/factories';

const depart = ev({ id: 2, ts: 100, type: 'depart' });
const arrive = ev({ id: 3, ts: 400, type: 'arrive' });

describe('runTimeSec: the time a run is counted over', () => {
  it('is the flight when it is longer than what has passed, and what has passed when that is longer', () => {
    expect(runTimeSec([], 600, 1015, true)).toBe(1015);
    expect(runTimeSec([], 1200, 1015, true)).toBe(1200);
  });

  it('is not known while the flight to the target is not known: the time that has passed says nothing about it', () => {
    expect(runTimeSec([], 60, null, true)).toBeNull();
    expect(runTimeSec([depart], 600, null, true)).toBeNull();
  });

  it('is the time that has passed once the arrival is the last mark, whatever is known of the flight', () => {
    expect(runTimeSec([depart, arrive], 872, null, true)).toBe(872);
    expect(runTimeSec([depart, arrive], 872, 1015, true)).toBe(872);
  });

  it('is not known again after a take-off that follows the arrival', () => {
    expect(runTimeSec([depart, arrive, ev({ id: 4, ts: 500, type: 'depart' })], 872, null, true)).toBeNull();
  });

  it('is the time that has passed when nothing is aboard to fly', () => {
    expect(runTimeSec([], 872, null, false)).toBe(872);
  });

  it('does not take a purchase or a sale for a mark', () => {
    expect(runTimeSec([ev({ id: 2, ts: 100, type: 'sell' })], 872, null, true)).toBeNull();
  });
});
