import { UexError, type UexErrorKind } from '../../data/uex-client';
import { tr } from '../../i18n';

// What the player reads when UEX could not be reached or answered badly. Raw error text (URLs, stack
// traces, driver messages) never reaches the screen: it is in the log.
const BY_KIND: Record<UexErrorKind, string> = {
  get network() { return tr('Нет связи с UEX. Проверь подключение к интернету.'); },
  get http() { return tr('Сервер UEX ответил ошибкой. Попробуй позже.'); },
  get status() { return tr('UEX отклонил запрос. Попробуй позже.'); },
  get shape() { return tr('UEX прислал непонятный ответ. Попробуй позже.'); },
};

const OTHER = (): string => tr('Не удалось обработать данные UEX. Подробности в логе.');

export function uexErrorText(err: unknown): string {
  return err instanceof UexError ? BY_KIND[err.kind] : OTHER();
}
