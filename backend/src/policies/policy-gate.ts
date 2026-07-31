/**
 * §34 condition 4 — "all canonical policy files are complete and consistent".
 *
 * The live-mode gate has eleven conditions and Phase 24 assembles all of them.
 * This is the one Phase 05 can answer, because Phase 05 is what creates the
 * records it reads: while any row in `policy_versions` is still a draft, the
 * condition is unsatisfied and the gate blocks.
 *
 * It fails closed in the literal sense as well as the logical one. An empty
 * table is not "no drafts, therefore fine" — it is a database that has not been
 * migrated, and a gate that green-lights that is worse than no gate. So a
 * missing document blocks exactly as loudly as a draft one.
 *
 * Phase 06's Admin prerequisites panel renders this. Phase 24 releases it by
 * publishing the documents — never by routing around it.
 */

import { asc } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { policyVersions } from '../db/schema/policies.js';

/** The §31.4 documents that must exist. Mirrors the shared register. */
export const REQUIRED_POLICY_SLUGS = [
  'terms',
  'privacy',
  'cookies',
  'refunds',
  'fulfillment',
  'aup',
  'affiliate-aup',
  'ip-agreement',
] as const;

export interface PolicyGateEntry {
  slug: string;
  route: string;
  title: string;
  version: string;
  status: 'draft' | 'published';
  effectiveDate: string | null;
}

export interface PolicyGateStatus {
  /** True while §34 condition 4 is unsatisfied. */
  blocking: boolean;
  /** Why, in the order Admin should work through it. */
  reasons: string[];
  drafts: PolicyGateEntry[];
  published: PolicyGateEntry[];
  /** Required documents with no record at all — a migration that did not run. */
  missingSlugs: string[];
}

export async function readPolicyGate(db: Database): Promise<PolicyGateStatus> {
  const rows = await db
    .select({
      slug: policyVersions.slug,
      route: policyVersions.route,
      title: policyVersions.title,
      version: policyVersions.version,
      status: policyVersions.status,
      effectiveDate: policyVersions.effectiveDate,
    })
    .from(policyVersions)
    .orderBy(asc(policyVersions.slug), asc(policyVersions.version));

  const drafts = rows.filter((r) => r.status === 'draft');
  const published = rows.filter((r) => r.status === 'published');

  const publishedSlugs = new Set(published.map((r) => r.slug));
  const missingSlugs = REQUIRED_POLICY_SLUGS.filter((slug) => !publishedSlugs.has(slug));

  const reasons: string[] = [];
  if (drafts.length > 0) {
    reasons.push(
      `${drafts.length} policy document(s) still in draft: ${drafts
        .map((d) => d.slug)
        .join(', ')}`,
    );
  }
  const neverRecorded = REQUIRED_POLICY_SLUGS.filter(
    (slug) => !rows.some((r) => r.slug === slug),
  );
  if (neverRecorded.length > 0) {
    reasons.push(`no policy version record exists for: ${neverRecorded.join(', ')}`);
  }

  return {
    blocking: missingSlugs.length > 0,
    reasons,
    drafts,
    published,
    missingSlugs: [...missingSlugs],
  };
}
