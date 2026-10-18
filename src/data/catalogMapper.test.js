import { describe, expect, it } from 'vitest';
import { mapProductRow, mapSiteImages, settingsMap, storagePublicUrl, variantFor } from './catalogMapper.js';

const BASE = 'https://abcd.supabase.co';
const zipRow = {
  id: 'p1', slug: 'quarter-zip-black', legacy_id: 'quarter-zip-black', name: 'Essential Quarter-Zip — Black', description: 'A layer.', kind: 'clothing', style: 'Everyday', group_key: 'quarter-zip', sort_order: 1,
  category: { slug: 'quarter-zips', name: 'Quarter Zips' }, brand: null,
  product_variants: [
    { id: 'v-m', sku: 'ZIP-M', color_name: 'Black', color_hex: '#262622', size_label: 'M', price_pkr: 8490, active: true, sort_order: 0 },
    { id: 'v-s', sku: 'ZIP-S', color_name: 'Black', color_hex: '#262622', size_label: 'S', price_pkr: 8490, active: true, sort_order: 0 },
    { id: 'v-x', sku: 'ZIP-XL', color_name: 'Black', color_hex: '#262622', size_label: 'XL', price_pkr: 8490, active: false, sort_order: 0 },
  ],
  product_images: [
    { bucket: 'product-public', path: 'products/zip/v1/photo.webp', kind: 'photo', alt_text: 'Photo', width: 1200, height: 1500, sort_order: 1, is_cover: false, approval_status: 'approved' },
    { bucket: 'product-public', path: 'products/zip/v1/cover cut.webp', kind: 'cutout', alt_text: '', width: 960, height: 1200, sort_order: 0, is_cover: true, approval_status: 'approved' },
    { bucket: 'product-private', path: 'draft.webp', kind: 'photo', alt_text: 'x', sort_order: 2, is_cover: false, approval_status: 'unverified' },
  ],
};

describe('mapProductRow', () => {
  it('maps a clothing product into the shape the storefront components use', () => {
    const product = mapProductRow(zipRow, { storageBase: BASE });
    expect(product).toMatchObject({ id: 'quarter-zip-black', slug: 'quarter-zip-black', brand: 'OLDVERGE', category: 'Quarter-Zips', type: 'clothing', price: 8490, colors: ['Black'], artColor: '#262622', groupKey: 'quarter-zip' });
    expect(product.sizes).toEqual(['S', 'M']);                      // inactive XL dropped, sizes in garment order
    expect(product.variants.map((v) => v.sku)).toEqual(['ZIP-S', 'ZIP-M']);
  });

  it('uses only approved public images, cover first, with encoded storage URLs and no private paths', () => {
    const product = mapProductRow(zipRow, { storageBase: BASE });
    expect(product.images).toHaveLength(2);
    expect(product.image).toBe(`${BASE}/storage/v1/object/public/product-public/products/zip/v1/cover%20cut.webp`);
    expect(product.photo).toContain('photo.webp');
    expect(JSON.stringify(product)).not.toContain('draft.webp');
  });

  it('shows no image (not a placeholder) when nothing has been approved', () => {
    const product = mapProductRow({ ...zipRow, product_images: [] }, { storageBase: BASE });
    expect(product.image).toBe('');
    expect(product.images).toEqual([]);
  });

  it('turns availability into sold-out flags without ever exposing counts', () => {
    const none = { 'v-s': { in_stock: false, low_stock: false }, 'v-m': { in_stock: true, low_stock: true } };
    const product = mapProductRow(zipRow, { storageBase: BASE, availability: none });
    expect(product.unavailableSizes).toEqual(['S']);
    expect(product.soldOut).toBe(false);
    expect(product.variants.find((v) => v.id === 'v-m').lowStock).toBe(true);
    const all = mapProductRow(zipRow, { storageBase: BASE, availability: { 'v-s': { in_stock: false }, 'v-m': { in_stock: false } } });
    expect(all.soldOut).toBe(true);
    expect(JSON.stringify(product)).not.toMatch(/on_hand|reserved/);
  });

  it('treats unknown availability as unknown (the server decides at checkout), not as sold out', () => {
    const product = mapProductRow(zipRow, { storageBase: BASE });
    expect(product.soldOut).toBe(false);
    expect(product.variants.every((v) => v.inStock === null)).toBe(true);
  });

  it('falls back to one size and a neutral colour for a watch variant without options', () => {
    const watch = mapProductRow({ ...zipRow, slug: 'casio', kind: 'watch', category: { slug: 'watches', name: 'Watches' }, brand: { slug: 'casio', name: 'Casio' },
      product_variants: [{ id: 'w', sku: 'CASIO-1', color_name: null, size_label: null, price_pkr: 16900, active: true, sort_order: 0 }], product_images: [] }, { storageBase: BASE });
    expect(watch).toMatchObject({ category: 'Watches', brand: 'Casio', sizes: ['One size'], colors: ['Standard'], price: 16900 });
  });
});

describe('variantFor', () => {
  it('picks the variant by size (and colour when a size has several)', () => {
    const product = mapProductRow(zipRow, { storageBase: BASE });
    expect(variantFor(product, 'M', 'Black').id).toBe('v-m');
    expect(variantFor(product, 'XXL', 'Black')).toBeNull();
    expect(variantFor({ variants: [] }, 'M', 'Black')).toBeNull();
  });
});

describe('site helpers', () => {
  it('keeps only approved public site images and builds settings maps', () => {
    const images = mapSiteImages([
      { key: 'hero-model', bucket: 'product-public', path: 'site/hero.webp', approval_status: 'approved', alt_text: 'Hero', width: 10, height: 20 },
      { key: 'draft', bucket: 'product-private', path: 'site/draft.webp', approval_status: 'unverified' },
    ], BASE);
    expect(Object.keys(images)).toEqual(['hero-model']);
    expect(settingsMap([{ key: 'a', value: 1 }, { key: 'b', value: null }])).toEqual({ a: 1, b: null });
    expect(storagePublicUrl(BASE, 'b', 'x y/z.webp')).toBe(`${BASE}/storage/v1/object/public/b/x%20y/z.webp`);
  });
});
