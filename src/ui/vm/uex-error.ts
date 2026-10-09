import { UexError, type UexErrorKind } from '../../data/uex-client';

// What the player reads when UEX could not be reached or answered badly. Raw error text (URLs, stack
// traces, driver messages) never reaches the screen: it is in the log.
const BY_KIND: Record<UexErrorKind, string> = {
  network: 'Нет связи с UEX. Проверь подключение к интернету.',
  http: 'Сервер UEX ответил ошибкой. Попробуй позже.',
  status: 'UEX отклонил запрос. Попробуй позже.',
  shape: 'UEX прислал непонятный ответ. Попробуй позже.',
};

const OTHER = 'Не удалось обработать данные UEX. Подробности в логе.';

export function uexErrorText(err: unknown): string {
  return err instanceof UexError ? BY_KIND[err.kind] : OTHER;
}
