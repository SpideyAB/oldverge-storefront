// Gallery images for a product: the background-removed cut-out first, then the original photograph.
export const originalPhoto = (src) => (src ? src.replace(/-cutout\.webp$/, '.jpg') : src);

export function galleryFor(product) {
  // Backend products carry their approved images (cover first); demo products derive the original photo from the cut-out.
  if (Array.isArray(product.images)) return product.images.map((image) => ({ src: image.src, alt: image.alt }));
  if (!product.image) return [];
  const original = originalPhoto(product.image);
  const images = [{ src: product.image, alt: `${product.name}, product view` }];
  if (original !== product.image) images.push({ src: original, alt: `${product.name}, original photograph` });
  return images;
}
