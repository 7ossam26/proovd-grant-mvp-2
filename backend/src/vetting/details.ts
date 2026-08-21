/**
 * Screen 16 — Your details — the record behind it.
 *
 * Founder Flow v2. The reference's `[data-hello]` page collects three things:
 * a name it only ever shows back, a phone number, and a date of birth. All
 * three already have columns — `founder_claim_profiles.legal_name`,
 * `.phone`, `.date_of_birth` — written by §10's account claim since Phase 07.
 *
 * ── Why this is not `correctFounderField` ──────────────────────────────────
 * That service is §5.2's CORRECTION path: it demands a reason, because
 * `editReasonRequired` has made one mandatory on a claimed account since
 * 2026-08-16, and a settings edit is somebody changing a fact already on file.
 * This is the opposite act — the first time the fact is given, inside the
 * onboarding sequence, where there is nothing to explain and no prior value to
 * name. Demanding a reason here would put a "why are you changing this?" box in
 * front of somebody typing their own phone number for the first time.
 *
 * What it keeps from that service, because those parts are not about
 * corrections: the row is read `FOR UPDATE` inside the transaction that changes
 * it (§33.12.4), `updated_by` is the Founder's own actor string so the 0007
 * history trigger files the edit against them rather than against whoever wrote
 * the row last, an anonymised record is refused, and one `audit_events` row is
 * written in the same transaction (§25.6).
 *
 * ── A key absent from the patch writes nothing ─────────────────────────────
 * §9's autosave rule, restated: `undefined` means "not in this request", so
 * saving a phone number cannot blank a date of birth recorded on another visit.
 *
 * ── No age is derived, and none is enforced ────────────────────────────────
 * §10 collects the date and lists the 18+ representation separately, as
 * something the Founder states. Proovd derives no age and never claims to have
 * verified one — the Admin Eligibility tab already renders it that way, and
 * `DateOfBirthField` records the same reasoning. The reference's own desktop
 * Next has no gate either: `helloNext` advances unconditionally. So the only
 * refusals below are about the SHAPE of a date — a value that is not a real
 * calendar day, or one in the future, neither of which is a birthday.
 */

import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { auditEvents } from '../db/schema/integrity.js';
import { founderClaimProfiles } from '../db/schema/vetting.js';

export interface FounderDetailsView {
  /** What the screen shows back. Never editable there — see `DetailsStep`. */
  readonly name: string | null;
  readonly phone: string | null;
  /** `YYYY-MM-DD`, or null. A date, never an age. */
  readonly dateOfBirth: string | null;
}

export interface FounderDetailsPatch {
  readonly phone?: string | null;
  readonly dateOfBirth?: string | null;
}

export type SaveFounderDetailsResult =
  | { ok: true; details: FounderDetailsView }
  | { ok: false; code: 'not_found' | 'refused' | 'invalid'; message: string };

/** `YYYY-MM-DD` that is also a real calendar day, and not in the future. */
function validDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1) return false;
  // The day-count of the month, without constructing a `Date` from the string:
  // `new Date('1990-01-31')` parses as UTC midnight and reads as the 30th in
  // every timezone west of London, which on a birthday is a silent off-by-one.
  const dim = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  if (d > dim) return false;
  const today = new Date();
  const iso =
    today.getFullYear() +
    '-' +
    String(today.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(today.getDate()).padStart(2, '0');
  return value <= iso;
}

function project(row: {
  legalName: string | null;
  preferredName: string | null;
  phone: string | null;
  dateOfBirth: string | null;
}): FounderDetailsView {
  return {
    // The name the reference shows is a display name, so a preferred one wins
    // where there is one. It is shown and never written here: `legal_name` is
    // what Stripe is later given, and §5.2 keeps it on the guarded settings
    // path with its own reason and its own audit row.
    name: row.preferredName?.trim() || row.legalName?.trim() || null,
    phone: row.phone?.trim() || null,
    dateOfBirth: row.dateOfBirth ?? null,
  };
}

export async function readFounderDetails(
  db: Database,
  input: { campaignId: string },
): Promise<FounderDetailsView | null> {
  const [row] = await db
    .select({
      legalName: founderClaimProfiles.legalName,
      preferredName: founderClaimProfiles.preferredName,
      phone: founderClaimProfiles.phone,
      dateOfBirth: founderClaimProfiles.dateOfBirth,
    })
    .from(founderClaimProfiles)
    .where(eq(founderClaimProfiles.campaignId, input.campaignId))
    .limit(1);
  return row ? project(row) : null;
}

export async function saveFounderDetails(
  db: Database,
  input: { campaignId: string; actor: string; patch: FounderDetailsPatch },
): Promise<SaveFounderDetailsResult> {
  const { patch } = input;

  const phone =
    patch.phone === undefined ? undefined : (patch.phone ?? '').trim() || null;
  const dob =
    patch.dateOfBirth === undefined ? undefined : (patch.dateOfBirth ?? '').trim() || null;

  if (dob !== undefined && dob !== null && !validDate(dob)) {
    return {
      ok: false,
      code: 'invalid',
      message: 'That is not a date we can read. Pick it from the calendar and it is saved.',
    };
  }

  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(founderClaimProfiles)
      .where(eq(founderClaimProfiles.campaignId, input.campaignId))
      .for('update')
      .limit(1);

    if (!row) {
      return {
        ok: false as const,
        code: 'not_found' as const,
        message: 'There is no record to save this against.',
      };
    }
    if (row.anonymisedAt) {
      return {
        ok: false as const,
        code: 'refused' as const,
        message:
          'This record was cleared under retention rules. Contact support and a person will pick it up.',
      };
    }

    const next: Record<string, unknown> = {
      updatedBy: input.actor,
      updatedAt: new Date(),
    };
    const prior: Record<string, unknown> = {};
    const wrote: Record<string, unknown> = {};

    if (phone !== undefined && phone !== (row.phone ?? null)) {
      next['phone'] = phone;
      // §9's provenance: the Founder typed it, so the Founder supplied it.
      next['phoneSupplier'] = 'founder';
      next['phoneEditedAt'] = new Date();
      prior['phone'] = row.phone ?? null;
      wrote['phone'] = phone;
    }
    if (dob !== undefined && dob !== (row.dateOfBirth ?? null)) {
      next['dateOfBirth'] = dob;
      next['dateOfBirthSupplier'] = 'founder';
      next['dateOfBirthEditedAt'] = new Date();
      prior['dateOfBirth'] = row.dateOfBirth ?? null;
      wrote['dateOfBirth'] = dob;
    }

    if (Object.keys(wrote).length === 0) {
      return { ok: true as const, details: project(row) };
    }

    await tx.update(founderClaimProfiles).set(next).where(eq(founderClaimProfiles.id, row.id));

    await tx.insert(auditEvents).values({
      actor: input.actor,
      targetType: 'founder_claim_profile',
      targetId: row.id,
      action: 'founder.details_provided',
      internalReason: 'Founder onboarding, your details (screen 16).',
      customerExplanation: null,
      priorValue: prior,
      newValue: wrote,
    });

    const [after] = await tx
      .select({
        legalName: founderClaimProfiles.legalName,
        preferredName: founderClaimProfiles.preferredName,
        phone: founderClaimProfiles.phone,
        dateOfBirth: founderClaimProfiles.dateOfBirth,
      })
      .from(founderClaimProfiles)
      .where(eq(founderClaimProfiles.id, row.id))
      .limit(1);

    return { ok: true as const, details: project(after ?? row) };
  });
}
