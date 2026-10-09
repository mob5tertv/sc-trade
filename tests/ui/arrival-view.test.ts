import { describe, expect, it } from 'vitest';
import { arrivalView, landingView } from '../../src/ui/vm/arrival-view';

const ARC_L1 = 1;
const HUR_L1 = 3;
const MIC_L1 = 4;

describe('arrivalView', () => {
  it('an arrival with a target and cargo aboard: the target is the location and is shown, on the sell side', () => {
    expect(arrivalView('arrive', ARC_L1, true, HUR_L1)).toEqual({ locateAt: ARC_L1, show: ARC_L1, preferSide: 'sell' });
  });

  it('an arrival with a target and an empty hold: the target is the location and is shown, the side is chosen as usual', () => {
    expect(arrivalView('arrive', ARC_L1, false, HUR_L1)).toEqual({ locateAt: ARC_L1, show: ARC_L1, preferSide: null });
  });

  it('an arrival from no location at all: the target is the location', () => {
    expect(arrivalView('arrive', ARC_L1, true, null)).toEqual({ locateAt: ARC_L1, show: ARC_L1, preferSide: 'sell' });
  });

  it('an arrival without a target changes nothing, with cargo or without', () => {
    const untouched = { locateAt: null, show: null, preferSide: null };
    expect(arrivalView('arrive', null, true, HUR_L1)).toEqual(untouched);
    expect(arrivalView('arrive', null, false, HUR_L1)).toEqual(untouched);
  });

  it('a take-off changes nothing, with a target and cargo too', () => {
    const untouched = { locateAt: null, show: null, preferSide: null };
    expect(arrivalView('depart', ARC_L1, true, HUR_L1)).toEqual(untouched);
    expect(arrivalView('depart', ARC_L1, false, HUR_L1)).toEqual(untouched);
  });

  it('the ship is at the target already: the location is not written again, but the target is still shown (the player may be looking elsewhere)', () => {
    expect(arrivalView('arrive', ARC_L1, true, ARC_L1)).toEqual({ locateAt: null, show: ARC_L1, preferSide: 'sell' });
    expect(arrivalView('arrive', ARC_L1, false, ARC_L1)).toEqual({ locateAt: null, show: ARC_L1, preferSide: null });
  });

  it('the location is another terminal than the target and than the one seen: only the target matters', () => {
    expect(arrivalView('arrive', MIC_L1, true, HUR_L1)).toEqual({ locateAt: MIC_L1, show: MIC_L1, preferSide: 'sell' });
  });
});

// The answer to "Где прилетел?" (an arrival with no target) shows the terminal by the same rule as an arrival with a target: one function.
describe('landingView: the window once the terminal the ship stands at is known', () => {
  it('cargo aboard: the terminal is the location and is shown, on the sell side', () => {
    expect(landingView(ARC_L1, true, HUR_L1)).toEqual({ locateAt: ARC_L1, show: ARC_L1, preferSide: 'sell' });
  });

  it('an empty hold: the terminal is the location and is shown, the side is chosen as usual', () => {
    expect(landingView(ARC_L1, false, HUR_L1)).toEqual({ locateAt: ARC_L1, show: ARC_L1, preferSide: null });
  });

  it('from no location at all: the terminal is the location', () => {
    expect(landingView(MIC_L1, true, null)).toEqual({ locateAt: MIC_L1, show: MIC_L1, preferSide: 'sell' });
  });

  it('the ship stands there already: the location is not written again, the terminal is still shown', () => {
    expect(landingView(ARC_L1, true, ARC_L1)).toEqual({ locateAt: null, show: ARC_L1, preferSide: 'sell' });
  });

  it('is the very rule of an arrival with a target (arrivalView does not keep a second copy of it)', () => {
    for (const cargo of [true, false]) {
      for (const current of [null, HUR_L1, ARC_L1]) {
        expect(arrivalView('arrive', ARC_L1, cargo, current)).toEqual(landingView(ARC_L1, cargo, current));
      }
    }
  });
});
