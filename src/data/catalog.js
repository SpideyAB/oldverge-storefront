// The one source of catalogue data for the whole storefront.
//   demo mode      the sample products in ./products.js (clearly a demonstration, nothing is sent anywhere)
//   backend mode   published products, variants and approved images from Supabase. A failure is reported as an
//                  error state; it NEVER falls back to the sample products.
import { create } from 'zustand';
import { backend, isBackend } from '../lib/config.js';
import { supabase } from '../lib/supabase.js';
import { products as demoProducts } from './products.js';
import { registerImageSize } from './imageSizes.js';
import { PRODUCT_SELECT, mapProductRow } from './catalogMapper.js';

export const CATALOG_LIMIT = 500;

const chunk = (items, size) => {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

async function fetchAvailability(variantIds) {
  const availability = {};
  for (const ids of chunk(variantIds, 200)) {
    const { data, error } = await supabase.rpc('catalog_availability', { p_variant_ids: ids });
    if (error) return null;            // availability is advisory; the server checks stock again at checkout
    (data || []).forEach((row) => { availability[row.variant_id] = row; });
  }
  return availability;
}

export async function fetchCatalog() {
  const { data, error } = await supabase.from('products').select(PRODUCT_SELECT).eq('status', 'published')
    .order('sort_order').order('name').limit(CATALOG_LIMIT);
  if (error) throw new Error(error.message);
  const variantIds = (data || []).flatMap((row) => (row.product_variants || []).filter((v) => v.active !== false).map((v) => v.id));
  const availability = (await fetchAvailability(variantIds)) || {};
  const mapped = (data || []).map((row) => mapProductRow(row, { storageBase: backend.url, availability }));
  mapped.forEach((product) => product.images.forEach((image) => registerImageSize(image.src, image.width, image.height)));
  return mapped;
}

let inflight = null;

export const useCatalog = create((set, get) => ({
  status: isBackend ? 'idle' : 'ready',        // idle | loading | ready | error
  products: isBackend ? [] : demoProducts,
  error: null,
  loadedAt: 0,
  async load({ force = false } = {}) {
    if (!isBackend) return;
    if (!force && (get().status === 'ready' || get().status === 'loading')) return;
    if (inflight) { await inflight; return; }
    set({ status: 'loading', error: null });
    inflight = fetchCatalog()
      .then((products) => set({ status: 'ready', products, error: null, loadedAt: Date.now() }))
      .catch((error) => set({ status: 'error', error: error.message || 'catalogue_unavailable' }))
      .finally(() => { inflight = null; });
    await inflight;
  },
}));

export const getProducts = () => useCatalog.getState().products;
export const productBySlug = (slug) => (typeof slug === 'string' ? getProducts().find((product) => product.slug === slug) : undefined);
export const catalogReady = () => useCatalog.getState().status === 'ready';
