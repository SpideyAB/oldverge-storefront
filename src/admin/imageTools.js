// Browser-side image preparation. Drawing the picture onto a canvas and encoding it again produces a fresh WebP file
// with no EXIF, GPS, XMP or other embedded metadata (the upload function rejects any file that still carries some).
import { MAX_IMAGE_SIDE, WEBP_QUALITY, planResize } from './helpers.js';

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];
export const ACCEPT_ATTRIBUTE = ACCEPTED.join(',');
const MAX_SOURCE_BYTES = 40 * 1024 * 1024;

async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    // 'from-image' applies the EXIF orientation before the metadata is dropped, so the result is upright.
    return createImageBitmap(file, { imageOrientation: 'from-image' });
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

const sizeOf = (source) => ({ width: source.naturalWidth || source.width, height: source.naturalHeight || source.height });

/**
 * Re-encodes `file` as WebP with the longest side at most 2000 px.
 * Resolves { blob, width, height, sourceWidth, sourceHeight, sourceBytes, scaled }. Rejects with an Error whose
 * message is safe to show.
 */
export async function reencodeToWebp(file) {
  if (!file || !ACCEPTED.includes(file.type)) throw new Error('Choose a JPEG, PNG or WebP image.');
  if (file.size > MAX_SOURCE_BYTES) throw new Error('That file is larger than 40 MB. Choose a smaller photo.');
  let source;
  try { source = await decode(file); } catch { throw new Error('That image could not be read. It may be damaged.'); }
  const { width: sourceWidth, height: sourceHeight } = sizeOf(source);
  const plan = planResize(sourceWidth, sourceHeight, MAX_IMAGE_SIDE);
  if (!plan.ok) { source.close?.(); throw new Error(plan.reason); }
  const canvas = document.createElement('canvas');
  canvas.width = plan.width;
  canvas.height = plan.height;
  const context = canvas.getContext('2d');
  if (!context) { source.close?.(); throw new Error('This browser cannot process images.'); }
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, 0, 0, plan.width, plan.height);
  source.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', WEBP_QUALITY));
  if (!blob || blob.type !== 'image/webp') throw new Error('This browser cannot create WebP images. Use a current Chrome, Edge, Firefox or Safari.');
  return { blob, width: plan.width, height: plan.height, sourceWidth, sourceHeight, sourceBytes: file.size, scaled: plan.scaled };
}
