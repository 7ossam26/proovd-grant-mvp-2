/**
 * The notification event keys the backend uses at runtime.
 *
 * `shared/src/notifications/registry.ts` is the register — all ~120 keys of
 * §27.3–§27.6, with the audience and the §27 bullet each came from. The backend
 * cannot import it at runtime: `@proovd/shared` exports TypeScript source, the
 * backend compiles under `rootDir: src`, and the production image ships only
 * `backend/dist`. This is the same constraint `db/schema/domain.ts` documents
 * for the state enums and `policies/policy-gate.ts` for the required policy
 * slugs, and the answer is the same one — restate what is needed here, and let
 * a drift test fail the suite if the two ever disagree.
 *
 * What is restated is only the keys phases up to this one actually send. A
 * template arrives with the phase that owns it, so a key appears here when
 * something starts sending it, not before: a key with no sender is a claim that
 * a message exists when it does not (§1.4).
 *
 * `src/tests/founder-invitation.test.ts` asserts every key below exists in the
 * shared register.
 */

/** §27.3 — "Personalized invitation". Sent by `invitations/service.ts`. */
export const FOUNDER_INVITATION = 'founder_invitation' as const;

export const BACKEND_NOTIFICATION_EVENTS = [FOUNDER_INVITATION] as const;

export type NotificationEventKey = (typeof BACKEND_NOTIFICATION_EVENTS)[number];
