// Leaving the program by the button "Выход" of "Настройки" → "Данные" (version 1.1). A run that is going is saved and goes on counting after the next
// start, but the player may press the button by mistake, so the window asks in the way it asks before a clearing of the history (a line under the
// header, `app.ask`). Without a run there is nothing to lose, and the program closes at once. The "Выход" of the menu of the tray is the
// system's and stays as it is.

/** The question that comes before leaving while a run goes; `null` without a run: no question. */
export function quitQuestion(runGoing: boolean): { text: string; yes: string } | null {
  return runGoing ? { text: 'Идёт рейс. Закрыть программу? Рейс сохранится и продолжит отсчёт.', yes: 'Да, закрыть' } : null;
}
