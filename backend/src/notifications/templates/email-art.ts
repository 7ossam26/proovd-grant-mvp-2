/**
 * The one absolute URL the invitation emails need for their art.
 *
 * ── Why a PNG when the app ships a WebP ─────────────────────────────────────
 * The two flow screens read `/assets/email-invite.webp` directly. Email cannot:
 * Outlook classic for Windows renders through the Word engine and cannot decode
 * WebP at all, so the very first message a Founder or Creator receives would
 * open on a broken image. `email-invite.png` is the same artwork, already
 * composited onto the `#DEFAFC` band, opaque, and 1024x224 for a 512x112 slot.
 *
 * Compositing rather than laying a transparent PNG over a tinted `<Section>` is
 * deliberate too. A `<Section>` renders as a table, and a background colour on a
 * table cell is exactly where the Word engine is least reliable. Flattening the
 * mat into the raster means the band cannot come apart from the art it mats.
 *
 * ── Why one module ─────────────────────────────────────────────────────────
 * Two templates need this path and both are composed from Admin-authored
 * variables, so a second copy would be a second answer waiting to disagree the
 * next time the file is renamed.
 */

/** Served from `backend/public`, which is where the Dockerfile puts `frontend/dist`. */
export const INVITATION_ART_PATH = '/assets/email-invite.png';

/**
 * Absolute, because a mail client has no origin to resolve a root-relative path
 * against. `appBaseUrl` is `APP_BASE_URL`, which `env.ts` validates as a URL.
 */
export function invitationArtUrl(appBaseUrl: string): string {
  return `${appBaseUrl}${INVITATION_ART_PATH}`;
}
