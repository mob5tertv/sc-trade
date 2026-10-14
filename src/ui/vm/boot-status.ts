import { tr } from '../../i18n';

/** What the start is doing, for the line the window shows meanwhile: a stage, so that it is said in the language of the moment. */
export type BootStage = 'start' | 'reference';

export const bootStatusText = (stage: BootStage): string => (stage === 'reference' ? tr('Загрузка справочника UEX…') : tr('Запуск…'));
