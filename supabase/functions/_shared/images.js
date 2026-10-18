// Server-side image validation for admin uploads. The bucket's allowed_mime_types only checks the declared
// type, so the real content is inspected here: magic bytes, dimensions, embedded metadata and size.
// SVG/HTML and everything else that is not JPEG, PNG or WebP is refused.

import { endpoint, HttpError, rpc } from './endpoint.js';
import { sha256, toHex } from './crypto.js';
import * as v from './validate.js';

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MIN_SIDE = 16;
export const MAX_SIDE = 8000;
const PATH = /^(products|site)\/[a-z0-9]+(-[a-z0-9]+)*(\/v[0-9]{1,4})?\/[a-z0-9][a-z0-9_.-]{0,80}\.(jpg|jpeg|png|webp)$/;

const ascii = (bytes, start, length) => String.fromCharCode(...bytes.subarray(start, start + length));
const u16be = (b, i) => (b[i] << 8) | b[i + 1];
const u32be = (b, i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const u24le = (b, i) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);

/** Returns { type, width, height, hasMetadata } or null when the bytes are not a supported image. */
export function inspectImage(bytes) {
  if (bytes.length < 24) return null;
  // PNG
  if (bytes[0] === 0x89 && ascii(bytes, 1, 3) === 'PNG') {
    const width = u32be(bytes, 16); const height = u32be(bytes, 20);
    let hasMetadata = false;
    let i = 8;
    while (i + 12 <= bytes.length) {
      const length = u32be(bytes, i); const kind = ascii(bytes, i + 4, 4);
      if (kind === 'eXIf' || kind === 'tEXt' || kind === 'iTXt' || kind === 'zTXt') hasMetadata = true;
      if (kind === 'IEND') break;
      i += 12 + length;
    }
    return { type: 'image/png', width, height, hasMetadata };
  }
  // JPEG
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    let i = 2; let size = { width: 0, height: 0 }; let hasMetadata = false;
    while (i + 4 < bytes.length) {
      if (bytes[i] !== 0xff) { i += 1; continue; }
      const marker = bytes[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const length = u16be(bytes, i + 2);
      if (marker === 0xe1 && ascii(bytes, i + 4, 4) === 'Exif') hasMetadata = true;
      if (marker === 0xed || marker === 0xfe) hasMetadata = true;     // Photoshop/IPTC and comment segments
      if ((marker >= 0xc0 && marker <= 0xcf) && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        size = { height: u16be(bytes, i + 5), width: u16be(bytes, i + 7) };
        break;
      }
      i += 2 + length;
    }
    return { type: 'image/jpeg', ...size, hasMetadata };
  }
  // WebP
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    const form = ascii(bytes, 12, 4);
    let dims;
    if (form === 'VP8X') dims = { width: 1 + u24le(bytes, 24), height: 1 + u24le(bytes, 27) };
    else if (form === 'VP8L') {
      const bits = bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24);
      dims = { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
    } else if (form === 'VP8 ') dims = { width: (bytes[26] | (bytes[27] << 8)) & 0x3fff, height: (bytes[28] | (bytes[29] << 8)) & 0x3fff };
    else return null;
    let hasMetadata = false;
    let i = 12;
    while (i + 8 <= bytes.length) {
      const kind = ascii(bytes, i, 4); const size = bytes[i + 4] | (bytes[i + 5] << 8) | (bytes[i + 6] << 16) | (bytes[i + 7] << 24);
      if (kind === 'EXIF' || kind === 'XMP ') hasMetadata = true;
      i += 8 + size + (size % 2);
    }
    return { type: 'image/webp', ...dims, hasMetadata };
  }
  return null;
}

const extensionType = (path) => ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' })[path.split('.').pop()];

/** Throws HttpError for anything unsafe; returns the verified facts about the upload. */
export async function validateUpload(path, declaredType, bytes) {
  if (!PATH.test(path) || path.includes('..')) throw new HttpError(400, { error: 'invalid_path' });
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) throw new HttpError(413, { error: 'payload_too_large' });
  const facts = inspectImage(bytes);
  if (!facts) throw new HttpError(415, { error: 'unsupported_image' });
  if (facts.type !== declaredType || facts.type !== extensionType(path)) throw new HttpError(415, { error: 'type_mismatch' });
  if (facts.width < MIN_SIDE || facts.height < MIN_SIDE || facts.width > MAX_SIDE || facts.height > MAX_SIDE) throw new HttpError(400, { error: 'invalid_dimensions' });
  if (facts.hasMetadata) throw new HttpError(400, { error: 'metadata_not_stripped' });
  return { ...facts, checksum_sha256: toHex(await sha256(bytes)), size: bytes.length };
}

async function readBinary(request, max) {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > max) throw new HttpError(413, { error: 'payload_too_large' });
  const buffer = new Uint8Array(await request.arrayBuffer());
  if (buffer.length > max) throw new HttpError(413, { error: 'payload_too_large' });
  return buffer;
}

/** POST ?path=products/<slug>/v1/<name>.webp  with the raw image as the body. Admin only. */
export const adminUploadImage = (deps) => endpoint({
  name: 'admin-upload-image', deps, rate: { max: 60, windowSeconds: 60 }, auth: 'admin', body: false,
  async run({ request }) {
    const path = new URL(request.url).searchParams.get('path') || '';
    const declared = (request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const bytes = await readBinary(request, MAX_IMAGE_BYTES);
    const facts = await validateUpload(path, declared, bytes);
    const { error } = await deps.admin.storage.from('product-private').upload(path, bytes, { contentType: facts.type, cacheControl: '31536000', upsert: false });
    if (error) throw new HttpError(409, { error: 'upload_failed' });
    return { status: 201, body: { bucket: 'product-private', path, width: facts.width, height: facts.height, checksum_sha256: facts.checksum_sha256, size: facts.size } };
  },
});

/**
 * Publishes an approved image: copies the private object to the public bucket FIRST, then records the approval
 * through the admin RPC as the calling admin. If recording fails the public copy is removed again, so storage and
 * database never disagree about what is public (they are not one transaction, so this is a compensation step).
 */
export const adminApproveImage = (deps) => endpoint({
  name: 'admin-approve-image', deps, rate: { max: 30, windowSeconds: 60 }, auth: 'admin',
  async run({ body, token }) {
    v.rejectUnknown(body, ['image_id']);
    const imageId = v.uuid(body.image_id, 'image_id');
    const user = deps.userClient(token);
    const { data: image, error } = await user.from('product_images').select('id, bucket, path, source_name, licence').eq('id', imageId).maybeSingle();
    if (error || !image) throw new HttpError(404, { error: 'not_found' });
    if (image.bucket !== 'product-private') throw new HttpError(409, { error: 'already_public' });
    const downloaded = await deps.admin.storage.from('product-private').download(image.path);
    if (downloaded.error || !downloaded.data) throw new HttpError(404, { error: 'object_missing' });
    const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
    const facts = inspectImage(bytes);
    if (!facts || facts.hasMetadata) throw new HttpError(400, { error: 'unsupported_image' });
    const up = await deps.admin.storage.from('product-public').upload(image.path, bytes, { contentType: facts.type, cacheControl: '31536000', upsert: false });
    const alreadyThere = up.error && /exists|duplicate/i.test(up.error.message || '');
    if (up.error && !alreadyThere) throw new HttpError(502, { error: 'copy_failed' });
    try {
      await rpc(user, 'admin_approve_image', { p_image_id: imageId, p_public_path: image.path });
    } catch (failure) {
      if (!alreadyThere) await deps.admin.storage.from('product-public').remove([image.path]);
      throw failure;
    }
    return { status: 200, body: { bucket: 'product-public', path: image.path } };
  },
});
