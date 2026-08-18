/**
 * Secure token service — Founder draft links and Backer magic links.
 *
 * Implements Spec §28.1 in one place so the two surfaces cannot drift apart.
 * Read `backend/src/db/schema/tokens.ts` first for the storage contract and for
 * why this is not Better Auth.
 *
 * ── The single most important rule in this file ─────────────────────────────
 * Every failure path returns the SAME shape. Invalid, expired, revoked,
 * claimed, malformed, rate-limited, and never-existed are indistinguishable to
 * the caller. Spec §5.5: invalid links "expose no account existence or PII".
 * §33.1.2 tests token alteration, cross-Founder access, replay, expiration,
 * revoke, resend, and simultaneous claim all failing safely.
 *
 * A helpful error message here is a user-enumeration vulnerability.
 */

import {
  randomBytes,
  createHash,
  createHmac,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { and, desc, eq, isNull, lte, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { secureTokens, type SecureToken } from '../db/schema/tokens.js';
import {
  EMAIL_CODE_LENGTH,
  isCodeShaped,
  EMAIL_CODE_MAX_ATTEMPTS,
  EMAIL_CODE_TTL_MINUTES,
} from '../vetting/email-code-logic.js';

/* ── Configuration ────────────────────────────────────────────────────────── */

/**
 * 32 bytes = 256 bits, comfortably above the §28.1 minimum of 128. base64url
 * keeps it URL-safe with no percent-encoding, which matters because these
 * values are pasted into emails and clicked from mail clients that mangle
 * escaped characters.
 */
const TOKEN_BYTES = 32;

/** Spec §7 — unclaimed draft retention, from the most recent send. */
export const DRAFT_TTL_DAYS = 30;

/** Spec §19 — magic-link validity past final resolution. */
export const MAGIC_LINK_GRACE_DAYS = 180;

/**
 * Verification attempts tolerated against one token before it is locked.
 * Deliberately low: a legitimate holder clicks a working link, so repeated
 * failures against a single hash are an attack, not a typo.
 */
const MAX_FAILED_ATTEMPTS = 10;

/* ── Result types ─────────────────────────────────────────────────────────── */

/**
 * The only failure value this module ever produces. It carries no reason,
 * because the caller must not be able to branch on one — and because a
 * developer who can branch on it will eventually surface it to a user.
 *
 * The real reason is written to the audit log inside this module.
 */
export const TOKEN_INVALID = 'token_invalid' as const;
export type TokenInvalid = typeof TOKEN_INVALID;

export type VerifyResult<T> =
  | { ok: true; token: SecureToken; subject: T }
  | { ok: false; error: TokenInvalid };

export interface IssuedToken {
  /** The raw value. Interpolate into the URL, then let it go out of scope. */
  raw: string;
  record: SecureToken;
}

export interface DraftSubject {
  scope: 'founder_draft';
  campaignDraftId: string;
}

export interface MagicLinkSubject {
  scope: 'backer_magic_link';
  campaignId: string;
  backerIdentityId: string;
}

/**
 * Spec §8, §11, §33.2.1 — the private campaign-specific Affiliate invitation.
 *
 * Bound to ONE association, which is one (campaign, prospect) pair. §33.2.1:
 * "an invitation claims only that Affiliate's account/association." A Creator
 * recruited to two campaigns holds two associations and receives two
 * invitations; there is no field here that could carry a second campaign, and
 * the scope-binding CHECK (migration 0009) refuses a row that tried.
 */
export interface AffiliateInvitationSubject {
  scope: 'affiliate_invitation';
  associationId: string;
}

/**
 * ONE follow record's confirm or unfollow link (campaign-page-v2 Session C —
 * a recorded §1 rule 6 deviation; see `db/schema/followers.ts`).
 *
 * ── Two lineages, one scope, and how they are told apart ───────────────────
 * The CONFIRM link is single-use, so it is claimed. The UNFOLLOW link must
 * keep working for the life of the record — and `verify` rejects a claimed
 * token, while `secure_tokens_one_live_per_lineage` is keyed on
 * `revoked_at IS NULL AND claimed_at IS NULL` — so it is a second lineage that
 * is never claimed and is revoked only when the follow ends.
 *
 * Sharing a scope means either link would verify at either route, and that is
 * not harmless: opening the unfollow link at the confirm route would CLAIM the
 * unfollow lineage and leave the person with a dead unsubscribe link in their
 * inbox. They are separated by a property each lineage genuinely has rather
 * than by a flag — `expiresAt`. A confirmation link that still works a year
 * later is a consent somebody else can grant from a forwarded email, so the
 * confirm lineage expires; an unfollow link that expires is an opt-out with a
 * deadline, so it never does. `followTokenPurpose` is the one reader.
 */
export interface CampaignFollowSubject {
  scope: 'campaign_follow';
  campaignFollowerId: string;
}

export type TokenSubject =
  | DraftSubject
  | MagicLinkSubject
  | AffiliateInvitationSubject
  | CampaignFollowSubject
  | FounderEmailCodeSubject;

/** How long a follow confirmation link stays openable (§25.8 window 5 covers
 *  the hash; this is the consent's own freshness). */
export const FOLLOW_CONFIRM_TTL_DAYS = 14;

/**
 * Which of the two `campaign_follow` lineages a verified token belongs to.
 *
 * Derived, never stored: an expiry is what actually differs, and a stored flag
 * could disagree with the token's real lifetime.
 */
export function followTokenPurpose(token: {
  expiresAt: Date | null;
}): 'confirm' | 'unfollow' {
  return token.expiresAt === null ? 'unfollow' : 'confirm';
}

/* ── The Founder's six-digit email code ───────────────────────────────────── */

/**
 * ONE invited draft's email verification code (Founder Flow v2 Session C — a
 * recorded §1 rule 6 deviation; see `shared/src/vetting/email-code.ts`).
 *
 * It rides this table rather than a second store because everything a
 * six-digit secret needs is already here: the lineage model, single-use
 * `claimed_at`, an absolute `expires_at`, the revocation reasons, the
 * immutability trigger, and `failed_attempts` — which is the one that turns
 * 10^6 possible values into a secret rather than a puzzle.
 *
 * `verify()` can never return this subject in practice, twice over: no route
 * passes `'founder_email_code'` as an expected scope, and a six-character raw
 * value is rejected by that function's own length guard before it reaches the
 * database. `verifyFounderEmailCode` is the only reader, and it does not share
 * a hash function with `verify` — see `codeHash`.
 */
export interface FounderEmailCodeSubject {
  scope: 'founder_email_code';
  campaignDraftId: string;
}

/**
 * The hash stored for a code, and it is not `hashToken`.
 *
 * `secure_tokens_hash_idx` is UNIQUE on `token_hash`. A plain SHA-256 over six
 * digits has 10^6 possible digests: two live codes would collide on that index
 * — so the second Founder to be sent `418306` would get a constraint violation
 * — and the digest itself is a rainbow table one row wide, so a leaked backup
 * would hand over every live code.
 *
 * An HMAC keyed on `BETTER_AUTH_SECRET` fixes both, and binding the draft and
 * the address INTO it buys a third thing: a code minted for one draft cannot
 * verify another, and a code minted for one address stops working the moment
 * the Founder changes it. That is the same construction
 * `backend/src/interviews/reference.ts` uses to bind a Cal.com booking, and the
 * label is what keeps the two from ever being the same value.
 */
function codeHash(secret: string, draftId: string, email: string, code: string): string {
  return createHmac('sha256', secret)
    .update(`proovd:founder-email-code:v1|${draftId}|${email.trim().toLowerCase()}|${code}`)
    .digest('hex');
}

/**
 * Six uniformly random digits.
 *
 * `randomInt` rejects out-of-range draws internally, so there is no modulo
 * bias — and bias matters here in a way it does not for a 256-bit token,
 * because a skewed distribution over 10^6 shortens a guessing attack by
 * exactly as much as it skews.
 */
function generateCode(): string {
  return String(randomInt(0, 10 ** EMAIL_CODE_LENGTH)).padStart(EMAIL_CODE_LENGTH, '0');
}

/* ── Primitives ───────────────────────────────────────────────────────────── */

function generateRawToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

function hashToken(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

/**
 * Constant-time comparison of two hex digests.
 *
 * The database lookup is already by exact hash, so in practice the index probe
 * settles the question. This exists for the defence-in-depth case where a
 * candidate row is compared in application code — and because §28.1 names it
 * explicitly. `timingSafeEqual` throws on length mismatch, so guard first.
 */
export function safeCompareHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

/* ── Service ──────────────────────────────────────────────────────────────── */

export interface TokenServiceDeps {
  db: NodePgDatabase<Record<string, unknown>>;
  /**
   * Writes to the immutable audit table (Spec §25.6). Every issue, rotate,
   * revoke, claim, and failed verification is recorded here — this is where
   * the real reason for a rejection lives, since the caller never sees it.
   */
  audit: (event: {
    action: string;
    targetType: 'secure_token';
    targetId: string | null;
    internalReason: string;
    priorValue?: unknown;
    newValue?: unknown;
    actorId?: string | null;
  }) => Promise<void>;
  /**
   * `BETTER_AUTH_SECRET`. Keys the HMAC that stores a six-digit email code
   * (see `codeHash`) and nothing else — the other four scopes hold a plain
   * SHA-256 of a 256-bit value, which needs no key.
   */
  secret: string;
  now?: () => Date;
}

export function createTokenService({
  db,
  audit,
  secret,
  now = () => new Date(),
}: TokenServiceDeps) {
  /**
   * Issues a brand-new token and its lineage.
   *
   * The raw value is returned exactly once and is never recoverable. If an
   * email fails to send, rotate and issue a fresh one — do not attempt to
   * reconstruct the old value.
   */
  async function issue(
    subject: TokenSubject,
    opts: { expiresAt?: Date | null; actorId?: string | null } = {},
  ): Promise<IssuedToken> {
    const raw = generateRawToken();
    const tokenHash = hashToken(raw);
    const lineageId = randomUUID();

    const expiresAt =
      opts.expiresAt !== undefined
        ? opts.expiresAt
        : // §8 gives the Affiliate invitation the same finite life as the
          // Founder draft: it is a private link to a signup that either happens
          // or is resent. Only magic links have no stamp at issue time, because
          // §19 derives their expiry from campaign resolution + 180 days.
          subject.scope === 'founder_draft' || subject.scope === 'affiliate_invitation'
          ? new Date(now().getTime() + DRAFT_TTL_DAYS * 86_400_000)
          : // A follow CONFIRM link expires and an UNFOLLOW link does not, and
            // that difference is the only thing distinguishing the two
            // lineages of this scope (see `followTokenPurpose`). The caller
            // passes `expiresAt: null` explicitly for the unfollow lineage,
            // which lands in the `!== undefined` branch above.
            subject.scope === 'campaign_follow'
            ? new Date(now().getTime() + FOLLOW_CONFIRM_TTL_DAYS * 86_400_000)
            : null;

    const [record] = await db
      .insert(secureTokens)
      .values({
        scope: subject.scope,
        tokenHash,
        version: 1,
        lineageId,
        expiresAt,
        campaignDraftId:
          subject.scope === 'founder_draft' ? subject.campaignDraftId : null,
        campaignId: subject.scope === 'backer_magic_link' ? subject.campaignId : null,
        backerIdentityId:
          subject.scope === 'backer_magic_link' ? subject.backerIdentityId : null,
        associationId:
          subject.scope === 'affiliate_invitation' ? subject.associationId : null,
        campaignFollowerId:
          subject.scope === 'campaign_follow' ? subject.campaignFollowerId : null,
      })
      .returning();

    await audit({
      action: 'token.issued',
      targetType: 'secure_token',
      targetId: record.id,
      internalReason: `issued ${subject.scope} v1`,
      newValue: { scope: subject.scope, version: 1, expiresAt },
      actorId: opts.actorId ?? null,
    });

    return { raw, record };
  }

  /**
   * Rotates a lineage: revokes every live token in it, then issues version n+1.
   *
   * Spec §7: "Resend rotates the token, invalidates all older versions
   * immediately, and restarts the 30-day unclaimed-draft retention period."
   *
   * Runs in one transaction. The partial unique index on the table
   * (`secure_tokens_one_live_per_lineage`) makes a half-completed rotation
   * impossible to commit — revocation must land before the insert.
   */
  async function rotate(
    lineageId: string,
    opts: { actorId?: string | null } = {},
  ): Promise<IssuedToken | { ok: false; error: TokenInvalid }> {
    return db.transaction(async (tx) => {
      const live = await tx
        .select()
        .from(secureTokens)
        .where(and(eq(secureTokens.lineageId, lineageId), isNull(secureTokens.revokedAt)))
        .for('update');

      if (live.length === 0) {
        return { ok: false as const, error: TOKEN_INVALID };
      }

      const previous = live.reduce((a, b) => (a.version >= b.version ? a : b));

      await tx
        .update(secureTokens)
        .set({ revokedAt: now(), revokedReason: 'superseded_by_rotation' })
        .where(and(eq(secureTokens.lineageId, lineageId), isNull(secureTokens.revokedAt)));

      const raw = generateRawToken();
      const nextVersion = previous.version + 1;

      const expiresAt =
        previous.scope === 'founder_draft' || previous.scope === 'affiliate_invitation'
          ? new Date(now().getTime() + DRAFT_TTL_DAYS * 86_400_000)
          : previous.expiresAt;

      const [record] = await tx
        .insert(secureTokens)
        .values({
          scope: previous.scope,
          tokenHash: hashToken(raw),
          version: nextVersion,
          lineageId,
          supersedesTokenId: previous.id,
          expiresAt,
          campaignDraftId: previous.campaignDraftId,
          campaignId: previous.campaignId,
          backerIdentityId: previous.backerIdentityId,
          // Carried, not recomputed. A rotation that could re-point a token at
          // a different association would be a resend that silently moved which
          // Creator the link belongs to.
          associationId: previous.associationId,
        })
        .returning();

      await audit({
        action: 'token.rotated',
        targetType: 'secure_token',
        targetId: record.id,
        internalReason: `rotated ${previous.scope} v${previous.version} → v${nextVersion}`,
        priorValue: { tokenId: previous.id, version: previous.version },
        newValue: { tokenId: record.id, version: nextVersion, expiresAt },
        actorId: opts.actorId ?? null,
      });

      return { raw, record };
    });
  }

  /* ── The Founder's six-digit email code (Founder Flow v2, Session C) ───── */

  /**
   * Mints a code for one draft and one address, superseding any live one.
   *
   * A resend keeps the lineage and takes the next version, which is `rotate`'s
   * own shape — so the previous code stops working the moment a new one is
   * sent (§7's resend rule: "invalidates all older versions immediately"). It
   * is not `rotate` itself only because the hash differs; everything else
   * about the two is the same, including the partial unique index that makes a
   * half-completed supersession impossible to commit.
   *
   * The raw code is returned exactly once and is never recoverable. Nothing
   * writes it to a log, an audit row, or a response — the audit row below
   * records that a code was issued and to which draft, and stops there.
   */
  async function issueFounderEmailCode(
    campaignDraftId: string,
    email: string,
  ): Promise<{ code: string; record: SecureToken }> {
    const code = generateCode();
    const expiresAt = new Date(now().getTime() + EMAIL_CODE_TTL_MINUTES * 60_000);

    return db.transaction(async (tx) => {
      const live = await tx
        .select()
        .from(secureTokens)
        .where(
          and(
            eq(secureTokens.scope, 'founder_email_code'),
            eq(secureTokens.campaignDraftId, campaignDraftId),
            isNull(secureTokens.revokedAt),
          ),
        )
        .for('update');

      const previous = live.length
        ? live.reduce((a, b) => (a.version >= b.version ? a : b))
        : null;

      if (previous) {
        await tx
          .update(secureTokens)
          .set({ revokedAt: now(), revokedReason: 'superseded_by_rotation' })
          .where(
            and(
              eq(secureTokens.scope, 'founder_email_code'),
              eq(secureTokens.campaignDraftId, campaignDraftId),
              isNull(secureTokens.revokedAt),
            ),
          );
      }

      const [record] = await tx
        .insert(secureTokens)
        .values({
          scope: 'founder_email_code',
          tokenHash: codeHash(secret, campaignDraftId, email, code),
          version: previous ? previous.version + 1 : 1,
          lineageId: previous ? previous.lineageId : randomUUID(),
          supersedesTokenId: previous ? previous.id : null,
          expiresAt,
          campaignDraftId,
        })
        .returning();

      await audit({
        action: 'token.issued',
        targetType: 'secure_token',
        targetId: record.id,
        internalReason: `issued founder_email_code v${record.version}`,
        // Deliberately no code, and no address either: the address is on the
        // claim profile, which is where support looks, and copying it into an
        // insert-only table would put a second permanent copy of a personal
        // fact somewhere §25.8's sweep cannot reach.
        newValue: { scope: 'founder_email_code', version: record.version, expiresAt },
      });

      return { code, record };
    });
  }

  /**
   * Checks a submitted code against the live one for this draft and address.
   *
   * ── Why the lookup is by DRAFT and not by hash ──────────────────────────
   * The obvious implementation hashes the submitted code and looks the digest
   * up, which is what `verify` does for a 43-character token. It cannot work
   * here: a wrong code hashes to nothing, so there is no row to count the
   * attempt against — and the attempt counter is the entire reason a six-digit
   * secret is a secret. So the live row is found by draft, and the comparison
   * is `safeCompareHex` in application code, which is the defence-in-depth
   * case §28.1 names by hand.
   *
   * Every rejection returns the same value and the route renders the same body
   * (§5.5). Wrong, expired, already-used, locked-out, never-requested, and
   * "requested for a different address" are one answer.
   */
  async function verifyFounderEmailCode(input: {
    campaignDraftId: string;
    email: string;
    code: string;
  }): Promise<VerifyResult<FounderEmailCodeSubject>> {
    const reject = async (reason: string, id: string | null) => {
      await audit({
        action: 'token.verify_failed',
        targetType: 'secure_token',
        targetId: id,
        internalReason: `founder_email_code: ${reason}`,
      });
      return { ok: false as const, error: TOKEN_INVALID };
    };

    if (!isCodeShaped(input.code)) return reject('malformed code', null);

    const [row] = await db
      .select()
      .from(secureTokens)
      .where(
        and(
          eq(secureTokens.scope, 'founder_email_code'),
          eq(secureTokens.campaignDraftId, input.campaignDraftId),
          isNull(secureTokens.revokedAt),
          isNull(secureTokens.claimedAt),
        ),
      )
      .orderBy(desc(secureTokens.version))
      .limit(1);

    if (!row) return reject('no live code for this draft', null);
    if (row.expiresAt && row.expiresAt <= now()) return reject('expired', row.id);
    if (row.failedAttempts >= EMAIL_CODE_MAX_ATTEMPTS) {
      return reject('attempt limit exceeded', row.id);
    }

    const expected = codeHash(secret, input.campaignDraftId, input.email, input.code);
    if (!safeCompareHex(row.tokenHash, expected)) {
      // The counter lives on the row rather than in a limiter, so it survives a
      // restart and cannot be reset by changing address or IP. Six wrong
      // guesses and this code is finished; asking for a new one is the only
      // way forward, which is what makes 10^6 large enough.
      await db
        .update(secureTokens)
        .set({ failedAttempts: sql`${secureTokens.failedAttempts} + 1` })
        .where(eq(secureTokens.id, row.id));
      return reject('code mismatch', row.id);
    }

    // Single-use, settled by the database rather than by this function: two
    // tabs submitting the same correct code at once produce one success and
    // one ordinary rejection. `claimDraft`'s mechanism, and its reasoning.
    const claimed = await db
      .update(secureTokens)
      .set({
        claimedAt: now(),
        revokedAt: now(),
        revokedReason: 'claimed',
        lastUsedAt: now(),
        firstUsedAt: sql`coalesce(${secureTokens.firstUsedAt}, ${now()})`,
        failedAttempts: 0,
      })
      .where(
        and(
          eq(secureTokens.id, row.id),
          isNull(secureTokens.claimedAt),
          isNull(secureTokens.revokedAt),
        ),
      )
      .returning({ id: secureTokens.id });

    if (claimed.length !== 1) return reject('concurrent or repeat use', row.id);

    await audit({
      action: 'token.claimed',
      targetType: 'secure_token',
      targetId: row.id,
      internalReason: 'founder_email_code verified',
    });

    return {
      ok: true,
      token: row,
      subject: { scope: 'founder_email_code', campaignDraftId: input.campaignDraftId },
    };
  }

  /**
   * Verifies a raw token and returns its scoped subject.
   *
   * Every rejection returns `{ ok: false, error: TOKEN_INVALID }`. Do not add
   * a reason field. Do not log the raw token. Do not vary the HTTP status by
   * failure mode — the route should render the same "this link can't be used"
   * surface with a context-preserving support route (Spec §5.5) in all cases.
   */
  async function verify(
    raw: string,
    expectedScope: TokenSubject['scope'],
  ): Promise<VerifyResult<TokenSubject>> {
    // Reject obviously malformed input before touching the database, so a
    // flood of junk can't turn verification into a query amplifier.
    if (typeof raw !== 'string' || raw.length < 32 || raw.length > 256) {
      return { ok: false, error: TOKEN_INVALID };
    }

    const tokenHash = hashToken(raw);

    const [row] = await db
      .select()
      .from(secureTokens)
      .where(eq(secureTokens.tokenHash, tokenHash))
      .limit(1);

    const reject = async (reason: string, id: string | null) => {
      if (id) {
        await db
          .update(secureTokens)
          .set({ failedAttempts: sql`${secureTokens.failedAttempts} + 1` })
          .where(eq(secureTokens.id, id));
      }
      await audit({
        action: 'token.verify_failed',
        targetType: 'secure_token',
        targetId: id,
        internalReason: reason,
      });
      return { ok: false as const, error: TOKEN_INVALID };
    };

    if (!row) return reject('no matching hash', null);
    if (!safeCompareHex(row.tokenHash, tokenHash)) {
      return reject('hash mismatch after lookup', row.id);
    }
    if (row.scope !== expectedScope) {
      // A draft token presented at a magic-link route, or vice versa. Spec §7:
      // a token grants no access outside its scope.
      return reject(`scope mismatch: ${row.scope} presented as ${expectedScope}`, row.id);
    }
    if (row.revokedAt) return reject(`revoked: ${row.revokedReason}`, row.id);
    if (row.claimedAt) return reject('already claimed', row.id);
    if (row.expiresAt && row.expiresAt <= now()) return reject('expired', row.id);
    if (row.failedAttempts >= MAX_FAILED_ATTEMPTS) {
      return reject('attempt limit exceeded', row.id);
    }

    // `first_used_at` is set only while it is still null (§31.9, Phase 23b) —
    // the SQL CASE rather than a read-then-write, so two concurrent
    // verifications cannot both see null and both write. The trigger would
    // refuse the second anyway; this keeps it from being an error path.
    await db
      .update(secureTokens)
      .set({
        lastUsedAt: now(),
        firstUsedAt: sql`coalesce(${secureTokens.firstUsedAt}, ${now()})`,
        failedAttempts: 0,
      })
      .where(eq(secureTokens.id, row.id));

    const subject: TokenSubject =
      row.scope === 'founder_draft'
        ? { scope: 'founder_draft', campaignDraftId: row.campaignDraftId! }
        : // Unreachable in practice, and by two independent mechanisms: no route
          // passes this as an expected scope, and a six-character raw value is
          // rejected by the length guard at the top of this function long
          // before the lookup. It is here because the union is total, and a
          // total union is what makes a sixth scope a compile error rather
          // than a silent `backer_magic_link` in the fall-through.
          row.scope === 'founder_email_code'
          ? { scope: 'founder_email_code', campaignDraftId: row.campaignDraftId! }
          : row.scope === 'affiliate_invitation'
          ? { scope: 'affiliate_invitation', associationId: row.associationId! }
          : row.scope === 'campaign_follow'
            ? { scope: 'campaign_follow', campaignFollowerId: row.campaignFollowerId! }
            : {
                scope: 'backer_magic_link',
                campaignId: row.campaignId!,
                backerIdentityId: row.backerIdentityId!,
              };

    return { ok: true, token: row, subject };
  }

  /**
   * Atomically claims a draft token. Spec §7: "Two concurrent claims yield one
   * account and one failed safe response."
   *
   * The conditional UPDATE is the whole mechanism — the second caller's WHERE
   * clause matches zero rows and it gets the standard rejection. Do not
   * reimplement this as select-then-update.
   *
   * Takes an executor for the same reason `revokeDraftTokens` does: Phase 07's
   * account claim has to burn the token and create the account together, and a
   * crash between the two would strand a Founder behind a dead link with no
   * account to sign into. The audit row is written outside the caller's
   * transaction on purpose — `audit_events` is insert-only and the attempt is
   * worth recording whether or not the surrounding work commits.
   */
  async function claimDraft(
    tokenId: string,
    executor: Pick<NodePgDatabase<Record<string, unknown>>, 'update'> = db,
  ): Promise<{ ok: boolean }> {
    const claimed = await executor
      .update(secureTokens)
      .set({ claimedAt: now(), revokedAt: now(), revokedReason: 'claimed' })
      .where(
        and(
          eq(secureTokens.id, tokenId),
          eq(secureTokens.scope, 'founder_draft'),
          isNull(secureTokens.claimedAt),
          isNull(secureTokens.revokedAt),
        ),
      )
      .returning({ id: secureTokens.id });

    const ok = claimed.length === 1;
    await audit({
      action: ok ? 'token.claimed' : 'token.claim_rejected',
      targetType: 'secure_token',
      targetId: tokenId,
      internalReason: ok ? 'draft claimed' : 'concurrent or repeat claim',
    });
    return { ok };
  }

  /**
   * Revokes every live token bound to one invited draft.
   *
   * Takes an executor so the caller can run it inside its own transaction. The
   * §25.8 retention sweep needs exactly that: revoking a token and leaving the
   * draft content readable, even for the width of two statements, is not
   * compliance — and a crash between them would leave it that way permanently.
   *
   * Deliberately separate from `expireStaleDrafts`. That one sweeps tokens
   * whose own `expires_at` has passed; this one is driven by the retention
   * clock, which §33.1.3 measures from the most recent invitation *send*.
   */
  async function revokeDraftTokens(
    campaignDraftId: string,
    reason: SecureToken['revokedReason'],
    executor: Pick<NodePgDatabase<Record<string, unknown>>, 'update'> = db,
  ): Promise<number> {
    const revoked = await executor
      .update(secureTokens)
      .set({ revokedAt: now(), revokedReason: reason })
      .where(
        and(
          eq(secureTokens.scope, 'founder_draft'),
          eq(secureTokens.campaignDraftId, campaignDraftId),
          isNull(secureTokens.revokedAt),
        ),
      )
      .returning({ id: secureTokens.id });

    await audit({
      action: 'token.draft_tokens_revoked',
      targetType: 'secure_token',
      targetId: campaignDraftId,
      internalReason: `${revoked.length} live draft token(s) revoked: ${reason}`,
    });

    return revoked.length;
  }

  /**
   * Revokes every live token bound to one campaign-Affiliate association.
   *
   * §8: "Admin can send, resend, or revoke one private campaign-specific signup
   * invitation." Revocation kills the link and nothing else — the prospect
   * record, the association, and its history all survive, because §25.4 keeps
   * the invitation events per campaign and a revoked invitation is one of them.
   *
   * Takes an executor for the same reason `revokeDraftTokens` does: revocation
   * and the association's status change belong in one transaction, and a crash
   * between them would leave a dead link beside an association that still says
   * `invited`.
   */
  async function revokeAssociationTokens(
    associationId: string,
    reason: SecureToken['revokedReason'],
    executor: Pick<NodePgDatabase<Record<string, unknown>>, 'update'> = db,
  ): Promise<number> {
    const revoked = await executor
      .update(secureTokens)
      .set({ revokedAt: now(), revokedReason: reason })
      .where(
        and(
          eq(secureTokens.scope, 'affiliate_invitation'),
          eq(secureTokens.associationId, associationId),
          isNull(secureTokens.revokedAt),
        ),
      )
      .returning({ id: secureTokens.id });

    await audit({
      action: 'token.association_tokens_revoked',
      targetType: 'secure_token',
      targetId: associationId,
      internalReason: `${revoked.length} live affiliate invitation token(s) revoked: ${reason}`,
    });

    return revoked.length;
  }

  /**
   * Atomically claims an Affiliate invitation token (§33.2.1).
   *
   * Identical in mechanism to `claimDraft` and separate from it on purpose: the
   * scope predicate is what stops a Founder draft token being burned by the
   * Affiliate signup route, and sharing one function would mean one predicate
   * covering both — exactly the cross-scope claim §33.2.1 tests for.
   */
  async function claimAffiliateInvitation(
    tokenId: string,
    executor: Pick<NodePgDatabase<Record<string, unknown>>, 'update'> = db,
  ): Promise<{ ok: boolean }> {
    const claimed = await executor
      .update(secureTokens)
      .set({ claimedAt: now(), revokedAt: now(), revokedReason: 'claimed' })
      .where(
        and(
          eq(secureTokens.id, tokenId),
          eq(secureTokens.scope, 'affiliate_invitation'),
          isNull(secureTokens.claimedAt),
          isNull(secureTokens.revokedAt),
        ),
      )
      .returning({ id: secureTokens.id });

    const ok = claimed.length === 1;
    await audit({
      action: ok ? 'token.affiliate_invitation_claimed' : 'token.claim_rejected',
      targetType: 'secure_token',
      targetId: tokenId,
      internalReason: ok ? 'affiliate invitation claimed' : 'concurrent or repeat claim',
    });
    return { ok };
  }

  /** Immediate revocation. Access ends on the next request (Spec §7). */
  async function revoke(
    tokenId: string,
    reason: SecureToken['revokedReason'],
    actorId?: string | null,
  ): Promise<void> {
    await db
      .update(secureTokens)
      .set({ revokedAt: now(), revokedReason: reason })
      .where(and(eq(secureTokens.id, tokenId), isNull(secureTokens.revokedAt)));

    await audit({
      action: 'token.revoked',
      targetType: 'secure_token',
      targetId: tokenId,
      internalReason: reason ?? 'unspecified',
      actorId: actorId ?? null,
    });
  }

  /**
   * Retention sweep for unclaimed drafts. Spec §7: draft *content* is deleted
   * or irreversibly anonymised 30 days after the most recent send, while
   * "minimum audit evidence remains".
   *
   * This function revokes the tokens. Anonymising the associated draft content
   * is the caller's job and belongs in the same transaction — a revoked token
   * beside live draft content is not compliance.
   */
  async function expireStaleDrafts(): Promise<string[]> {
    const expired = await db
      .update(secureTokens)
      .set({ revokedAt: now(), revokedReason: 'draft_anonymised' })
      .where(
        and(
          eq(secureTokens.scope, 'founder_draft'),
          isNull(secureTokens.revokedAt),
          isNull(secureTokens.claimedAt),
          lte(secureTokens.expiresAt, now()),
        ),
      )
      .returning({ campaignDraftId: secureTokens.campaignDraftId });

    return expired.map((r) => r.campaignDraftId).filter((id): id is string => !!id);
  }

  return {
    issue,
    rotate,
    verify,
    claimDraft,
    claimAffiliateInvitation,
    issueFounderEmailCode,
    verifyFounderEmailCode,
    revoke,
    revokeDraftTokens,
    revokeAssociationTokens,
    expireStaleDrafts,
  };
}

export type TokenService = ReturnType<typeof createTokenService>;
