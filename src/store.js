import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { catalogReady, productBySlug } from './data/catalog.js';
import { variantFor } from './data/catalogMapper.js';
import { MAX_QTY, computeTotals } from './lib/money.js';
import { SAMPLE_ADDRESSES, SAMPLE_ORDERS } from './data/sampleCustomer.js';

// ---- Variants and lines -----------------------------------------------------
// A cart line stores only { productId, size, color, quantity }. Names, images and prices are always
// read from the catalogue, so the cart can never disagree with the product data.
export const lineKey = (productId, size, color) => `${productId}|${size}|${color}`;
const clampQty = (value) => Math.min(MAX_QTY, Math.max(1, Math.floor(Number(value)) || 1));

/** 'available' or 'sold-out'. The catalogue has no stock data, so nothing is sold out unless an entry says so. */
export const variantStatus = (product, size) => (product.soldOut || product.unavailableSizes?.includes(size) ? 'sold-out' : 'available');

export const needsSize = (product) => product.sizes.length > 1;

/** Returns an error message, or '' when the options are valid for this product. */
export function validateOptions(product, { size, color, quantity }) {
  if (!product) return 'This product is no longer available.';
  if (needsSize(product) && !size) return 'Choose a size first.';
  const chosen = size || product.sizes[0];
  if (!product.sizes.includes(chosen)) return 'Choose a size from the list.';
  if (variantStatus(product, chosen) === 'sold-out') return 'This option is sold out.';
  if (color && !product.colors.includes(color)) return 'Choose an available colour.';
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QTY) return `Choose a quantity from 1 to ${MAX_QTY}.`;
  return '';
}

/** Defensive: accepts anything read from storage and returns clean lines. Older carts stored whole products. */
export function sanitizeLines(raw) {
  if (!Array.isArray(raw)) return [];
  const merged = new Map();
  raw.forEach((entry) => {
    if (!entry || typeof entry !== 'object') return;
    const productId = entry.productId ?? entry.slug ?? entry.id;
    const product = typeof productId === 'string' ? productBySlug(productId) : null;
    if (!product) return;
    const size = typeof entry.size === 'string' && product.sizes.includes(entry.size) ? entry.size : product.sizes[0];
    const color = typeof entry.color === 'string' && product.colors.includes(entry.color) ? entry.color : product.colors[0];
    const key = lineKey(product.id, size, color);
    const quantity = clampQty(entry.quantity);
    const existing = merged.get(key);
    merged.set(key, existing ? { ...existing, quantity: clampQty(existing.quantity + quantity) } : { key, productId: product.id, size, color, quantity });
  });
  return [...merged.values()];
}

/** Shape-only cleaning, used while the catalogue has not loaded yet (backend mode). Product checks happen in reconcileLines. */
export function structuralLines(raw) {
  if (!Array.isArray(raw)) return [];
  const merged = new Map();
  raw.forEach((entry) => {
    if (!entry || typeof entry !== 'object') return;
    const productId = entry.productId ?? entry.slug ?? entry.id;
    if (typeof productId !== 'string' || !productId) return;
    const size = typeof entry.size === 'string' ? entry.size : '';
    const color = typeof entry.color === 'string' ? entry.color : '';
    const key = lineKey(productId, size, color);
    const quantity = clampQty(entry.quantity);
    const existing = merged.get(key);
    merged.set(key, existing ? { ...existing, quantity: clampQty(existing.quantity + quantity) } : { key, productId, size, color, quantity });
  });
  return [...merged.values()];
}

/** Strict reconciliation against the loaded catalogue: unknown products or options are removed, never silently changed. */
export function reconcileLines(lines) {
  const kept = []; const removed = [];
  (lines || []).forEach((line) => {
    const product = productBySlug(line.productId);
    const validSize = product && product.sizes.includes(line.size);
    const validColor = product && (!line.color || product.colors.includes(line.color));
    const available = product && validSize && validColor && variantStatus(product, line.size) !== 'sold-out';
    if (available) kept.push({ ...line, quantity: clampQty(line.quantity) });
    else removed.push({ productId: line.productId, name: product?.name || line.productId, reason: !product ? 'no_longer_sold' : !validSize || !validColor ? 'option_unavailable' : 'sold_out' });
  });
  return { kept, removed };
}

export function resolveLines(lines) {
  return (lines || []).map((line) => {
    const product = productBySlug(line.productId ?? line.slug);
    if (!product) return null;
    const unitPrice = variantFor(product, line.size, line.color)?.price ?? product.price;
    const quantity = clampQty(line.quantity);
    return { key: lineKey(product.id, line.size, line.color), product, size: line.size, color: line.color, quantity, unitPrice, lineTotal: unitPrice * quantity };
  }).filter(Boolean);
}

export const cartCount = (cart) => cart.reduce((total, line) => total + line.quantity, 0);
export const orderSummary = (order) => {
  const lines = resolveLines(order.items);
  return { lines, ...computeTotals(lines, order.shippingId) };
};

// ---- Demo customer (name and email only, kept for the browser session; never a password) ----
const CUSTOMER_KEY = 'ov-demo-customer';
const readCustomer = () => {
  try {
    const value = JSON.parse(sessionStorage.getItem(CUSTOMER_KEY) || 'null');
    return value && typeof value.email === 'string' ? { name: String(value.name || ''), email: value.email, phone: String(value.phone || '') } : null;
  } catch { return null; }
};
const writeCustomer = (customer) => {
  try { if (customer) sessionStorage.setItem(CUSTOMER_KEY, JSON.stringify(customer)); else sessionStorage.removeItem(CUSTOMER_KEY); } catch { /* session storage unavailable */ }
};

let announceTimer = 0;

export const useStore = create(persist((set, get) => ({
  cart: [],
  cartOpen: false,
  directItem: null,       // the single item of a "Buy now" checkout; separate from the cart
  announcement: '',       // polite live-region message for cart changes and feedback
  cartNotice: '',         // why lines were removed when the cart was checked against the current catalogue
  lastOrder: null,        // memory only: contact and address details are never persisted
  orders: [],             // demo orders placed in this tab, memory only
  customer: readCustomer(),
  addresses: SAMPLE_ADDRESSES,
  recentSearches: [],

  announce: (message) => {
    set({ announcement: message });
    window.clearTimeout(announceTimer);
    announceTimer = window.setTimeout(() => set({ announcement: '' }), 4000);
  },
  // After the catalogue loads (backend mode): drop lines that are no longer sold and say why. Prices are never stored.
  reconcileCart: () => {
    const { kept, removed } = reconcileLines(get().cart);
    const direct = get().directItem ? reconcileLines([get().directItem]) : null;
    if (!removed.length && !(direct && direct.removed.length)) return;
    const names = [...removed, ...(direct ? direct.removed : [])].map((item) => item.name);
    set({
      cart: kept, directItem: direct && direct.kept.length ? direct.kept[0] : null,
      cartNotice: `${names.join(', ')} ${names.length === 1 ? 'is' : 'are'} no longer available and ${names.length === 1 ? 'was' : 'were'} removed from your bag.`,
    });
  },
  dismissCartNotice: () => set({ cartNotice: '' }),
  openCart: () => set({ cartOpen: true }),
  closeCart: () => set({ cartOpen: false }),

  addToCart: (product, { size, color, quantity = 1, open = true } = {}) => {
    const chosenSize = size || (needsSize(product) ? '' : product.sizes[0]);
    const chosenColor = color || product.colors[0];
    const error = validateOptions(product, { size: chosenSize, color: chosenColor, quantity });
    if (error) return { ok: false, error };
    const key = lineKey(product.id, chosenSize, chosenColor);
    const cart = [...get().cart];
    const index = cart.findIndex((line) => line.key === key);
    const capped = (index >= 0 ? cart[index].quantity : 0) + quantity > MAX_QTY;
    if (index >= 0) cart[index] = { ...cart[index], quantity: clampQty(cart[index].quantity + quantity) };
    else cart.push({ key, productId: product.id, size: chosenSize, color: chosenColor, quantity: clampQty(quantity) });
    set({ cart, cartOpen: open ? true : get().cartOpen });
    get().announce(capped ? `You can buy up to ${MAX_QTY} of ${product.name}. The cart holds ${MAX_QTY}.` : `${product.name} added to your cart.`);
    return { ok: true, capped };
  },
  setQuantity: (key, quantity) => {
    const next = Number(quantity);
    if (!Number.isFinite(next) || next < 1) return;
    set((state) => ({ cart: state.cart.map((line) => (line.key === key ? { ...line, quantity: clampQty(next) } : line)) }));
  },
  removeLine: (key) => {
    const line = get().cart.find((entry) => entry.key === key);
    set((state) => ({ cart: state.cart.filter((entry) => entry.key !== key) }));
    if (line) get().announce(`${productBySlug(line.productId)?.name || 'Item'} removed from your cart.`);
  },

  // Buy now: validate, remember just this item, and let the checkout read it. The cart is not touched.
  buyNowProduct: (product, { size, color, quantity = 1 } = {}) => {
    const chosenSize = size || (needsSize(product) ? '' : product.sizes[0]);
    const chosenColor = color || product.colors[0];
    const error = validateOptions(product, { size: chosenSize, color: chosenColor, quantity });
    if (error) return { ok: false, error };
    set({ directItem: { key: lineKey(product.id, chosenSize, chosenColor), productId: product.id, size: chosenSize, color: chosenColor, quantity }, cartOpen: false });
    return { ok: true };
  },
  buyNowLine: (key) => {
    const line = get().cart.find((entry) => entry.key === key);
    if (!line) return { ok: false, error: 'This item is no longer in your cart.' };
    set({ directItem: { ...line }, cartOpen: false });
    return { ok: true };
  },

  // A direct purchase leaves the cart alone; a cart checkout buys (and so clears) every cart line.
  // Backend checkout finished: the order exists on the server, so nothing about it is kept in this store.
  finishCheckout: (source) => set((state) => ({ cart: source === 'cart' ? [] : state.cart, directItem: null })),
  completeOrder: (order, source) => set((state) => ({
    orders: [order, ...state.orders],
    lastOrder: order,
    cart: source === 'cart' ? [] : state.cart,
    directItem: null,
  })),

  signIn: (customer) => { writeCustomer(customer); set({ customer }); },
  signOut: () => { writeCustomer(null); set({ customer: null }); },
  updateCustomer: (changes) => { const next = { ...get().customer, ...changes }; writeCustomer(next); set({ customer: next }); },
  saveAddress: (address) => set((state) => {
    const id = address.id || `addr-${Date.now()}`;
    const exists = state.addresses.some((entry) => entry.id === id);
    let list = exists ? state.addresses.map((entry) => (entry.id === id ? { ...address, id } : entry)) : [...state.addresses, { ...address, id }];
    if (address.isDefault) list = list.map((entry) => ({ ...entry, isDefault: entry.id === id }));
    if (!list.some((entry) => entry.isDefault) && list.length) list[0] = { ...list[0], isDefault: true };
    return { addresses: list };
  }),
  deleteAddress: (id) => set((state) => ({ addresses: state.addresses.filter((entry) => entry.id !== id) })),

  rememberSearch: (query) => {
    const normalized = String(query || '').trim();
    if (normalized) set((state) => ({ recentSearches: [normalized, ...state.recentSearches.filter((item) => item.toLowerCase() !== normalized.toLowerCase())].slice(0, 5) }));
  },
}), {
  name: 'oldverge-store-v4',
  version: 1,
  storage: createJSONStorage(() => localStorage),
  // Only the cart, the buy-now item and recent searches are stored. No contact, address or payment data.
  partialize: (state) => ({ cart: state.cart, directItem: state.directItem, recentSearches: state.recentSearches }),
  merge: (persisted, current) => {
    const saved = persisted && typeof persisted === 'object' ? persisted : {};
    // Before the catalogue has loaded (backend mode) only the shape can be checked; reconcileCart validates products later.
    const clean = catalogReady() ? sanitizeLines : structuralLines;
    const direct = clean(saved.directItem ? [saved.directItem] : [])[0] || null;
    const recent = Array.isArray(saved.recentSearches) ? saved.recentSearches.filter((item) => typeof item === 'string').slice(0, 5) : [];
    return { ...current, cart: clean(saved.cart), directItem: direct, recentSearches: recent };
  },
}));

export const allOrders = (orders) => [...orders, ...SAMPLE_ORDERS];
