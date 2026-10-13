import { estimate } from '../../core/estimate';
import type { EstimateCtx } from '../../core/estimate';
import type { Market, Reference } from '../../core/types';
import { formatRoi } from './route-rows';
import { terminalLabel } from './terminal-name';

// Favourite routes (spec 14.19, item 11): the player marks a route with a star, and the window tells him, with a sound, when the
// stock at its loading place has grown to a full hold. The route is good because he marked it himself: no ROI is asked. Pure.

/** A route of one commodity: where it is bought, where it is sold, and what. */
export interface FavouriteRoute { originId: number; destId: number; commodityId: number }

/** How many routes can be favourites: a handful the player really flies, not a second list of routes. */
export const FAVOURITES_MAX = 12;

export const favouriteKey = (f: FavouriteRoute): string => `${f.originId}>${f.destId}:${f.commodityId}`;

export const isFavourite = (list: readonly FavouriteRoute[], f: FavouriteRoute): boolean => list.some((x) => favouriteKey(x) === favouriteKey(f));

/**
 * The list after the star of `f` was clicked: without it when it was a favourite, with it at the end when it was not.
 * `full` says the click added nothing because the list holds `FAVOURITES_MAX` routes already.
 */
export function toggledFavourites(list: readonly FavouriteRoute[], f: FavouriteRoute): { list: FavouriteRoute[]; full: boolean } {
  if (isFavourite(list, f)) return { list: list.filter((x) => favouriteKey(x) !== favouriteKey(f)), full: false };
  if (list.length >= FAVOURITES_MAX) return { list: [...list], full: true };
  return { list: [...list, { originId: f.originId, destId: f.destId, commodityId: f.commodityId }], full: false };
}

export interface FavouriteAlert { key: string; text: string }

/**
 * The favourites whose stock has just become a full hold, and the set of those that are full now (give it back as `alerted` at
 * the next check: a route speaks ONCE per filling, and again only after its stock was seen below a full hold).
 *
 * "Full" is: the stock at the loading place, counted by the refill timer from a reading of the PLAYER'S OWN that is not cold, is
 * at least `capacity`. A quantity of UEX does not count (it does not grow, and it is not this server's), and after «Сменил
 * сервер» the player's readings are cold until he takes a new one, so the routes are silent until then. No capacity, no alert.
 */
export function favouriteAlerts(
  list: readonly FavouriteRoute[], m: Market, ref: Reference, ctx: EstimateCtx, capacity: number, alerted: ReadonlySet<string>,
): { alerts: FavouriteAlert[]; alerted: Set<string> } {
  const alerts: FavouriteAlert[] = [];
  const full = new Set<string>();
  for (const f of list) {
    const buy = capacity > 0 ? estimate(m, f.originId, f.commodityId, 'buy', ctx) : null;
    if (buy === null || buy.scuOrigin !== 'own' || buy.scu === null || buy.scu < capacity) continue;
    const key = favouriteKey(f);
    full.add(key);
    if (alerted.has(key)) continue;
    const sell = estimate(m, f.destId, f.commodityId, 'sell', ctx);
    const roi = sell !== null && buy.price > 0 ? ` · ROI ${formatRoi((sell.price - buy.price) / buy.price)}` : '';
    const code = ref.commodities.get(f.commodityId)?.code || `#${f.commodityId}`;
    alerts.push({
      key,
      text: `★ ${terminalLabel(ref, f.originId)} → ${terminalLabel(ref, f.destId)}: ${code} ≈ ${Math.round(buy.scu)} SCU, на полный трюм${roi}`,
    });
  }
  return { alerts, alerted: full };
}

/** What the window says when a star could not be added. */
export const FAVOURITES_FULL = `Избранных маршрутов уже ${FAVOURITES_MAX}: сними звёздочку с одного из них`;
