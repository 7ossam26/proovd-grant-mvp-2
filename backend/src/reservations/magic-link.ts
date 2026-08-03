/**
 * The Backer magic link — mint or reissue (§19, §28.1).
 *
 * A magic link is scoped to one (campaign, Backer identity) and shows all of
 * that Backer's transactions. §5.4 gives Backers no account, so this is the only
 * way back in. It is minted once, on the first pre-order, and reissued on each
 * later confirmation so the newest email always carries a working link — the
 * raw token exists only in the delivered URL and is never recoverable, so a
 * second confirmation cannot re-send the same one (§28.1). Reissue keeps the
 * same (campaign, Backer) binding: it is the same page, a fresh key.
 */

import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { secureTokens } from '../db/schema/tokens.js';
import type { TokenService } from '../auth/token-service.js';

export interface MintedMagicLink {
  raw: string;
  url: string;
}

/** Builds the Backer-facing magic-link URL from a raw token. */
export function magicLinkUrl(appBaseUrl: string, raw: string): string {
  return `${appBaseUrl.replace(/\/$/, '')}/backer/${raw}`;
}

/**
 * Returns a fresh magic-link URL for a Backer identity. If a live link already
 * exists it is rotated (same lineage, same binding, new raw value); otherwise a
 * new one is issued. Either way the caller gets a raw token exactly once.
 */
export async function mintOrReissueMagicLink(
  deps: { db: Database; tokenService: TokenService; appBaseUrl: string },
  input: { campaignId: string; backerIdentityId: string },
): Promise<MintedMagicLink> {
  const [existing] = await deps.db
    .select({ lineageId: secureTokens.lineageId })
    .from(secureTokens)
    .where(
      and(
        eq(secureTokens.scope, 'backer_magic_link'),
        eq(secureTokens.campaignId, input.campaignId),
        eq(secureTokens.backerIdentityId, input.backerIdentityId),
        isNull(secureTokens.revokedAt),
      ),
    )
    .orderBy(desc(secureTokens.issuedAt))
    .limit(1);

  if (existing) {
    const rotated = await deps.tokenService.rotate(existing.lineageId);
    if ('raw' in rotated) {
      return { raw: rotated.raw, url: magicLinkUrl(deps.appBaseUrl, rotated.raw) };
    }
    // The lineage was revoked between the read and the rotate — fall through to
    // a fresh issue rather than fail the confirmation.
  }

  const issued = await deps.tokenService.issue({
    scope: 'backer_magic_link',
    campaignId: input.campaignId,
    backerIdentityId: input.backerIdentityId,
  });
  return { raw: issued.raw, url: magicLinkUrl(deps.appBaseUrl, issued.raw) };
}
