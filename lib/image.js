import { allowedImageUrl } from './catalog.js';

export async function renderThumb(url, width) {
  if (!allowedImageUrl(url)) {
    const err = new Error('Image host is not allowed');
    err.status = 400;
    throw err;
  }
  const w = Math.min(1200, Math.max(64, Number(width) || 440));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'DansBootSaleImage/1.0', Accept: 'image/*,*/*' }
    });
    if (!res.ok) {
      const err = new Error('Image host returned ' + res.status);
      err.status = 502;
      throw err;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 12_000_000) {
      const err = new Error('Image is too large');
      err.status = 413;
      throw err;
    }
    const sharp = (await import('sharp')).default;
    return await sharp(buf, { failOn: 'none', unlimited: true })
      .rotate()
      .resize(w, w, { fit: 'cover', position: 'centre' })
      .webp({ quality: 74 })
      .toBuffer();
  } finally {
    clearTimeout(timer);
  }
}
