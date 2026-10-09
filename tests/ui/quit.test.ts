import { describe, expect, it } from 'vitest';
import { quitQuestion } from '../../src/ui/vm/quit';

// "Выход" in "Настройки" → "Данные": the window asks only while a run is going, in the way the clearing of the history asks (a line under
// the header with the question and two buttons).

describe('quitQuestion', () => {
  it('asks while a run goes: it is saved and goes on counting after the next start', () => {
    expect(quitQuestion(true)).toEqual({ text: 'Идёт рейс. Закрыть программу? Рейс сохранится и продолжит отсчёт.', yes: 'Да, закрыть' });
  });

  it('asks nothing without a run: the program closes at once', () => {
    expect(quitQuestion(false)).toBeNull();
  });
});
