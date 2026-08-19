/**
 * What the walk carries in memory — Creator Flow v2, Session B, 2026-08-19.
 *
 * Two facts, both module-scoped, both deliberately not persisted anywhere.
 *
 * ── The password ────────────────────────────────────────────────────────────
 * Screen 1 asks for it and screen 7's claim is what uses it. In between it has
 * nowhere to live: there is no account yet, so it cannot be sent to the server,
 * and it must not be written to `sessionStorage` or `localStorage` — a
 * credential at rest in the browser survives the tab, is readable by anything
 * running in the page, and outlives the flow it belongs to.
 *
 * So it is held here, in a module variable, for exactly as long as the tab
 * stays on the flow. A React Router navigation does not reload the page, so it
 * survives the six screens between where it is set and where it is used; a
 * RELOAD loses it, and that is correct rather than a gap. What a reload costs
 * is one re-ask at the end and nothing else — every profile answer is saved by
 * §9's autosave as it is typed, so position and content both survive while the
 * one thing that must not be stored does not.
 *
 * Session C's Agree screen asks again when it finds this empty, rather than
 * bouncing somebody back to screen 1: sending a person backwards through six
 * screens they already completed, to re-enter the one thing that was not saved,
 * would be the product punishing them for a reload.
 *
 * `clearDraft()` runs on a successful claim. Nothing else clears it, because
 * nothing else ends the walk.
 *
 * ── Whether the splash has played ───────────────────────────────────────────
 * §30 defers general product tours, and the splash is licensed as part of
 * deviation 1 only while it stays a one-time brand beat. Playing it on every
 * visit to screen 0 — which somebody reaches again by navigating back — would
 * make it a thing that happens repeatedly to hold attention, which is the
 * pattern rather than the exception. Once per token, in memory: a reload plays
 * it again, and that is the honest cost of not storing anything.
 */

let password: string | null = null;
let splashSeenForToken: string | null = null;

/** What screen 1 recorded, or null if the tab has been reloaded since. */
export function draftPassword(): string | null {
  return password;
}

export function setDraftPassword(value: string | null): void {
  password = value === null || value === '' ? null : value;
}

/** True the first time this token's invitation screen is opened in this tab. */
export function shouldPlaySplash(token: string): boolean {
  return splashSeenForToken !== token;
}

export function markSplashSeen(token: string): void {
  splashSeenForToken = token;
}

/** Called by the claim. There is no other way out of the walk. */
export function clearDraft(): void {
  password = null;
  splashSeenForToken = null;
}
