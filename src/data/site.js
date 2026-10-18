// Store-wide public content: settings (ordering switch, contact details, notice), approved site images,
// published policies and the enabled payment/shipping options.
//   demo mode      static defaults (ordering closed, contact details unset, the original policy text)
//   backend mode   rows from Supabase. If they cannot be loaded the UI shows an error; it does not invent values.
import { create } from 'zustand';
import { backend, isBackend } from '../lib/config.js';
import { supabase } from '../lib/supabase.js';
import { mapSiteImages, settingsMap } from './catalogMapper.js';
import { POLICIES as DEMO_POLICIES } from './policies.js';
import { registerImageSize } from './imageSizes.js';

const DEMO_NOTICE = 'Displayed prices are samples. Orders are not open yet.';

const demoState = {
  status: 'ready', error: null,
  settings: { ordering_enabled: false, max_quantity_per_line: 9, tax_mode: 'not_calculated', 'notice.footer': DEMO_NOTICE },
  siteImages: {},
  policies: DEMO_POLICIES,
  paymentMethods: [],
  shippingMethods: [],
};

export async function fetchSite() {
  const [settings, images, policies, payment, methods, rates, zones] = await Promise.all([
    supabase.from('store_settings').select('key, value'),
    supabase.from('site_images').select('key, bucket, path, alt_text, width, height, approval_status'),
    supabase.from('policy_pages').select('slug, title, published_sections, version, published_at').not('published_at', 'is', null),
    supabase.from('payment_methods').select('code, label, description, kind').order('sort_order'),
    supabase.from('shipping_methods').select('code, label, description, estimate_text').order('sort_order'),
    supabase.from('shipping_rates').select('method_code, zone_code, price_pkr, free_over_pkr'),
    supabase.from('shipping_zones').select('code, name, provinces'),
  ]);
  const failed = [settings, images, policies, payment, methods, rates, zones].find((result) => result.error);
  if (failed) throw new Error(failed.error.message);
  const siteImages = mapSiteImages(images.data, backend.url);
  Object.values(siteImages).forEach((image) => registerImageSize(image.src, image.width, image.height));
  const bySlug = new Map(DEMO_POLICIES.map((policy) => [policy.slug, policy]));
  const publishedPolicies = (policies.data || []).filter((row) => bySlug.has(row.slug) && row.published_sections).map((row) => ({
    ...bySlug.get(row.slug), title: row.title, sections: row.published_sections, updated: String(row.published_at).slice(0, 10), version: row.version,
  }));
  return {
    settings: settingsMap(settings.data), siteImages, policies: publishedPolicies, paymentMethods: payment.data || [],
    shippingMethods: (methods.data || []).map((method) => ({ ...method, rates: (rates.data || []).filter((rate) => rate.method_code === method.code), zones: zones.data || [] })),
  };
}

let inflight = null;

export const useSite = create((set, get) => ({
  ...(isBackend ? { status: 'idle', error: null, settings: {}, siteImages: {}, policies: [], paymentMethods: [], shippingMethods: [] } : demoState),
  async load({ force = false } = {}) {
    if (!isBackend) return;
    if (!force && (get().status === 'ready' || get().status === 'loading')) return;
    if (inflight) { await inflight; return; }
    set({ status: 'loading', error: null });
    inflight = fetchSite()
      .then((data) => set({ ...data, status: 'ready', error: null }))
      .catch((error) => set({ status: 'error', error: error.message || 'site_unavailable' }))
      .finally(() => { inflight = null; });
    await inflight;
  },
}));

const state = () => useSite.getState();
export const getSetting = (key, fallback = null) => (key in state().settings ? state().settings[key] : fallback);
export const orderingOpen = () => state().settings.ordering_enabled === true;
export const maxQuantity = () => Number(getSetting('max_quantity_per_line', 9)) || 9;
export const getPolicies = () => state().policies;
export const footerNotice = () => getSetting('notice.footer', DEMO_NOTICE);

/** Public contact details. `connected` is true when messages can actually be saved (backend mode). */
export function contactInfo() {
  const read = (name) => {
    const value = getSetting(`contact.${name}`, null);
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  };
  return { email: read('email'), phone: read('phone'), whatsapp: read('whatsapp'), instagram: read('instagram'), address: read('address'), connected: isBackend };
}

/** Demo mode: the original files in /public/images. Backend mode: only approved images from Storage, else null. */
export const DEMO_SITE_IMAGES = {
  'quarter-zip-beige': { src: '/images/quarter-zip-beige.jpg', alt: 'Man in a beige quarter-zip' },
  'watch-seiko-sports': { src: '/images/watch-seiko-sports.jpg', alt: 'A sports watch on a white surface' },
  'oldverge-hero-model': { src: '/images/oldverge-hero-model.jpg', alt: 'Man wearing a grey-green quarter-zip, smiling' },
  'watch-timex-weekender': { src: '/images/watch-timex-weekender.jpg', alt: 'A field-style watch on a white surface' },
  'quarter-zip-neutral': { src: '/images/quarter-zip-neutral.jpg', alt: 'A grey sweater with a zipper' },
  'oldverge-watch-editorial': { src: '/images/oldverge-watch-editorial.jpg', alt: 'Close-up editorial photograph of a wristwatch' },
  'watch-hero-wrist': { src: '/images/watch-hero-wrist.jpg', alt: 'A watch on a wrist' },
  'watch-casio-mtp': { src: '/images/watch-casio-mtp.jpg', alt: 'A round analog watch' },
  'oldverge-hero-watch-detail': { src: '/images/oldverge-hero-watch-detail.jpg', alt: 'A wristwatch under a dark jacket sleeve' },
  'quarter-zip-soft-knit': { src: '/images/quarter-zip-soft-knit.jpg', alt: 'A dark knit sweater on a hanger' },
  'quarter-zip-soft-knit-cutout': { src: '/images/quarter-zip-soft-knit-cutout.webp', alt: 'A dark knit sweater on a hanger' },
};

export function siteImage(key) {
  if (!isBackend) return DEMO_SITE_IMAGES[key] || null;
  return state().siteImages[key] || null;
}
