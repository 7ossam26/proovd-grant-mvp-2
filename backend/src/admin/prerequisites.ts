/**
 * Production prerequisites — Spec §6, feeding Spec §34.
 *
 * §6: "Admin can also verify that required public routes, policies, support
 * details, sample campaigns, transactional email configuration, Stripe
 * test/live separation, webhook endpoints, tax configuration gates, and pilot
 * feature flags are present. Incomplete prerequisites fail closed."
 *
 * ── Fail closed means blocking ──────────────────────────────────────────────
 * Phase 06's trap says it plainly: an incomplete prerequisite disables the
 * dependent action; it does not render a warning next to an enabled button. So
 * `blocking` is true whenever any item is unsatisfied, every unsatisfied item
 * says what would satisfy it, and the absence of information is never read as
 * good news. A prerequisite nobody has answered is unsatisfied — the same rule
 * the policy gate applies to a missing document.
 *
 * ── Two ways an item can be satisfied ───────────────────────────────────────
 * `automatic`  The app can answer it right now, from the database or from the
 *              validated environment. Nothing is recorded because nothing is
 *              claimed — the check simply re-runs.
 * `recorded`   §34's own language is "recorded as complete", and §1.3's is
 *              "manual work is valid only when the app records it". A human
 *              verifies something the app has no way to observe — that the
 *              sample campaigns mount no payment field, that the tax
 *              registrations exist — and the app stores who checked, when,
 *              what they checked, and the evidence. An unrecorded item blocks
 *              exactly as hard as a failed automatic one.
 *
 * Presenting a `recorded` item as though the system had verified it would be
 * the §1.4 failure — implying automation that does not exist — so the surface
 * labels which is which.
 */

import { desc } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { productionPrerequisites } from '../db/schema/settings.js';
import { readPolicyGate } from '../policies/policy-gate.js';
import { readMissingRequiredSettings } from '../settings/service.js';

export type PrerequisiteVerification = 'automatic' | 'recorded';

export interface PrerequisiteDefinition {
  key: string;
  label: string;
  specRef: string;
  verification: PrerequisiteVerification;
  /** What has to be true. Rendered beside the item, satisfied or not. */
  requirement: string;
}

/**
 * The nine items §6 names, plus the operating constants themselves.
 *
 * The tenth is not an invention: §6 lists roughly thirty settings and then says
 * incomplete prerequisites fail closed. A campaign cannot be approved against a
 * minimum duration nobody has stated, so an unset required setting is precisely
 * an incomplete prerequisite.
 */
export const PREREQUISITE_DEFINITIONS: readonly PrerequisiteDefinition[] = [
  {
    key: 'public_routes',
    label: 'Required public routes',
    specRef: '§6, §18',
    verification: 'recorded',
    requirement:
      'Every route in the §18 public inventory resolves on app.proovd.co, and proovd.co redirects to it for each one except the marketing home.',
  },
  {
    key: 'policies',
    label: 'Canonical policy documents',
    specRef: '§6, §31.4, §34 condition 4',
    verification: 'automatic',
    requirement:
      'All eight §31.4 documents exist as version records and are published. A draft blocks; a missing record blocks harder.',
  },
  {
    key: 'support_details',
    label: 'Support details',
    specRef: '§6, §27.8, §31.4',
    verification: 'recorded',
    requirement:
      'The published contact block, the one-business-day response commitment, and the live-chat staffed hours all match what is actually staffed. Chat that is configured but unstaffed is worse than no chat.',
  },
  {
    key: 'sample_campaigns',
    label: 'Sample campaigns collect nothing',
    specRef: '§6, §34, Appendix A.6',
    verification: 'recorded',
    requirement:
      'Both sample campaigns carry the Appendix A.6 banner and mount no payment field at all — no form, no input, no iframe, no provider script. Disabled is not absent.',
  },
  {
    key: 'transactional_email',
    label: 'Transactional email configuration',
    specRef: '§6, §27.2',
    verification: 'automatic',
    requirement:
      'A sending provider and a From address are configured, so a transactional message has somewhere to go and something to come from.',
  },
  {
    key: 'stripe_key_separation',
    label: 'Stripe test/live separation',
    specRef: '§6, §32.2',
    verification: 'automatic',
    requirement:
      'The configured mode and every key agree. The environment already refuses to boot on a mismatch; this records that it held.',
  },
  {
    key: 'webhook_endpoints',
    label: 'Webhook endpoints',
    specRef: '§6, §32.2',
    verification: 'automatic',
    requirement:
      'Platform and Connect webhook signing secrets are both configured, so signature verification can run on both streams.',
  },
  {
    key: 'tax_configuration',
    label: 'Tax configuration gates',
    specRef: '§6, §24.3, §34',
    verification: 'recorded',
    requirement:
      'Registrations, product codes, seller responsibility, calculation validity and reuse, filing, refund treatment, and the exact consent wording have all been reviewed and configured.',
  },
  {
    key: 'pilot_feature_flags',
    label: 'Pilot feature flags and owners',
    specRef: '§6, §34',
    verification: 'recorded',
    requirement:
      'The first live enablement is one named pilot campaign with a named monitoring owner and a named rollback owner.',
  },
  {
    key: 'operating_constants',
    label: 'Operating constants configured',
    specRef: '§6',
    verification: 'automatic',
    requirement:
      'Every §6 setting has a value. The ones §6 names without fixing a number ship unset on purpose and block until an operator states them.',
  },
];

export interface PrerequisiteAttestation {
  recordedBy: string;
  recordedAt: Date;
  note: string;
  evidenceLinks: unknown;
  status: 'satisfied' | 'not_satisfied';
}

export interface PrerequisiteResult {
  definition: PrerequisiteDefinition;
  satisfied: boolean;
  /** Why it is or is not satisfied, in enough detail to act on. */
  detail: string;
  /**
   * The specific things this item is unsatisfied about — setting keys, policy
   * slugs, webhook streams. Keys, not labels: the Admin surface imports the
   * §6 register and renders the label, so no prose is duplicated server-side.
   */
  subjectKeys: readonly string[];
  /** Present only for `recorded` items that have ever been recorded. */
  attestation: PrerequisiteAttestation | null;
}

export interface PrerequisitePanel {
  /** True while any item is unsatisfied. Dependent actions are disabled. */
  blocking: boolean;
  unsatisfiedKeys: readonly string[];
  items: readonly PrerequisiteResult[];
}

/**
 * The facts the app can observe about its own environment.
 *
 * Passed in rather than read from `process.env` here, so the panel is testable
 * and so `env.ts` stays the one place that decides what a valid environment
 * looks like.
 */
export interface PrerequisiteEnvironment {
  stripeMode: 'test' | 'live';
  /** Both keys carry the prefix that matches `stripeMode`. */
  stripeKeysMatchMode: boolean;
  platformWebhookSecretPresent: boolean;
  connectWebhookSecretPresent: boolean;
  /**
   * The two endpoints carry different signing secrets. Folded into
   * `stripeKeysMatchMode` as well, which is what this panel has read since
   * Phase 06a; carried separately because Phase 24's §34 gate names the
   * specific failure, and "a key has the wrong prefix" and "both endpoints
   * share a secret" are two different things to go and fix.
   */
  webhookSecretsDiffer: boolean;
  /** A sending provider and a From address are both configured. */
  transactionalEmailConfigured: boolean;
}

/**
 * Reads the whole panel.
 *
 * Every automatic check is written so that an error or an absence produces
 * `satisfied: false`. There is no path through this function that returns
 * `blocking: false` because something could not be determined.
 */
export async function readPrerequisites(
  db: Database,
  environment: PrerequisiteEnvironment,
): Promise<PrerequisitePanel> {
  const [attestations, policyGate, missingSettings] = await Promise.all([
    readLatestAttestations(db),
    readPolicyGate(db),
    readMissingRequiredSettings(db),
  ]);

  const items: PrerequisiteResult[] = PREREQUISITE_DEFINITIONS.map((definition) => {
    if (definition.verification === 'recorded') {
      const attestation = attestations.get(definition.key) ?? null;
      return {
        definition,
        satisfied: attestation?.status === 'satisfied',
        detail: attestation
          ? attestation.status === 'satisfied'
            ? `Verified by ${attestation.recordedBy}.`
            : `Recorded as not satisfied by ${attestation.recordedBy}.`
          : 'Not verified yet. A named person has to check this and record what they found.',
        subjectKeys: [],
        attestation,
      };
    }

    switch (definition.key) {
      case 'policies':
        return {
          definition,
          satisfied: !policyGate.blocking && policyGate.drafts.length === 0,
          detail: policyGate.reasons.length
            ? policyGate.reasons.join('; ')
            : 'All eight documents are published.',
          subjectKeys: [
            ...new Set([...policyGate.drafts.map((d) => d.slug), ...policyGate.missingSlugs]),
          ],
          attestation: null,
        };

      case 'transactional_email':
        return {
          definition,
          satisfied: environment.transactionalEmailConfigured,
          detail: environment.transactionalEmailConfigured
            ? 'A sending provider and a From address are configured.'
            : 'No sending provider or From address is configured, so no transactional email can be sent.',
          subjectKeys: [],
          attestation: null,
        };

      case 'stripe_key_separation':
        return {
          definition,
          satisfied: environment.stripeKeysMatchMode,
          detail: environment.stripeKeysMatchMode
            ? `Mode is ${environment.stripeMode} and every key carries the matching prefix.`
            : `Mode is ${environment.stripeMode} but at least one key does not carry the matching prefix.`,
          subjectKeys: [],
          attestation: null,
        };

      case 'webhook_endpoints': {
        const absent = [
          environment.platformWebhookSecretPresent ? null : 'platform',
          environment.connectWebhookSecretPresent ? null : 'connect',
        ].filter((v): v is string => v !== null);
        return {
          definition,
          satisfied: absent.length === 0,
          detail:
            absent.length === 0
              ? 'Platform and Connect signing secrets are both configured.'
              : `No signing secret configured for: ${absent.join(', ')}. Signature verification cannot run on that stream.`,
          subjectKeys: absent,
          attestation: null,
        };
      }

      case 'operating_constants':
        return {
          definition,
          satisfied: missingSettings.length === 0,
          detail:
            missingSettings.length === 0
              ? 'Every §6 setting has a value.'
              : `${missingSettings.length} setting(s) have no value yet. §6 names these and fixes no number, so they ship unset and block until someone states one.`,
          subjectKeys: missingSettings,
          attestation: null,
        };

      default:
        // An automatic definition with no implementation is a gate that would
        // silently pass. Fail it instead, and name the omission.
        return {
          definition,
          satisfied: false,
          detail: `No check is implemented for "${definition.key}". An unimplemented gate blocks.`,
          subjectKeys: [],
          attestation: null,
        };
    }
  });

  const unsatisfiedKeys = items.filter((i) => !i.satisfied).map((i) => i.definition.key);

  return {
    blocking: unsatisfiedKeys.length > 0,
    unsatisfiedKeys,
    items,
  };
}

/** The most recent row per prerequisite key. Nothing is ever edited in place. */
async function readLatestAttestations(
  db: Database,
): Promise<Map<string, PrerequisiteAttestation>> {
  const rows = await db
    .select({
      prerequisiteKey: productionPrerequisites.prerequisiteKey,
      status: productionPrerequisites.status,
      recordedBy: productionPrerequisites.recordedBy,
      recordedAt: productionPrerequisites.recordedAt,
      note: productionPrerequisites.note,
      evidenceLinks: productionPrerequisites.evidenceLinks,
    })
    .from(productionPrerequisites)
    .orderBy(desc(productionPrerequisites.recordedAt));

  const latest = new Map<string, PrerequisiteAttestation>();
  for (const row of rows) {
    if (latest.has(row.prerequisiteKey)) continue;
    latest.set(row.prerequisiteKey, {
      recordedBy: row.recordedBy,
      recordedAt: row.recordedAt,
      note: row.note,
      evidenceLinks: row.evidenceLinks,
      status: row.status,
    });
  }
  return latest;
}

export interface RecordPrerequisiteInput {
  prerequisiteKey: string;
  status: 'satisfied' | 'not_satisfied';
  /** The named person. §34: "recorded as complete", by someone. */
  recordedBy: string;
  note: string;
  evidenceLinks?: readonly string[];
}

export type RecordPrerequisiteResult =
  | { ok: true }
  | { ok: false; message: string };

/**
 * Records one attestation. Insert-only — a re-check is a new row, and
 * withdrawing one is a new row saying so.
 *
 * A `recorded` item demands a note. "Checked" is not a note; the point of the
 * record is that a different person can re-run the same check next quarter.
 */
export async function recordPrerequisite(
  db: Database,
  input: RecordPrerequisiteInput,
): Promise<RecordPrerequisiteResult> {
  const definition = PREREQUISITE_DEFINITIONS.find((d) => d.key === input.prerequisiteKey);
  if (!definition) {
    return { ok: false, message: 'That prerequisite does not exist.' };
  }
  if (definition.verification !== 'recorded') {
    return {
      ok: false,
      message:
        'This prerequisite is checked by the system on every load. Recording a human answer over it would let an attestation outlive the fact it describes.',
    };
  }
  if (!input.note.trim()) {
    return {
      ok: false,
      message: 'Say what you checked, so someone else can check the same thing later.',
    };
  }

  await db.insert(productionPrerequisites).values({
    prerequisiteKey: input.prerequisiteKey,
    status: input.status,
    recordedBy: input.recordedBy,
    note: input.note.trim(),
    evidenceLinks: input.evidenceLinks ? [...input.evidenceLinks] : null,
  });

  return { ok: true };
}
