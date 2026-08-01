/**
 * What a stored object actually is — Spec §12's objective checks.
 *
 * §12 rejects "empty files, placeholders". Both are claims about bytes, so both
 * are decided here, from the bytes, after the object is in the bucket. Nothing
 * the browser said about the file is trusted: a declared content type is a
 * request, and a Founder with dev tools can declare anything.
 *
 * ── Why the format is read from magic bytes ─────────────────────────────────
 * An object stored as `image/png` that is really an HTML document is served
 * back to a browser one day. Checking the header is the difference between a
 * campaign page and a stored-XSS surface, and it costs four bytes of
 * comparison. SVG is excluded for the same reason and not as an oversight —
 * it is a script container that browsers execute, and §12 gains nothing from it.
 *
 * ── The placeholder floor is a product fact, not an invented rule ───────────
 * §12 says a placeholder does not qualify and does not define one. The
 * canonical case is a 1×1 pixel. The floor used here is 320 px on the longest
 * edge, which is not a number chosen for this file: 320 px is the narrowest
 * viewport the product is tested at (§33.11), so an image that cannot fill the
 * narrowest screen Proovd supports cannot be a campaign visual. Anything looser
 * would admit the tracking pixel; anything tighter would be a commercial
 * judgement about photography, which is not this module's to make.
 *
 * Video carries no dimension check. A frame size cannot be read from a
 * container header without decoding, and inventing a byte-size floor would be
 * inventing exactly the kind of number §1 rule 6 forbids. An empty or
 * mistyped video is still rejected; a short one is not, and that is honest.
 */

/** The narrowest viewport the product supports (§33.11.1). */
export const MIN_VISUAL_EDGE_PX = 320;

/** What a campaign page can carry. Larger is a browser problem, not a rule. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;
export const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/quicktime'] as const;

export type AllowedContentType =
  | (typeof ALLOWED_IMAGE_TYPES)[number]
  | (typeof ALLOWED_VIDEO_TYPES)[number];

export const ALLOWED_CONTENT_TYPES: readonly string[] = [
  ...ALLOWED_IMAGE_TYPES,
  ...ALLOWED_VIDEO_TYPES,
];

/** A logo has to be an image. A video wordmark is not a thing §12 describes. */
export const ALLOWED_LOGO_TYPES: readonly string[] = [...ALLOWED_IMAGE_TYPES];

export interface MediaFacts {
  /** The type read from the bytes, not the one the browser declared. */
  detectedType: string | null;
  width: number | null;
  height: number | null;
  byteSize: number;
}

/* ── Format detection ─────────────────────────────────────────────────────── */

function isPng(b: Buffer): boolean {
  return (
    b.length >= 8 &&
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47 &&
    b[4] === 0x0d &&
    b[5] === 0x0a &&
    b[6] === 0x1a &&
    b[7] === 0x0a
  );
}

function isJpeg(b: Buffer): boolean {
  return b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
}

function isGif(b: Buffer): boolean {
  return b.length >= 6 && b.subarray(0, 3).toString('latin1') === 'GIF';
}

function isWebp(b: Buffer): boolean {
  return (
    b.length >= 12 &&
    b.subarray(0, 4).toString('latin1') === 'RIFF' &&
    b.subarray(8, 12).toString('latin1') === 'WEBP'
  );
}

/** ISO base media file format — MP4 and QuickTime both carry an `ftyp` box. */
function isoBrand(b: Buffer): string | null {
  if (b.length < 12) return null;
  if (b.subarray(4, 8).toString('latin1') !== 'ftyp') return null;
  return b.subarray(8, 12).toString('latin1');
}

/* ── Dimensions ───────────────────────────────────────────────────────────── */

function pngSize(b: Buffer): { width: number; height: number } | null {
  // IHDR is always the first chunk: 8-byte signature, 4-byte length, "IHDR".
  if (b.length < 24) return null;
  if (b.subarray(12, 16).toString('latin1') !== 'IHDR') return null;
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

function gifSize(b: Buffer): { width: number; height: number } | null {
  if (b.length < 10) return null;
  return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
}

function webpSize(b: Buffer): { width: number; height: number } | null {
  if (b.length < 30) return null;
  const format = b.subarray(12, 16).toString('latin1');
  if (format === 'VP8 ') {
    // Lossy: the 10-byte frame header sits after a 3-byte start code.
    return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  }
  if (format === 'VP8L') {
    const bits = b.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (format === 'VP8X') {
    return {
      width: (b[24]! | (b[25]! << 8) | (b[26]! << 16)) + 1,
      height: (b[27]! | (b[28]! << 8) | (b[29]! << 16)) + 1,
    };
  }
  return null;
}

function jpegSize(b: Buffer): { width: number; height: number } | null {
  // Walk the marker segments to the first start-of-frame. Bounded by the
  // buffer, so a truncated or hostile file terminates rather than loops.
  let offset = 2;
  while (offset + 9 < b.length) {
    if (b[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = b[offset + 1]!;
    // SOF0–SOF3, SOF5–SOF7, SOF9–SOF11, SOF13–SOF15 carry the frame size.
    const isStartOfFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isStartOfFrame) {
      return { height: b.readUInt16BE(offset + 5), width: b.readUInt16BE(offset + 7) };
    }
    const segmentLength = b.readUInt16BE(offset + 2);
    if (segmentLength < 2) return null;
    offset += 2 + segmentLength;
  }
  return null;
}

/**
 * Reads what the object really is. Never throws — a file it cannot parse comes
 * back with `detectedType: null`, which the evidence rules read as unreadable.
 */
export function inspectMedia(body: Buffer): MediaFacts {
  const byteSize = body.byteLength;
  if (byteSize === 0) return { detectedType: null, width: null, height: null, byteSize };

  try {
    if (isPng(body)) {
      const size = pngSize(body);
      return { detectedType: 'image/png', width: size?.width ?? null, height: size?.height ?? null, byteSize };
    }
    if (isJpeg(body)) {
      const size = jpegSize(body);
      return { detectedType: 'image/jpeg', width: size?.width ?? null, height: size?.height ?? null, byteSize };
    }
    if (isGif(body)) {
      const size = gifSize(body);
      return { detectedType: 'image/gif', width: size?.width ?? null, height: size?.height ?? null, byteSize };
    }
    if (isWebp(body)) {
      const size = webpSize(body);
      return { detectedType: 'image/webp', width: size?.width ?? null, height: size?.height ?? null, byteSize };
    }
    const brand = isoBrand(body);
    if (brand) {
      // QuickTime declares `qt  `; everything else in this family is MP4 as far
      // as a campaign page is concerned.
      const detectedType = brand.startsWith('qt') ? 'video/quicktime' : 'video/mp4';
      return { detectedType, width: null, height: null, byteSize };
    }
  } catch {
    // A malformed header is an unreadable file, not a crash.
    return { detectedType: null, width: null, height: null, byteSize };
  }

  return { detectedType: null, width: null, height: null, byteSize };
}

export function isImageType(contentType: string | null): boolean {
  return contentType !== null && (ALLOWED_IMAGE_TYPES as readonly string[]).includes(contentType);
}
