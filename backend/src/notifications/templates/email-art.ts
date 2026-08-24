/**
 * The absolute URLs invitation emails need for their raster artwork.
 *
 * ── Why a PNG when the app ships a WebP ─────────────────────────────────────
 * The two flow screens read `/assets/email-invite.webp` directly. Email cannot:
 * Outlook classic for Windows renders through the Word engine and cannot decode
 * WebP at all, so the very first message a Founder or Creator receives would
 * open on a broken image. `email-invite-email.png` is the same transparent
 * envelope, rasterized at 1024x224 for the email's 512x112 slot.
 *
 * ── Why one module ─────────────────────────────────────────────────────────
 * Two templates need this path and both are composed from Admin-authored
 * variables, so a second copy would be a second answer waiting to disagree the
 * next time the file is renamed.
 */

/** Served from `backend/public`, which is where the Dockerfile puts `frontend/dist`. */
export const INVITATION_ART_PATH = '/assets/email-invite-email.png';
export const PROOVD_LOGO_PATH = '/assets/proovd-logo.png';

/**
 * Absolute, because a mail client has no origin to resolve a root-relative path
 * against. `appBaseUrl` is `APP_BASE_URL`, which `env.ts` validates as a URL.
 */
export function invitationArtUrl(appBaseUrl: string): string {
  return `${appBaseUrl}${INVITATION_ART_PATH}`;
}

/** PNG rather than SVG so Outlook and other conservative clients render it. */
export function proovdLogoUrl(appBaseUrl: string): string {
  return `${appBaseUrl}${PROOVD_LOGO_PATH}`;
}
