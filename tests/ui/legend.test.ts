import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LEGEND, LEGEND_WORDS, legendTitle, type LegendTerm } from '../../src/ui/vm/legend';
import { RANGE_HEAD_TITLE } from '../../src/ui/vm/terminal-rows';

// The words of the screen that the README explains in «Обозначения» say the same in their tooltips (version 1.1.1): the player does not open the README
// in a flight. The texts are in one module (`vm/legend.ts`), the components take them from there. This test keeps three things honest: every word of the
// list has a tooltip, every tooltip is short, and every tooltip is really hung on the screen by a component (a legend nobody uses is no legend).

const root = resolve(__dirname, '..', '..');
const source = (path: string): string => readFileSync(resolve(root, path), 'utf8');

/** The words the README explains and the screen shows (the brief of the task): each one of them must be among the words of the legend. */
const README_WORDS = ['Худший', 'Время', 'скорость выучена', 'Мин–макс', '≈', 'UEC/ч'];

const TERMS = Object.keys(LEGEND_WORDS) as LegendTerm[];

describe('the legend: the words of the screen and what their tooltips say', () => {
  it('has a word for every tooltip and a tooltip for every word', () => {
    expect(Object.keys(LEGEND).sort()).toEqual([...TERMS].sort());
    for (const term of TERMS) {
      expect(LEGEND_WORDS[term], term).not.toBe('');
      expect(LEGEND[term], term).not.toBe('');
    }
  });

  it('covers every word of the README «Обозначения» that the screen shows without a word of its own for it', () => {
    for (const word of README_WORDS) {
      expect(TERMS.some((term) => LEGEND_WORDS[term].startsWith(word)), word).toBe(true);
    }
  });

  it('has a tooltip for each of the three «≈» of the README (the column «SCU», the section «Рейс» and the mini line, the title of «Варианты») and each of the four «UEC/ч»', () => {
    const approx = TERMS.filter((term) => LEGEND_WORDS[term].startsWith('≈'));
    expect(approx.sort()).toEqual(['approxOptions', 'approxRun', 'approxScu', 'approxStrip']);
    const rate = TERMS.filter((term) => LEGEND_WORDS[term].startsWith('UEC/ч'));
    expect(rate.sort()).toEqual(['rateOptions', 'rateRoutes', 'rateRun', 'rateSessions']);
  });

  it('is short: one or two sentences, a tooltip and not a manual', () => {
    for (const term of TERMS) {
      const text = LEGEND[term];
      expect(text.length, term).toBeLessThanOrEqual(260);
      expect(text.split(/[.!?](?:\s|$)/).filter((part) => part.trim() !== '').length, `${term}: sentences`).toBeLessThanOrEqual(3);
    }
  });

  it('says what the README says of the words', () => {
    // «Худший»: the purchase at the upper bound of its range, the sale at the lower bound of its range
    expect(LEGEND.worst).toMatch(/закупка по верхней границе диапазона, продажа по нижней/);
    // «Время»: the whole run, and the empty flight to the purchase when it is at another terminal
    expect(LEGEND.time).toMatch(/пустой перелёт/);
    expect(LEGEND.time).toMatch(/медиана твоих рейсов/);
    // «скорость выучена»: by the player's own readings; the other one is the spare one, from the setting
    expect(LEGEND.rateLearned).toMatch(/по твоим замерам/);
    expect(LEGEND.rateDefault).toMatch(/запасная/);
    // «Мин–макс»: the week, else the month, else all time; and «= 5 500»
    expect(LEGEND.range).toContain(RANGE_HEAD_TITLE);
    expect(LEGEND.range).toMatch(/= 5 500/);
    // the three «≈»
    expect(LEGEND.approxScu).toMatch(/таймеру пополнения/);
    expect(LEGEND.approxRun).toMatch(/в точке цели по ожидаемым ценам/);
    expect(LEGEND.approxStrip).toMatch(/в точке цели по ожидаемым ценам/);
    expect(LEGEND.approxOptions).toMatch(/предварительный/);
    // the four «UEC/ч»
    expect(LEGEND.rateOptions).toMatch(/делённая на «Время»/);
    expect(LEGEND.rateRun).toMatch(/всего рейса за время всего рейса/);
    expect(LEGEND.rateRoutes).toMatch(/завершённым рейсам/);
    expect(LEGEND.rateSessions).toMatch(/всё время сессии/);
  });
});

describe('legendTitle: the legend and, under it, what is true of this very place', () => {
  it('is the legend alone when the place has nothing to add', () => {
    expect(legendTitle(LEGEND.time)).toBe(LEGEND.time);
    expect(legendTitle(LEGEND.time, null)).toBe(LEGEND.time);
    expect(legendTitle(LEGEND.time, '')).toBe(LEGEND.time);
  });

  it('puts the detail on a line of its own after the legend', () => {
    expect(legendTitle(LEGEND.time, 'по твоим рейсам · пустой перелёт 4:10')).toBe(`${LEGEND.time}\nпо твоим рейсам · пустой перелёт 4:10`);
  });
});

describe('the components hang the legend on the words, and keep no text of their own for them', () => {
  /** Which files must use which text (`LEGEND.<term>`): the places where the word stands. */
  const USED_BY: Record<LegendTerm, string[]> = {
    worst: ['src/ui/components/RouteList.svelte'],
    time: ['src/ui/components/RouteList.svelte'],
    rateLearned: ['src/ui/components/TerminalTable.svelte'],
    rateDefault: ['src/ui/components/TerminalTable.svelte'],
    range: ['src/ui/components/RouteList.svelte', 'src/ui/components/TerminalTable.svelte'],
    approxScu: ['src/ui/components/TerminalTable.svelte'],
    approxRun: ['src/ui/components/RunCard.svelte'],
    approxStrip: ['src/ui/components/StripView.svelte'],
    approxOptions: ['src/ui/sections/OptionsSection.svelte'],
    rateOptions: ['src/ui/components/RouteList.svelte', 'src/ui/sections/OptionsSection.svelte'],
    rateRun: ['src/ui/components/RunCard.svelte'],
    rateRoutes: ['src/ui/components/RoutesTable.svelte', 'src/ui/components/HistoryList.svelte'],
    rateSessions: ['src/ui/components/SessionsList.svelte'],
  };

  it('every text of the legend is used where its word stands', () => {
    for (const term of TERMS) {
      for (const path of USED_BY[term]) {
        expect(source(path), `${path}: LEGEND.${term}`).toMatch(new RegExp(`LEGEND\\.${term}\\b`));
      }
    }
  });

  it('the old tooltips of those words are gone (a second text would drift from the README again)', () => {
    expect(source('src/ui/components/RouteList.svelte')).not.toContain('Прибыль при худшем исходе цен');
    expect(source('src/ui/components/TerminalTable.svelte')).not.toContain('Скорость пополнения выучена по твоим замерам');
    expect(source('src/ui/components/TerminalTable.svelte')).not.toContain('Оценка по таймеру пополнения: сколько там сейчас');
    expect(source('src/ui/components/TerminalTable.svelte')).not.toMatch(/\bRANGE_HEAD_TITLE\b/);
    expect(source('src/ui/components/RouteList.svelte')).not.toMatch(/\bRANGE_HEAD_TITLE\b/);
  });
});
