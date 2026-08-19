/**
 * Resource interest — Creator Flow v2 **deviation 4**, Session F, 2026-08-20.
 *
 * ═══ A SIGNUP SHEET FOR MATERIAL NOBODY HAS WRITTEN ═════════════════════════
 *
 * §14.1's last line: *"All material lives in one Campaign kit. No separate
 * resource-library or education journey is required."* §30 defers a reusable
 * Affiliate course or resource library by name. The reference draws four tiles
 * whose action is *"We'll email you when it's ready."*
 *
 * What keeps §14.1's sentence true is a SEPARATION, and it is structural rather
 * than a rule this module remembers: 0055's `creator_resource_interest` carries
 * a resource key, a subject, and a timestamp — no asset column, no URL column,
 * no file column, and no campaign id. It cannot become the §31.5 Campaign kit,
 * which is per campaign, access-logged, and revocable. The moment a column here
 * could hold a file the two would be the same thing.
 *
 * ── Nothing chases anybody (§30) ───────────────────────────────────────────
 * No schedule column, no job reads the table, and §27 defines no resource key,
 * so there is no message this could send. What is recorded is interest. Asking
 * twice is the same fact — a unique index makes the second attempt change
 * nothing rather than accumulate rows that would later read as demand.
 */

import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { affiliateSignupProfiles } from '../db/schema/affiliate-signup.js';
import { creatorResourceInterest } from '../db/schema/creator-flow.js';
import { RESOURCE_IDS } from '../creator-flow/logic.js';

export type ResourceResult<T> =
  | ({ ok: true } & T)
  | { ok: false; code: 'not_found' | 'invalid'; message: string };

export interface CreatorResourcesView {
  /** Resource keys this Creator has already asked about. */
  interested: string[];
}

export async function readCreatorResources(
  db: Database,
  userId: string,
): Promise<ResourceResult<{ resources: CreatorResourcesView }>> {
  const [profile] = await db
    .select({ prospectId: affiliateSignupProfiles.prospectId })
    .from(affiliateSignupProfiles)
    .where(eq(affiliateSignupProfiles.claimedUserId, userId))
    .limit(1);
  if (!profile) {
    return { ok: false, code: 'not_found', message: 'There is no Creator profile for this account.' };
  }
  const rows = await db
    .select({ resourceId: creatorResourceInterest.resourceId })
    .from(creatorResourceInterest)
    .where(eq(creatorResourceInterest.prospectId, profile.prospectId));
  return { ok: true, resources: { interested: rows.map((r) => r.resourceId) } };
}

/**
 * Records that a Creator wants one of the four, once.
 *
 * A repeat is not an error and not a second row: the unique index answers, and
 * the service reports success either way — telling somebody their second tap
 * failed would be reporting a constraint as a problem with them.
 */
export async function recordResourceInterest(
  db: Database,
  input: { userId: string; resourceId: string },
): Promise<ResourceResult<{ recorded: boolean }>> {
  if (!(RESOURCE_IDS as readonly string[]).includes(input.resourceId)) {
    return {
      ok: false,
      code: 'invalid',
      message: 'That is not one of the four. Interest in something nobody named is interest nobody can act on.',
    };
  }
  const [profile] = await db
    .select({ prospectId: affiliateSignupProfiles.prospectId })
    .from(affiliateSignupProfiles)
    .where(eq(affiliateSignupProfiles.claimedUserId, input.userId))
    .limit(1);
  if (!profile) {
    return { ok: false, code: 'not_found', message: 'There is no Creator profile for this account.' };
  }

  const inserted = await db
    .insert(creatorResourceInterest)
    .values({ prospectId: profile.prospectId, resourceId: input.resourceId })
    .onConflictDoNothing()
    .returning({ id: creatorResourceInterest.id });

  return { ok: true, recorded: inserted.length > 0 };
}
