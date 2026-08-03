/**
 * Practical deduplication — Spec §4.1, §25.3, §33.5.7.
 *
 * "`Unique Backer` is a fraud-control decision, not verified civil identity."
 * The private key derives from normalized email+phone (an HMAC under
 * `BETTER_AUTH_SECRET`, so a raw contact never becomes a reversible token), and
 * the same key means the same practical Backer — which is what makes "one active
 * Idea pre-order per unique Backer" a database fact.
 *
 * ── The two tiers, and the rule that must never be forgotten ─────────────────
 * A *hard* match — same normalized email AND phone — is the same identity, by
 * the unique index. A *soft* match — same email OR same phone, or the same card
 * fingerprint, across two different identities — is a suspected duplicate that
 * enters the §4.1 Admin queue. Shared IP alone never opens a case, let alone a
 * merge (§33.5.7): IP and device are risk *references*, recorded, never merge
 * signals. `shared/reservation` states that as data; this honours it.
 */

import { createHmac } from 'node:crypto';
import { and, eq, ne, or, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import {
  backerIdentities,
  reservationDeduplication,
  deduplicationCases,
  type BackerIdentity,
} from '../db/schema/reservations.js';
import { normalizeDedupInputs, isMergeSignal } from './restated.js';

type Tx = Pick<Database, 'select' | 'insert'>;

/** HMAC-SHA256 hex under the app secret. Never reversible to the raw value. */
function hmac(secret: string, value: string): string {
  return createHmac('sha256', secret).update(value, 'utf8').digest('hex');
}

export interface DedupMaterial {
  dedupKey: string;
  emailHash: string;
  phoneHash: string;
  emailNormalized: string;
  phoneNormalized: string;
}

/** Derives the private §4.1 key material from a Backer's contact details. */
export function deriveDedupMaterial(
  secret: string,
  contact: { email: string; phone: string },
): DedupMaterial {
  const norm = normalizeDedupInputs(contact);
  return {
    dedupKey: hmac(secret, `dedup:${norm.email}|${norm.phone}`),
    emailHash: hmac(secret, `email:${norm.email}`),
    phoneHash: hmac(secret, `phone:${norm.phone}`),
    emailNormalized: norm.email,
    phoneNormalized: norm.phone,
  };
}

export interface ResolvedBackerIdentity {
  identity: BackerIdentity;
  isNew: boolean;
  material: DedupMaterial;
}

/**
 * Finds the practical-unique Backer for these contacts on this campaign, or
 * creates one. The unique (campaign, dedup_key) index settles the race between
 * two concurrent first pre-orders from the same person — one inserts, the other
 * reads it back.
 */
export async function findOrCreateBackerIdentity(
  tx: Tx,
  secret: string,
  campaignId: string,
  contact: { email: string; phone: string },
): Promise<ResolvedBackerIdentity> {
  const material = deriveDedupMaterial(secret, contact);

  const inserted = await tx
    .insert(backerIdentities)
    .values({
      campaignId,
      email: contact.email,
      phone: contact.phone,
      emailNormalized: material.emailNormalized,
      phoneNormalized: material.phoneNormalized,
      dedupKey: material.dedupKey,
    })
    .onConflictDoNothing()
    .returning();

  if (inserted[0]) return { identity: inserted[0], isNew: true, material };

  const [existing] = await tx
    .select()
    .from(backerIdentities)
    .where(
      and(
        eq(backerIdentities.campaignId, campaignId),
        eq(backerIdentities.dedupKey, material.dedupKey),
      ),
    )
    .limit(1);
  return { identity: existing!, isNew: false, material };
}

/** Records the §25.3 least-privilege signal set for one reservation. */
export async function recordDedupSignals(
  tx: Pick<Database, 'insert'>,
  input: {
    campaignId: string;
    reservationId: string;
    backerIdentityId: string;
    material: DedupMaterial;
    paymentFingerprint: string | null;
    deviceHash: string | null;
    ipHash: string | null;
  },
): Promise<void> {
  await tx.insert(reservationDeduplication).values({
    campaignId: input.campaignId,
    reservationId: input.reservationId,
    backerIdentityId: input.backerIdentityId,
    emailHash: input.material.emailHash,
    phoneHash: input.material.phoneHash,
    dedupKey: input.material.dedupKey,
    paymentFingerprint: input.paymentFingerprint,
    deviceHash: input.deviceHash,
    ipHash: input.ipHash,
  });
}

/**
 * Opens an Admin case for every *other* identity on this campaign that shares a
 * merge signal — email, phone, or card fingerprint — with this one. Never IP or
 * device alone (§4.1, §33.5.7). The unique pair index means a re-detection does
 * not pile up a second case for the same pair.
 */
export async function detectSuspectedDuplicates(
  tx: Tx,
  input: {
    campaignId: string;
    identity: BackerIdentity;
    material: DedupMaterial;
    paymentFingerprint: string | null;
  },
): Promise<string[]> {
  const suspects = new Map<string, Set<string>>();
  const add = (id: string, signal: string) => {
    if (!isMergeSignal(signal)) return; // structurally refuses `ip`/`device`.
    if (!suspects.has(id)) suspects.set(id, new Set());
    suspects.get(id)!.add(signal);
  };

  // Soft email/phone matches: a different identity sharing one normalized field.
  const contactMatches = await tx
    .select({
      id: backerIdentities.id,
      email: backerIdentities.emailNormalized,
      phone: backerIdentities.phoneNormalized,
    })
    .from(backerIdentities)
    .where(
      and(
        eq(backerIdentities.campaignId, input.campaignId),
        ne(backerIdentities.id, input.identity.id),
        or(
          eq(backerIdentities.emailNormalized, input.material.emailNormalized),
          eq(backerIdentities.phoneNormalized, input.material.phoneNormalized),
        ),
      ),
    );
  for (const m of contactMatches) {
    if (m.email === input.material.emailNormalized) add(m.id, 'email');
    if (m.phone === input.material.phoneNormalized) add(m.id, 'phone');
  }

  // Same card fingerprint across two identities (§4.1 "supplement… fingerprint").
  if (input.paymentFingerprint) {
    const fpMatches = await tx
      .select({ backerIdentityId: reservationDeduplication.backerIdentityId })
      .from(reservationDeduplication)
      .where(
        and(
          eq(reservationDeduplication.campaignId, input.campaignId),
          eq(reservationDeduplication.paymentFingerprint, input.paymentFingerprint),
          ne(reservationDeduplication.backerIdentityId, input.identity.id),
        ),
      );
    for (const m of fpMatches) add(m.backerIdentityId, 'payment_fingerprint');
  }

  const opened: string[] = [];
  for (const [suspectId, signals] of suspects) {
    const row = await tx
      .insert(deduplicationCases)
      .values({
        campaignId: input.campaignId,
        primaryBackerIdentityId: input.identity.id,
        suspectedBackerIdentityId: suspectId,
        signals: [...signals],
      })
      .onConflictDoNothing()
      .returning({ id: deduplicationCases.id });
    if (row[0]) opened.push(row[0].id);
  }
  return opened;
}

/**
 * §33.5.7 / §4.1: whether this identity already holds an *active* Idea pre-order.
 * The uniqueness is per practical Backer, so it reads by backer identity, not by
 * email string. Used to refuse a second Idea pre-order (a reward change is the
 * supported path instead).
 */
export async function hasActiveReservation(
  db: Pick<Database, 'execute'>,
  backerIdentityId: string,
): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT 1 FROM reservations
    WHERE backer_identity_id = ${backerIdentityId} AND status = 'reserved_active'
    LIMIT 1
  `);
  return (result.rowCount ?? 0) > 0;
}
