import { categoryLabel } from '../data/collections.js';
import { getProducts } from '../data/catalog.js';

// Matches every word of the query against the product's own data (name, brand, category, style, colours, description).
const haystack = (product) => [product.name, product.brand, product.category, categoryLabel(product.category), product.style, product.colors.join(' '), product.description]
  .filter(Boolean).join(' ').toLowerCase();

export const matchesQuery = (product, query) => {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const text = haystack(product);
  return words.every((word) => text.includes(word));
};

export const searchProducts = (query, list = getProducts()) => list.filter((product) => matchesQuery(product, query));
