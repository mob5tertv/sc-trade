// What the field of the ship shows (version 1.3, the author: «пока загружается список кораблей при первом запуске, нам бы
// дать знать, что он загружается, а не смотреть на пустое поле»): the list, the word that it is coming, or that it did not come.

export type ShipListState = 'ready' | 'loading' | 'missing';

/**
 * `ready` once the reference has ships; without them `loading` while the reference of UEX is being downloaded (the first start,
 * «Обновить справочник»), else `missing`: the download failed or has not run, and the capacity is typed by hand.
 */
export function shipListState(shipCount: number, referenceLoading: boolean): ShipListState {
  if (shipCount > 0) return 'ready';
  return referenceLoading ? 'loading' : 'missing';
}
