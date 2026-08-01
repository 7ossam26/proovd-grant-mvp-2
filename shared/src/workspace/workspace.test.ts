/**
 * The §12 register, and the two calculations, at unit level.
 *
 * §33.3.2 and §33.3.4 are named for Phase 09, and `docs/master-plan.md` records
 * that Phase 03 already unit-tested both — this file covers the register that
 * arrived with Phase 09 and re-walks the two exhaustive spaces the acceptance
 * tests name, so a change to either is caught here before it needs a database
 * to be noticed.
 */

import { describe, it, expect } from 'vitest';
import {
  OPTIONAL_ITEMS,
  OPTIONAL_ITEM_KEYS,
  EVIDENCE_REJECTIONS,
  EVIDENCE_REJECTION_CODES,
  DECISION_SOURCES,
  optionalItem,
} from './optional-items.js';
import { HELPER_RESOURCES, HELPER_SUBJECTS } from './helper-resources.js';
import {
  INTERVIEW_STATUSES,
  MEETING_PROVIDERS,
  interviewCompletesItem,
  interviewCountsForHighEffort,
} from './interview.js';
import { computeListingFee, type OptionalItemCompletion } from '../money/listing-fee.js';
import { classifyHighEffort } from '../money/high-effort.js';
import {
  LISTING_FEE_BASE_CENTS,
  LISTING_FEE_ITEM_DISCOUNT_CENTS,
  LISTING_FEE_MIN_CENTS,
} from '../money/constants.js';

describe('the §12 optional-item register', () => {
  it('holds §12’s five items, in §12’s order', () => {
    expect(OPTIONAL_ITEMS.map((i) => i.key)).toEqual([...OPTIONAL_ITEM_KEYS]);
    expect(OPTIONAL_ITEM_KEYS).toEqual(['visuals', 'branding', 'interview', 'story', 'socials']);
  });

  it('states, for every item, what does NOT count', () => {
    // §12 lists the near-misses explicitly and §33.3.1 tests them. An item with
    // no stated exclusions is one whose rule the Founder cannot check against.
    for (const item of OPTIONAL_ITEMS) {
      expect(item.doesNotCount.length).toBeGreaterThan(0);
      expect(item.completesWhen.trim()).not.toBe('');
      expect(item.specRef).toContain('§12');
    }
  });

  it('describes the interview item by confirmation, never by booking', () => {
    const interview = optionalItem('interview');
    expect(interview.completesWhen.toLowerCase()).toContain('confirmed');
    // §12: "A selected-but-unconfirmed, canceled, or abandoned slot does not
    // count." All three have to be named, or the Founder learns the rule from
    // a discount that did not arrive.
    const excluded = interview.doesNotCount.join(' ').toLowerCase();
    expect(excluded).toContain('never confirmed');
    expect(excluded).toContain('left');
    expect(excluded).toContain('canceled');
  });

  it('describes the story item by approval, never by having written something', () => {
    const excluded = optionalItem('story').doesNotCount.join(' ').toLowerCase();
    expect(excluded).toContain('transcript');
    expect(excluded).toContain('summary');
    expect(excluded).toContain('draft');
  });

  it('gives every rejection code a sentence, and no generic one', () => {
    for (const code of EVIDENCE_REJECTION_CODES) {
      expect(EVIDENCE_REJECTIONS[code].trim()).not.toBe('');
    }
    // §27.1: a reason the Founder cannot act on is not a reason.
    expect(EVIDENCE_REJECTION_CODES).not.toContain('invalid');
    expect(EVIDENCE_REJECTION_CODES).not.toContain('error');
  });

  it('keeps §12’s three decision sources distinct', () => {
    expect(DECISION_SOURCES).toEqual(['founder_approval', 'provider_event', 'admin_override']);
  });
});

describe('§12 helper resources', () => {
  it('covers §12’s four subjects', () => {
    expect(HELPER_RESOURCES.map((r) => r.subject)).toEqual([...HELPER_SUBJECTS]);
    expect(HELPER_SUBJECTS).toEqual(['competition', 'branding', 'visuals', 'story']);
  });

  it('carries the reusable prompts §12 asks for', () => {
    for (const subject of ['branding', 'visuals', 'story'] as const) {
      const resource = HELPER_RESOURCES.find((r) => r.subject === subject)!;
      expect(resource.prompts.length).toBeGreaterThan(0);
    }
  });

  it('never offers to generate anything', () => {
    // §12: "static, copy-ready guidance—not an embedded AI product." §30 defers
    // AI pitch rewriting by name. The guidance may point at a tool; the product
    // may not do the writing, and this is the copy half of that rule.
    const text = JSON.stringify(HELPER_RESOURCES).toLowerCase();
    expect(text).not.toContain('generate for me');
    expect(text).not.toContain('write it for me');
    for (const resource of HELPER_RESOURCES) {
      for (const point of resource.points) {
        expect(point.toLowerCase()).not.toMatch(/\bproovd (will |can )?write/);
      }
    }
  });

  it('says that a transcript and a summary are raw material, not a story', () => {
    const story = HELPER_RESOURCES.find((r) => r.subject === 'story')!;
    const limits = story.limits.join(' ').toLowerCase();
    expect(limits).toContain('transcript is not a story');
    expect(limits).toContain('approve');
  });
});

describe('the interview status rules (§12)', () => {
  it('completes the item on `confirmed` and on nothing else', () => {
    for (const status of INTERVIEW_STATUSES) {
      expect(interviewCompletesItem(status)).toBe(status === 'confirmed');
    }
    expect(interviewCompletesItem(null)).toBe(false);
  });

  it('counts `selected` for high-effort but not for the discount', () => {
    // §12 uses the wider phrase "scheduled/confirmed" for the high-effort input
    // and the narrower `confirmed` for the item. Reading one for both would
    // either pay the US$2 early or classify an engaged Founder as high-effort.
    expect(interviewCountsForHighEffort('selected')).toBe(true);
    expect(interviewCompletesItem('selected')).toBe(false);
    expect(interviewCountsForHighEffort('canceled')).toBe(false);
    expect(interviewCountsForHighEffort('abandoned')).toBe(false);
    expect(interviewCountsForHighEffort(null)).toBe(false);
  });

  it('stores only the three conferencing providers §12 names', () => {
    expect(MEETING_PROVIDERS).toEqual(['google_meet', 'zoom', 'microsoft_teams']);
  });
});

/* ── §33.3.2 — every combination ─────────────────────────────────────────── */

describe('§33.3.2 — every item combination produces $35 − $2/item to a $25 floor', () => {
  const keys: Array<keyof OptionalItemCompletion> = [
    'visuals',
    'branding',
    'interviewConfirmed',
    'story',
    'socials',
  ];

  it('walks all 32 combinations', () => {
    for (let mask = 0; mask < 32; mask += 1) {
      const items: OptionalItemCompletion = {
        visuals: Boolean(mask & 1),
        branding: Boolean(mask & 2),
        interviewConfirmed: Boolean(mask & 4),
        story: Boolean(mask & 8),
        socials: Boolean(mask & 16),
      };

      const completed = keys.filter((k) => items[k]).length;
      const result = computeListingFee(items);

      expect(result.completedItems).toBe(completed);
      expect(result.discountLines).toHaveLength(completed);

      const expected =
        LISTING_FEE_BASE_CENTS - LISTING_FEE_ITEM_DISCOUNT_CENTS * BigInt(completed);
      expect(result.subtotalCents).toBe(
        expected < LISTING_FEE_MIN_CENTS ? LISTING_FEE_MIN_CENTS : expected,
      );
      // Never below the floor, never above the base — the two bounds §12 fixes.
      expect(result.subtotalCents).toBeGreaterThanOrEqual(LISTING_FEE_MIN_CENTS);
      expect(result.subtotalCents).toBeLessThanOrEqual(LISTING_FEE_BASE_CENTS);
    }
  });

  it('reaches exactly the $25 floor with all five, and $35 with none', () => {
    const all = computeListingFee({
      visuals: true,
      branding: true,
      interviewConfirmed: true,
      story: true,
      socials: true,
    });
    expect(all.subtotalCents).toBe(2500n);

    const none = computeListingFee({
      visuals: false,
      branding: false,
      interviewConfirmed: false,
      story: false,
      socials: false,
    });
    expect(none.subtotalCents).toBe(3500n);
  });
});

/* ── §33.3.4 — all eight high-effort combinations ────────────────────────── */

describe('§33.3.4 — high-effort is correct across all eight input combinations', () => {
  it('is true only when all three are absent', () => {
    const at = new Date('2026-03-01T00:00:00Z');

    for (let mask = 0; mask < 8; mask += 1) {
      const inputs = {
        visualsCompleted: Boolean(mask & 1),
        brandingCompleted: Boolean(mask & 2),
        interviewScheduledOrConfirmed: Boolean(mask & 4),
      };

      const result = classifyHighEffort(inputs, at, 'test');
      expect(result.highEffort).toBe(mask === 0);
      // §12: "Store the three inputs, result, calculation time, and
      // actor/system." All four come back, so the caller persists what was
      // classified rather than re-deriving it.
      expect(result.inputs).toEqual(inputs);
      expect(result.calculatedAt).toBe(at);
      expect(result.actor).toBe('test');
    }
  });
});
