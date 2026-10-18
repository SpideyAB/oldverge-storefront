import { useMemo } from 'react';
import { isBackend } from '../lib/config.js';
import { useCatalog } from './catalog.js';
import { useSite } from './site.js';

// Order alternates clothing and watches and keeps repeated watch photos apart (the curated demo order).
export const DEMO_FEATURED = ['quarter-zip-black', 'casio-mtp', 'quarter-zip-beige', 'seiko-5', 'quarter-zip-navy', 'timex-weekender', 'quarter-zip-olive', 'citizen-eco-drive', 'casio-a168', 'orient-bambino'];
export const FEATURED_LIMIT = 10;

/** Pure: which products the home carousel shows, in order. `slugs` is the curated list (setting home.featured). */
export function pickFeatured(products, slugs) {
  if (Array.isArray(slugs) && slugs.length) {
    const bySlug = new Map(products.map((product) => [product.slug, product]));
    const picked = slugs.map((slug) => bySlug.get(slug)).filter(Boolean);
    if (picked.length) return picked.slice(0, FEATURED_LIMIT);
  }
  return products.slice(0, FEATURED_LIMIT);
}

/** Featured products: the curated slug list from the store settings (backend) or the demo order, limited to published products. */
export function useFeatured() {
  const products = useCatalog((state) => state.products);
  const configured = useSite((state) => state.settings['home.featured']);
  return useMemo(() => pickFeatured(products, isBackend ? configured : DEMO_FEATURED), [products, configured]);
}
