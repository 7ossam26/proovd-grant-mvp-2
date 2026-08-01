/**
 * The Socials item — Spec §12, §33.3.1.
 *
 * §12: "at least one valid, accessible, public Founder/product social profile
 * controlled by the Founder is supplied", and "inaccessible URLs" do not
 * qualify. Three of those four adjectives are decided here; the fourth is the
 * Founder's own confirmation and is stored as exactly that (§1.4 — Proovd has
 * no way to prove control and inventing one is §1 rule 6).
 *
 * ── Fetching a URL a stranger typed is the dangerous part of this phase ─────
 * Phase 09 is "the first file-upload surface, which is where quiet security
 * mistakes live", and this is the other one: a server that fetches any address a
 * Founder supplies is a server that will happily fetch `http://169.254.169.254/`
 * or a database on the private network and report what it found. So the check
 * below refuses anything that is not http(s), resolves the hostname *before*
 * connecting and refuses every private, loopback, link-local, and unique-local
 * address, and re-applies the whole test to each redirect rather than handing
 * the follow to the runtime.
 *
 * The response body is never read, never stored, and never returned. The only
 * things that leave this module are a status code and a decision — which is all
 * §12 asks for, and means a blind-SSRF probe learns nothing it did not already
 * know.
 */

import { and, eq } from 'drizzle-orm';
import dns from 'node:dns/promises';
import net from 'node:net';
import type { Database } from '../db/client.js';
import { campaignSocialProfiles } from '../db/schema/workspace.js';
import type { EvidenceRejection } from './registry.js';

/** Long enough for a slow social host, short enough not to hold a request. */
const FETCH_TIMEOUT_MS = 5_000;
const MAX_REDIRECTS = 3;

export interface SocialCheck {
  accessible: boolean;
  httpStatus: number | null;
  rejection: EvidenceRejection | null;
}

/* ── Address safety ───────────────────────────────────────────────────────── */

function isPrivateIPv4(address: string): boolean {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p))) return true;
  const [a, b] = parts as [number, number, number, number];
  return (
    a === 0 || // "this network"
    a === 10 || // private
    a === 127 || // loopback
    (a === 169 && b === 254) || // link-local, including the cloud metadata address
    (a === 172 && b >= 16 && b <= 31) || // private
    (a === 192 && b === 168) || // private
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    a >= 224 // multicast and reserved
  );
}

function isPrivateIPv6(address: string): boolean {
  const value = address.toLowerCase().replace(/^\[|\]$/g, '');
  if (value === '::1' || value === '::') return true;
  if (value.startsWith('fe80')) return true; // link-local
  if (/^f[cd]/.test(value)) return true; // unique-local
  // IPv4-mapped — the v4 rules decide.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(value);
  if (mapped) return isPrivateIPv4(mapped[1]!);
  return false;
}

function isPrivateAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) return isPrivateIPv4(address);
  if (family === 6) return isPrivateIPv6(address);
  return true;
}

/**
 * Refuses a URL that is not a public web address.
 *
 * Returns the rejection code rather than throwing, because every one of these
 * is something the Founder can fix and §27.1 requires a next action.
 */
async function assertPublicUrl(raw: string): Promise<EvidenceRejection | null> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'url_malformed';
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'url_malformed';
  if (url.username || url.password) return 'url_malformed';

  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    return 'url_not_public';
  }

  // An IP literal is checked directly; a name is resolved and every answer is
  // checked, because a hostname that resolves to 127.0.0.1 is the whole trick.
  if (net.isIP(host)) {
    return isPrivateAddress(host) ? 'url_not_public' : null;
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = await dns.lookup(host, { all: true });
  } catch {
    return 'url_unreachable';
  }

  if (addresses.length === 0) return 'url_unreachable';
  if (addresses.some((a) => isPrivateAddress(a.address))) return 'url_not_public';

  return null;
}

/* ── The check ────────────────────────────────────────────────────────────── */

/**
 * §12's "accessible" and "public", decided by asking.
 *
 * A 2xx or 3xx that lands somewhere public is accessible. A 401 or 403 is a
 * profile that exists and is not public, which is a different thing to tell the
 * Founder than "that address did not open". Everything else is unreachable.
 *
 * `HEAD` first because most social hosts answer it and it moves no body; a host
 * that refuses `HEAD` gets one `GET`, whose body is discarded unread.
 */
export async function checkSocialUrl(
  raw: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SocialCheck> {
  let target = raw;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const unsafe = await assertPublicUrl(target);
    if (unsafe) return { accessible: false, httpStatus: null, rejection: unsafe };

    let response: Response;
    try {
      response = await request(target, 'HEAD', fetchImpl);
      if (response.status === 405 || response.status === 501) {
        response = await request(target, 'GET', fetchImpl);
      }
    } catch {
      return { accessible: false, httpStatus: null, rejection: 'url_unreachable' };
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) {
        return { accessible: false, httpStatus: response.status, rejection: 'url_unreachable' };
      }
      // Re-checked from the top on the next pass — the redirect target is as
      // untrusted as the address the Founder typed.
      try {
        target = new URL(location, target).toString();
      } catch {
        return { accessible: false, httpStatus: response.status, rejection: 'url_unreachable' };
      }
      continue;
    }

    if (response.status === 401 || response.status === 403) {
      return { accessible: false, httpStatus: response.status, rejection: 'url_not_public' };
    }

    if (response.ok) {
      return { accessible: true, httpStatus: response.status, rejection: null };
    }

    return { accessible: false, httpStatus: response.status, rejection: 'url_unreachable' };
  }

  return { accessible: false, httpStatus: null, rejection: 'url_unreachable' };
}

async function request(url: string, method: 'HEAD' | 'GET', fetchImpl: typeof fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetchImpl(url, {
      method,
      // Followed by hand, one hop at a time, so each target is re-validated.
      redirect: 'manual',
      signal: controller.signal,
      headers: { 'user-agent': 'Proovd/1.0 (+https://app.proovd.co)' },
    });
  } finally {
    clearTimeout(timer);
  }
}

/* ── Storage ──────────────────────────────────────────────────────────────── */

/** Best-effort display only. The stored URL is what was checked. */
function readPlatform(raw: string): { platform: string | null; handle: string | null } {
  try {
    const url = new URL(raw);
    const host = url.hostname.replace(/^www\./, '');
    const segment = url.pathname.split('/').filter(Boolean)[0] ?? null;
    return { platform: host, handle: segment ? `@${segment.replace(/^@/, '')}` : null };
  } catch {
    return { platform: null, handle: null };
  }
}

export type AddSocialResult =
  | { ok: true; id: string; check: SocialCheck }
  | { ok: false; code: EvidenceRejection; message: string };

/**
 * Adds a profile and checks it immediately.
 *
 * A failed check still stores the row. §12 wants the Founder to be able to fix
 * an inaccessible link, and a link that vanished on rejection would give them
 * nothing to fix — the same reasoning that keeps an incomplete Creator
 * verification record saveable (Phase 08a).
 */
export async function addSocialProfile(
  db: Database,
  input: {
    campaignId: string;
    url: string;
    controlsConfirmed: boolean;
    actor: string;
    fetchImpl?: typeof fetch;
  },
): Promise<AddSocialResult> {
  const trimmed = input.url.trim();
  if (!trimmed) {
    return { ok: false, code: 'url_malformed', message: 'Enter a web address.' };
  }

  const check = await checkSocialUrl(trimmed, input.fetchImpl ?? fetch);
  const { platform, handle } = readPlatform(trimmed);

  try {
    const [row] = await db
      .insert(campaignSocialProfiles)
      .values({
        campaignId: input.campaignId,
        url: trimmed,
        platform,
        handle,
        controlsConfirmed: input.controlsConfirmed,
        checkedAt: new Date(),
        httpStatus: check.httpStatus,
        accessible: check.accessible,
        rejection: check.rejection,
        createdBy: input.actor,
      })
      .returning({ id: campaignSocialProfiles.id });

    return { ok: true, id: row!.id, check };
  } catch (error) {
    // Drizzle wraps the driver error, so the code is found by walking `cause` —
    // the same reasoning as `uploads.ts`.
    let current: unknown = error;
    for (let depth = 0; depth < 5 && current; depth += 1) {
      if (typeof current === 'object' && (current as { code?: string }).code === '23505') {
        return {
          ok: false,
          code: 'url_malformed',
          message: 'That address is already on this campaign.',
        };
      }
      current = (current as { cause?: unknown }).cause;
    }
    throw error;
  }
}

/** Re-checks one profile. Admin's recheck and the Founder's retry share it. */
export async function recheckSocialProfile(
  db: Database,
  input: { id: string; campaignId: string; fetchImpl?: typeof fetch },
): Promise<SocialCheck | null> {
  const [row] = await db
    .select()
    .from(campaignSocialProfiles)
    .where(
      and(
        eq(campaignSocialProfiles.id, input.id),
        eq(campaignSocialProfiles.campaignId, input.campaignId),
      ),
    )
    .limit(1);

  if (!row) return null;

  const check = await checkSocialUrl(row.url, input.fetchImpl ?? fetch);

  await db
    .update(campaignSocialProfiles)
    .set({
      checkedAt: new Date(),
      httpStatus: check.httpStatus,
      accessible: check.accessible,
      rejection: check.rejection,
      updatedAt: new Date(),
    })
    .where(eq(campaignSocialProfiles.id, row.id));

  return check;
}

export async function setSocialControlConfirmation(
  db: Database,
  input: { id: string; campaignId: string; confirmed: boolean },
): Promise<boolean> {
  const updated = await db
    .update(campaignSocialProfiles)
    .set({ controlsConfirmed: input.confirmed, updatedAt: new Date() })
    .where(
      and(
        eq(campaignSocialProfiles.id, input.id),
        eq(campaignSocialProfiles.campaignId, input.campaignId),
      ),
    )
    .returning({ id: campaignSocialProfiles.id });

  return updated.length > 0;
}

export async function removeSocialProfile(
  db: Database,
  input: { id: string; campaignId: string; actor: string },
): Promise<boolean> {
  const now = new Date();
  const updated = await db
    .update(campaignSocialProfiles)
    .set({ removedAt: now, removedBy: input.actor, updatedAt: now })
    .where(
      and(
        eq(campaignSocialProfiles.id, input.id),
        eq(campaignSocialProfiles.campaignId, input.campaignId),
      ),
    )
    .returning({ id: campaignSocialProfiles.id });

  return updated.length > 0;
}
