// Intrinsic pixel sizes of images, so <img> elements can reserve their space before loading.
// Demo mode: the static table below (photos in /public/images). Backend mode: sizes come from the
// product_images / site_images rows and are registered at runtime with registerImageSize().
export const IMAGE_SIZES = {
  '/images/oldverge-hero-model.jpg': [1200, 1500],
  '/images/oldverge-hero-watch-detail.jpg': [1200, 800],
  '/images/oldverge-watch-editorial.jpg': [1200, 675],
  '/images/quarter-zip-beige.jpg': [1200, 1500],
  '/images/quarter-zip-black.jpg': [1200, 1800],
  '/images/quarter-zip-navy.jpg': [1200, 1801],
  '/images/quarter-zip-neutral.jpg': [1200, 1800],
  '/images/quarter-zip-olive.jpg': [1200, 1800],
  '/images/quarter-zip-soft-knit.jpg': [1200, 1749],
  '/images/watch-casio-a168.jpg': [1200, 1200],
  '/images/watch-casio-mtp.jpg': [1200, 792],
  '/images/watch-citizen-eco.jpg': [1200, 800],
  '/images/watch-hero-wrist.jpg': [1200, 800],
  '/images/watch-orient-bambino.jpg': [1200, 1698],
  '/images/watch-seiko-sports.jpg': [1200, 1800],
  '/images/watch-timex-weekender.jpg': [1200, 1600],
  // Background-removed cut-outs (4:5) that sit on the beige product tile.
  '/images/watch-casio-a168-cutout.webp': [960, 1200],
  '/images/watch-casio-mtp-cutout.webp': [960, 1200],
  '/images/watch-timex-weekender-cutout.webp': [960, 1200],
  '/images/watch-seiko-sports-cutout.webp': [960, 1200],
  '/images/watch-citizen-eco-cutout.webp': [960, 1200],
  '/images/watch-orient-bambino-cutout.webp': [960, 1200],
  '/images/quarter-zip-black-cutout.webp': [960, 1200],
  '/images/quarter-zip-beige-cutout.webp': [960, 1200],
  '/images/quarter-zip-navy-cutout.webp': [960, 1200],
  '/images/quarter-zip-olive-cutout.webp': [960, 1200],
  '/images/quarter-zip-soft-knit-cutout.webp': [960, 1200],
};

const runtime = new Map();

export const registerImageSize = (src, width, height) => {
  if (src && width > 0 && height > 0) runtime.set(src, [width, height]);
};

export const imageSize = (src) => {
  const size = runtime.get(src) || IMAGE_SIZES[src];
  return size ? { width: size[0], height: size[1] } : {};
};
