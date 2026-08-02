/**
 * Phase 14b — attribution vocabulary drift and the winner-cookie signature.
 *
 * The fast half of the attribution suite: pure units, no database. It proves the
 * backend's restated vocabulary matches `@proovd/shared` (the restate-and-
 * drift-test arrangement every backend copy of shared data uses) and that the
 * HMAC-signed winner cookie cannot be forged or tampered.
 *
 * The §33.6.1–5 behaviour is in `attribution.test.ts`, which needs a database.
 */

import { describe, it, expect } from 'vitest';
import {
  CLICK_OUTCOMES as SHARED_OUTCOMES,
  CLICK_IGNORED_REASONS as SHARED_REASONS,
  ATTRIBUTION_STATUSES as SHARED_STATUSES,
  DISCOVERY_KNOWN_LINK_ONLY_DAYS as SHARED_WINDOW,
  discoveryOpensAt as sharedDiscoveryOpensAt,
  attributionMayEarn,
} from '@proovd/shared';
import {
  CLICK_OUTCOMES,
  CLICK_IGNORED_REASONS,
  ATTRIBUTION_STATUSES,
  DISCOVERY_KNOWN_LINK_ONLY_DAYS,
  discoveryOpensAt,
} from '../attribution/vocabulary.js';
import {
  signAttribution,
  verifyAttribution,
  parseCookieHeader,
  attributionCookieName,
} from '../attribution/cookies.js';

const SECRET = 'test-only-secret-that-is-long-enough-32';

describe('attribution vocabulary drift (shared ⇄ backend)', () => {
  it('the click outcomes match', () => {
    expect([...CLICK_OUTCOMES]).toEqual([...SHARED_OUTCOMES]);
  });
  it('the ignored reasons match', () => {
    expect([...CLICK_IGNORED_REASONS]).toEqual([...SHARED_REASONS]);
  });
  it('the attribution statuses match', () => {
    expect([...ATTRIBUTION_STATUSES]).toEqual([...SHARED_STATUSES]);
  });
  it('the discovery window matches, and Day 8 is seven days after live', () => {
    expect(DISCOVERY_KNOWN_LINK_ONLY_DAYS).toBe(SHARED_WINDOW);
    expect(DISCOVERY_KNOWN_LINK_ONLY_DAYS).toBe(7);
    const live = new Date('2026-08-02T00:00:00Z');
    expect(discoveryOpensAt(live).toISOString()).toBe(sharedDiscoveryOpensAt(live).toISOString());
    expect(discoveryOpensAt(live).toISOString()).toBe('2026-08-09T00:00:00.000Z');
  });
  it('only provisional and verified may earn (§18)', () => {
    expect(attributionMayEarn('provisional')).toBe(true);
    expect(attributionMayEarn('verified')).toBe(true);
    expect(attributionMayEarn('blocked')).toBe(false);
    expect(attributionMayEarn('none')).toBe(false);
  });
});

describe('the winner cookie is signed and unforgeable', () => {
  const payload = { v: 'visitor-1', l: 'link-abc', t: '2026-08-02T12:00:00.000Z' };

  it('round-trips a valid payload', () => {
    const value = signAttribution(payload, SECRET);
    expect(verifyAttribution(value, SECRET)).toEqual(payload);
  });

  it('rejects a tampered body — the linkId cannot be swapped', () => {
    const value = signAttribution(payload, SECRET);
    const [body, tag] = value.split('.');
    const forgedBody = Buffer.from(
      JSON.stringify({ ...payload, l: 'link-someone-elses' }),
      'utf8',
    ).toString('base64url');
    expect(verifyAttribution(`${forgedBody}.${tag}`, SECRET)).toBeNull();
    // The original body with a made-up tag also fails.
    expect(verifyAttribution(`${body}.deadbeef`, SECRET)).toBeNull();
  });

  it('rejects a signature made with a different secret', () => {
    const value = signAttribution(payload, 'a-different-secret-of-good-length!');
    expect(verifyAttribution(value, SECRET)).toBeNull();
  });

  it('rejects malformed values without throwing', () => {
    expect(verifyAttribution(undefined, SECRET)).toBeNull();
    expect(verifyAttribution('', SECRET)).toBeNull();
    expect(verifyAttribution('no-dot', SECRET)).toBeNull();
    expect(verifyAttribution('.onlytag', SECRET)).toBeNull();
    expect(verifyAttribution('notbase64!!.tag', SECRET)).toBeNull();
  });
});

describe('cookie header parsing and naming', () => {
  it('parses a Cookie header into a map, URL-decoding values', () => {
    const parsed = parseCookieHeader('pv_vid=abc; pv_attr_x=body.tag; other=%20spaced%20');
    expect(parsed['pv_vid']).toBe('abc');
    expect(parsed['pv_attr_x']).toBe('body.tag');
    expect(parsed['other']).toBe(' spaced ');
  });
  it('returns an empty map for no header', () => {
    expect(parseCookieHeader(undefined)).toEqual({});
  });
  it('names the winner cookie per campaign', () => {
    expect(attributionCookieName('camp-123')).toBe('pv_attr_camp-123');
  });
});
