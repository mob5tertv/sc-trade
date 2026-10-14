import { describe, expect, it } from 'vitest';
import { shipListState } from '../../src/ui/vm/ship-list';

describe('the field of the ship while the list of ships comes', () => {
  it('shows the list once there are ships, says that it is coming while the reference downloads, and that it did not come otherwise', () => {
    expect(shipListState(8, false)).toBe('ready');
    expect(shipListState(8, true)).toBe('ready');
    expect(shipListState(0, true)).toBe('loading');
    expect(shipListState(0, false)).toBe('missing');
  });
});
