import { getProducts } from './catalog.js';

// Single source for collection routes, display names, brand identifiers and
// the header navigation. Routes stay /shop, /shop/watches, /shop/quarter-zips;
// watch brands use /shop/watches?brand=<id>.

export const slugify = (value) => String(value ?? '')
  .toLowerCase()
  .normalize('NFKD')
  .replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');

// Brands requested for the navigation, in display order. "Best Win" is the
// supplied name and is kept exactly as given.
export const NAV_WATCH_BRANDS = [
  { id: 'rolex', name: 'Rolex' },
  { id: 'patek-philippe', name: 'Patek Philippe' },
  { id: 'cartier', name: 'Cartier' },
  { id: 'franck-muller', name: 'Franck Muller' },
  { id: 'best-win', name: 'Best Win' },
];

export const brandId = (product) => slugify(product.brand);

// Every watch brand a visitor can filter by: the requested brands first, then
// any other brand already in the catalogue (Casio, Timex, ...). Counts come
// from the real catalogue, so a requested brand without listings shows 0.
export const watchBrandOptions = () => {
  const counts = new Map();
  getProducts().filter((product) => product.type === 'watch').forEach((product) => {
    const id = brandId(product);
    const entry = counts.get(id) || { id, name: product.brand, count: 0 };
    entry.count += 1;
    counts.set(id, entry);
  });
  const requested = NAV_WATCH_BRANDS.map((brand) => ({ ...brand, count: counts.get(brand.id)?.count || 0 }));
  const others = [...counts.values()].filter((entry) => !NAV_WATCH_BRANDS.some((brand) => brand.id === entry.id));
  return [...requested, ...others];
};

export const brandDisplayName = (id) => watchBrandOptions().find((brand) => brand.id === id)?.name || null;

// Data values stay as they are ('Quarter-Zips'); this is what visitors read.
export const categoryLabel = (category) => (category === 'Quarter-Zips' ? 'Quarter Zips' : category);

export const COLLECTIONS = {
  all: { key: 'all', path: '/shop', heading: 'The collection', label: 'All', category: null },
  watches: { key: 'watches', path: '/shop/watches', heading: 'Watches', label: 'Watches', category: 'Watches' },
  'quarter-zips': { key: 'quarter-zips', path: '/shop/quarter-zips', heading: 'Quarter Zips', label: 'Clothes', category: 'Quarter-Zips' },
};

export const collectionForCategory = (category) => (category ? COLLECTIONS[String(category).toLowerCase()] || null : COLLECTIONS.all);
export const collectionForProduct = (product) => (product.category === 'Watches' ? COLLECTIONS.watches : COLLECTIONS['quarter-zips']);
export const collectionProducts = (collection) => (collection.category ? getProducts().filter((product) => product.category === collection.category) : getProducts());

export const NAV_GROUPS = [
  {
    id: 'watches',
    label: 'Watches',
    to: COLLECTIONS.watches.path,
    links: [
      { label: 'All Watches', to: COLLECTIONS.watches.path },
      ...NAV_WATCH_BRANDS.map((brand) => ({ label: brand.name, to: `${COLLECTIONS.watches.path}?brand=${brand.id}` })),
    ],
  },
  {
    id: 'clothes',
    label: 'Clothes',
    to: COLLECTIONS['quarter-zips'].path,
    links: [{ label: 'Quarter Zips', to: COLLECTIONS['quarter-zips'].path }],
  },
];

// Breadcrumb trail for a collection view or a product. `brand` is a brand id.
export const crumbsFor = ({ collection, brand, product }) => {
  const trail = [{ label: 'Home', to: '/' }, { label: 'Shop', to: COLLECTIONS.all.path }];
  const target = product ? collectionForProduct(product) : collection;
  if (target?.key === 'watches') {
    trail.push({ label: 'Watches', to: COLLECTIONS.watches.path });
    const id = product ? brandId(product) : brand;
    const name = id && brandDisplayName(id);
    if (name) trail.push({ label: name, to: `${COLLECTIONS.watches.path}?brand=${id}` });
  } else if (target?.key === 'quarter-zips') {
    trail.push({ label: 'Clothes', to: COLLECTIONS['quarter-zips'].path });
    trail.push({ label: 'Quarter Zips', to: COLLECTIONS['quarter-zips'].path });
  }
  return trail;
};

// Page title for the current /shop URL (used by App.jsx).
export const shopTitle = (pathname, search) => {
  const category = pathname.replace(/^\/shop\/?/, '').split('/')[0];
  const collection = collectionForCategory(category);
  if (!collection) return 'Shop | OLDVERGE';
  const brands = new URLSearchParams(search).getAll('brand').map(slugify);
  const brand = collection.key === 'watches' && brands.length === 1 ? brandDisplayName(brands[0]) : null;
  return `${brand ? `${brand} watches` : collection.key === 'all' ? 'Watches & quarter zips' : collection.heading} | OLDVERGE`;
};
