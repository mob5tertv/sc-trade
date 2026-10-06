import { describe, expect, it } from 'vitest';
import { TRIGGERS_FAILED, triggerErrorText } from '../../src/ui/vm/trigger-error';

describe('triggerErrorText', () => {
  it('shows the Russian per-key reasons of the keyboard layer as they are', () => {
    for (const reason of [
      'неизвестная клавиша: Banana',
      'нужен Ctrl или Alt',
      'не указана клавиша',
      'модификатор «Ctrl» указан дважды',
      'лишний «+» в «Ctrl++T»',
    ]) {
      expect(triggerErrorText(reason)).toBe(reason);
    }
  });

  it('has nothing to show for a key without an error', () => {
    expect(triggerErrorText(null)).toBeNull();
  });

  it('replaces the English text of a failed hook with one Russian sentence', () => {
    for (const raw of [
      'SetWindowsHookExW failed: Access is denied. (0x80070005)',
      'cannot start the hook thread: out of memory',
      'keyboard triggers need Windows',
      'the hook thread ended before the hook was installed',
      'Error: invoke failed',
    ]) {
      expect(triggerErrorText(raw)).toBe(TRIGGERS_FAILED);
    }
  });

  it('does not let a localized system message carry an English prefix onto the screen', () => {
    const raw = 'SetWindowsHookExW failed: Отказано в доступе. (0x80070005)';
    expect(triggerErrorText(raw)).toBe(TRIGGERS_FAILED);
  });

  it('replaces an empty text too', () => {
    expect(triggerErrorText('')).toBe(TRIGGERS_FAILED);
    expect(triggerErrorText('   ')).toBe(TRIGGERS_FAILED);
  });

  it('is a Russian sentence that points to the log', () => {
    expect(TRIGGERS_FAILED).toBe('Не удалось включить клавиши. Подробности в логе.');
  });
});
