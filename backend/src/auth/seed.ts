/**
 * Direct account creation — the only way an account comes into existence.
 *
 * §5.1: "Internal accounts are seeded directly; there is no signup or public
 * invitation." §5.2 and §5.3 admit Founders and Affiliates by private
 * invitation only. So with the public signup route closed (`disableSignUp` in
 * `auth.ts`), *something* still has to create accounts, and this is it: an
 * explicit server-side call that always states the role, taken by an Admin
 * seeding script or by the invitation-claim flows in later phases.
 *
 * This deliberately provides no HTTP surface of its own. The moment account
 * creation is reachable over the network without an invitation, §33.2.1 —
 * "No public signup" — stops being true.
 *
 * ── What it does not do ─────────────────────────────────────────────────────
 * It does not enrol a TOTP factor. It cannot: enrolment needs the person and
 * their authenticator app. A seeded Admin therefore lands with
 * `twoFactorEnabled: false` and `requireAdmin` refuses them every operational
 * surface until they enrol — which is exactly what §5.1's "MFA is mandatory"
 * means when read as a requirement rather than a recommendation.
 */

import type { Auth } from './auth.js';
import type { ProovdRole } from '../db/schema/auth.js';
import type { AuditWriter } from './audit.js';

export interface SeedAccountInput {
  email: string;
  password: string;
  name: string;
  /** §5: no default. The caller always knows which kind of account this is. */
  role: ProovdRole;
  /**
   * §5.2/§5.3: collected, stored, and never verified. There is no parameter for
   * marking it verified, and the database rejects the attempt anyway
   * (`user_phone_never_verified`) — no SMS OTP exists (§33.1.8).
   */
  phone?: string;
  /** Who created this account, for the §25.6 record. */
  actor?: string;
}

export interface SeededAccount {
  id: string;
  email: string;
  role: ProovdRole;
}

export async function seedAccount(
  auth: Auth,
  audit: AuditWriter,
  input: SeedAccountInput,
): Promise<SeededAccount> {
  const ctx = await auth.$context;

  const user = await ctx.internalAdapter.createUser({
    email: input.email.toLowerCase(),
    name: input.name,
    role: input.role,
    phone: input.phone ?? null,
    phoneVerified: false,
    emailVerified: false,
  });

  // Better Auth owns the hash; the raw password is never stored or logged here
  // and goes out of scope with this call (§28.2: no sensitive value in logs).
  const hash = await ctx.password.hash(input.password);
  await ctx.internalAdapter.linkAccount({
    userId: user.id,
    providerId: 'credential',
    accountId: user.id,
    password: hash,
  });

  await audit({
    action: 'account.seeded',
    targetType: 'user',
    targetId: user.id,
    internalReason: `seeded ${input.role} account directly (§5.1)`,
    customerExplanation: 'Your Proovd account was created for you.',
    newValue: { role: input.role, email: input.email.toLowerCase() },
    ...(input.actor ? { actorId: input.actor } : {}),
  });

  return { id: user.id, email: input.email.toLowerCase(), role: input.role };
}
