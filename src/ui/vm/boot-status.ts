import type { ReferenceProgress } from '../../data/sync';
import { formatDuration } from '../../core/format';
import { tr } from '../../i18n';

/** What the start is doing, for the line the window shows meanwhile: a stage, so that it is said in the language of the moment. */
export type BootStage = 'start' | 'reference';

export const bootStatusText = (stage: BootStage): string => (stage === 'reference' ? tr('Загрузка справочника UEX…') : tr('Запуск…'));

/** The download of the reference as it goes, and since when (unix seconds): what the window says meanwhile. */
export interface ReferenceLoad extends ReferenceProgress {
  startedAt: number;
}

/**
 * What the download of the reference is doing, with how long it has been going: 'корабли: 12 из 40 производителей · 0:23'. The time
 * moves every second, so the player sees that it has not hung (the author: «нужно дать понять, что он не завис»).
 */
export function referenceLoadText(load: ReferenceLoad, now: number): string {
  const took = formatDuration(Math.max(0, now - load.startedAt));
  switch (load.stage) {
    case 'systems': return tr('звёздные системы · {took}', { took });
    case 'terminals': return tr('терминалы: {done} из {total} систем · {took}', { done: load.done, total: load.total, took });
    case 'commodities': return tr('товары · {took}', { took });
    case 'ships': return load.total > 0
      ? tr('корабли: {done} из {total} производителей · {took}', { done: load.done, total: load.total, took })
      : tr('корабли · {took}', { took });
    case 'saving': return tr('запись в базу · {took}', { took });
  }
}

/** The field of the ship while the list comes: how far the ships are, when that is the stage. */
export function shipLoadText(load: ReferenceLoad | null): string {
  return load !== null && load.stage === 'ships' && load.total > 0
    ? tr('Загружаю список кораблей из UEX: {done} из {total}', { done: load.done, total: load.total })
    : tr('Загружаю список кораблей из UEX');
}
