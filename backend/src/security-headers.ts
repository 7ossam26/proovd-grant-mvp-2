import helmet from 'helmet';
import type { ObjectStorage } from './storage/object-storage.js';

/** Helmet's defaults, plus the exact origin used by direct browser uploads. */
export function createSecurityHeaders(storage: ObjectStorage) {
  const browserUploadOrigin = storage.browserUploadOrigin;

  return helmet({
    contentSecurityPolicy: {
      directives: {
        // Uploads go directly from Fetch to the presigned R2 URL. Without
        // this explicit source, Helmet's default-src 'self' blocks the PUT
        // in the browser before R2's CORS policy can even evaluate it.
        connectSrc: ["'self'", ...(browserUploadOrigin ? [browserUploadOrigin] : [])],
      },
    },
  });
}
