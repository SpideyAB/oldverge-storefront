// Pure mapping from Supabase rows to the product shape the storefront components already use.
// Keeping it free of React, Supabase and browser APIs makes it unit-testable.

export const CATEGORY_LABELS = { watches: 'Watches', 'quarter-zips': 'Quarter-Zips' };
const SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'];

export const storagePublicUrl = (base, bucket, path) =>
  `${base}/storage/v1/object/public/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`;

const sizeRank = (label) => {
  const index = SIZE_ORDER.indexOf(String(label).toUpperCase());
  return index === -1 ? 100 : index;
};

export const PRODUCT_SELECT = `
  id, slug, legacy_id, name, description, kind, style, group_key, sort_order,
  category:categories ( slug, name ),
  brand:brands ( slug, name ),
  product_variants ( id, sku, color_name, color_hex, size_label, price_pkr, active, sort_order ),
  product_images ( bucket, path, kind, alt_text, width, height, sort_order, is_cover, approval_status )
`;

/** availability: { [variantId]: { in_stock: boolean, low_stock: boolean } } (may be empty if unknown). */
export function mapProductRow(row, { storageBase, availability = {} }) {
  const variants = (row.product_variants || [])
    .filter((variant) => variant.active !== false)
    .sort((a, b) => (a.sort_order - b.sort_order) || (sizeRank(a.size_label) - sizeRank(b.size_label)) || String(a.sku).localeCompare(String(b.sku)))
    .map((variant) => ({
      id: variant.id,
      sku: variant.sku,
      color: variant.color_name || null,
      size: variant.size_label || 'One size',
      price: variant.price_pkr,
      hex: variant.color_hex || null,
      inStock: availability[variant.id] ? availability[variant.id].in_stock === true : null,
      lowStock: availability[variant.id] ? availability[variant.id].low_stock === true : false,
    }));

  const images = (row.product_images || [])
    .filter((image) => image.bucket === 'product-public' && image.approval_status === 'approved')
    .sort((a, b) => (b.is_cover - a.is_cover) || (a.sort_order - b.sort_order))
    .map((image) => ({
      src: storagePublicUrl(storageBase, image.bucket, image.path),
      alt: image.alt_text || row.name,
      width: image.width || undefined,
      height: image.height || undefined,
      kind: image.kind,
    }));

  const colors = [...new Set(variants.map((variant) => variant.color).filter(Boolean))];
  const sizes = [...new Set(variants.map((variant) => variant.size))];
  const unavailableSizes = sizes.filter((size) => {
    const ofSize = variants.filter((variant) => variant.size === size);
    return ofSize.length > 0 && ofSize.every((variant) => variant.inStock === false);
  });
  const cover = images[0] || null;
  const photo = images.find((image) => image.kind === 'photo') || null;
  const categorySlug = row.category?.slug;

  return {
    id: row.slug,
    slug: row.slug,
    dbId: row.id,
    legacyId: row.legacy_id || null,
    name: row.name,
    brand: row.brand?.name || 'OLDVERGE',
    category: CATEGORY_LABELS[categorySlug] || row.category?.name || 'Collection',
    type: row.kind,
    price: variants.length ? Math.min(...variants.map((variant) => variant.price)) : 0,
    colors: colors.length ? colors : ['Standard'],
    sizes: sizes.length ? sizes : ['One size'],
    material: '',
    image: cover?.src || '',
    photo: photo?.src || cover?.src || '',
    images,
    artColor: variants.find((variant) => variant.hex)?.hex || undefined,
    style: row.style || '',
    badge: '',
    description: row.description || '',
    groupKey: row.group_key || null,
    variants,
    soldOut: variants.length > 0 && variants.every((variant) => variant.inStock === false),
    unavailableSizes,
  };
}

/** Finds the purchasable variant for the options the customer chose (colour is ignored when a product has one). */
export function variantFor(product, size, color) {
  const variants = product?.variants || [];
  const bySize = variants.filter((variant) => variant.size === (size || variants[0]?.size));
  if (bySize.length <= 1) return bySize[0] || null;
  return bySize.find((variant) => !color || variant.color === color) || null;
}

export function mapSiteImages(rows, storageBase) {
  const out = {};
  (rows || []).forEach((row) => {
    if (row.bucket === 'product-public' && row.approval_status === 'approved') {
      out[row.key] = { src: storagePublicUrl(storageBase, row.bucket, row.path), alt: row.alt_text || '', width: row.width || undefined, height: row.height || undefined };
    }
  });
  return out;
}

export const settingsMap = (rows) => Object.fromEntries((rows || []).map((row) => [row.key, row.value]));
