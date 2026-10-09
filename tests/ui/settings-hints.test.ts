import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SETTING_HINTS, type HintedSetting } from '../../src/ui/vm/settings-hints';

const FIELDS: HintedSetting[] = ['scuCapacity', 'budget', 'quantumSpeedKkms', 'overheadMin', 'overheadEmptyMin', 'topN', 'refillFullMin'];

describe('SETTING_HINTS: what a field of the calculation does', () => {
  it('has a sentence for each of the seven fields that had none', () => {
    expect(Object.keys(SETTING_HINTS).sort()).toEqual([...FIELDS].sort());
    for (const field of FIELDS) expect(SETTING_HINTS[field].length, field).toBeGreaterThan(20);
  });

  it('speaks to the player as «ты»', () => {
    for (const field of FIELDS) expect(SETTING_HINTS[field], field).not.toMatch(/(ите|йте|ьте)(?![а-яё])/);
  });

  it('names what the code does with the number, and no more: a budget limits the volume, the speed makes the time of a flight', () => {
    const routes = readFileSync('src/core/routes.ts', 'utf8');
    expect(routes).toContain('limits.push(i.budget / i.buyPrice)'); // the budget limits the volume of a trip
    expect(routes).toContain('(distanceGm * 1000) / speedKkms'); // the speed turns a distance into a time
    expect(routes).toContain('slice(0, settings.topN)'); // the number of options
    expect(SETTING_HINTS.budget).toMatch(/потратить на закупку/);
    expect(SETTING_HINTS.quantumSpeedKkms).toMatch(/расстояния считается время полёта/);
    expect(SETTING_HINTS.topN).toMatch(/Сколько лучших вариантов/);
  });
});
