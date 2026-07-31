/**
 * The policy register's own invariants — Spec §18, §31.4, §29.8, §34.
 *
 * These are structural, not editorial: they prove the register cannot express
 * a state the Spec forbids (a published document with no effective date, a
 * draft that looks citable, two documents claiming one route). The content QA
 * that §33.11.6 names runs against the rendered pages, in
 * `frontend/src/features/public/public-site.test.tsx`.
 */

import { describe, it, expect } from 'vitest';
import {
  POLICY_DOCUMENTS,
  POLICY_ROUTES,
  POLICY_SLUGS,
  draftPolicyDocuments,
  findPolicyDocument,
  findPolicyDocumentByRoute,
  isCitableVersion,
  policyGateBlocked,
} from './documents.js';

/** §18's policy inventory, exactly. */
const SPEC_POLICY_ROUTES = [
  '/terms',
  '/privacy',
  '/cookies',
  '/refunds',
  '/fulfillment',
  '/aup',
  '/affiliate-aup',
  '/ip-agreement',
];

describe('policy register (§18, §31.4)', () => {
  it('covers exactly the eight §18 policy routes', () => {
    expect([...POLICY_ROUTES].sort()).toEqual([...SPEC_POLICY_ROUTES].sort());
  });

  it('gives every document a unique slug, route, and title', () => {
    expect(new Set(POLICY_SLUGS).size).toBe(POLICY_DOCUMENTS.length);
    expect(new Set(POLICY_ROUTES).size).toBe(POLICY_DOCUMENTS.length);
    expect(new Set(POLICY_DOCUMENTS.map((d) => d.title)).size).toBe(POLICY_DOCUMENTS.length);
  });

  it('gives every document a version identifier and a spec reference', () => {
    for (const doc of POLICY_DOCUMENTS) {
      expect(doc.version, doc.slug).toMatch(/\S/);
      expect(doc.specRef, doc.slug).toMatch(/§/);
      expect(doc.coverage.length, doc.slug).toBeGreaterThan(0);
    }
  });

  it('resolves a document by slug and by route', () => {
    expect(findPolicyDocument('refunds')?.title).toBe('Refund Policy');
    expect(findPolicyDocumentByRoute('/refunds')?.slug).toBe('refunds');
    expect(findPolicyDocument('nope')).toBeUndefined();
  });
});

describe('draft vs published (§31.4, §34)', () => {
  it('never lets a draft carry an effective date, an overview, or a body', () => {
    for (const doc of draftPolicyDocuments()) {
      expect(doc.effectiveDate, doc.slug).toBeNull();
      expect(doc.overview, doc.slug).toBeNull();
      expect(doc.body, doc.slug).toBeNull();
    }
  });

  it('never lets a published document ship without an effective date and full text', () => {
    for (const doc of POLICY_DOCUMENTS.filter((d) => d.status === 'published')) {
      expect(doc.effectiveDate, doc.slug).not.toBeNull();
      expect(doc.overview, doc.slug).toMatch(/\S/);
      expect(doc.body?.length ?? 0, doc.slug).toBeGreaterThan(0);
    }
  });

  it('makes only a published version citable by a consent record (§29.8)', () => {
    for (const doc of POLICY_DOCUMENTS) {
      expect(isCitableVersion(doc), doc.slug).toBe(doc.status === 'published');
    }
  });

  it('blocks the §34 gate while any document is unpublished', () => {
    // Track A2 is still in legal review, so this is the state today. When the
    // last document is published this expectation flips — deliberately, in
    // Phase 24, together with the release of the gate.
    expect(policyGateBlocked()).toBe(draftPolicyDocuments().length > 0);
    expect(draftPolicyDocuments().length).toBe(POLICY_DOCUMENTS.length);
  });
});
