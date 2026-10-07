import { getContext, setContext } from 'svelte';
import type { GalleryData } from './data';

/** What every page of the gallery shares: the data, and the one state to draw (`null`: all states of the page). */
export interface GalleryContext { data: GalleryData; only: string | null }

const KEY = Symbol('gallery');

export const provideGallery = (context: GalleryContext): void => setContext(KEY, context);
export const useGallery = (): GalleryContext => getContext<GalleryContext>(KEY);
