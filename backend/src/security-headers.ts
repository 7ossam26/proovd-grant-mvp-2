import helmet from 'helmet';
import type { RequestHandler } from 'express';
import type { ObjectStorage } from './storage/object-storage.js';

const FINAL_FOUNDER_DASHBOARD_PATH = '/founder-dashboard-final.html';

/** Helmet's defaults, plus the exact origin used by direct browser uploads. */
export function createSecurityHeaders(storage: ObjectStorage): RequestHandler {
  const browserUploadOrigin = storage.browserUploadOrigin;
  const connectSrc = ["'self'", ...(browserUploadOrigin ? [browserUploadOrigin] : [])];

  const standardHeaders = helmet({
    contentSecurityPolicy: {
      directives: {
        // Uploads go directly from Fetch to the presigned R2 URL. Without
        // this explicit source, Helmet's default-src 'self' blocks the PUT
        // in the browser before R2's CORS policy can even evaluate it.
        connectSrc,
      },
    },
  });

  // The final dashboard supplied by the project is a standalone HTML document
  // with its CSS, GSAP bundle, and application code embedded inline. Permit
  // those inline blocks only for that exact file; every SPA and API response
  // continues to receive Helmet's stricter default policy above.
  const finalDashboardHeaders = helmet({
    contentSecurityPolicy: {
      directives: {
        connectSrc,
        scriptSrc: ["'self'", "'unsafe-inline'"],
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
      },
    },
  });

  return (req, res, next) => {
    const headers = req.path === FINAL_FOUNDER_DASHBOARD_PATH ? finalDashboardHeaders : standardHeaders;
    headers(req, res, next);
  };
}
