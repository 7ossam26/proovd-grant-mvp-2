/**
 * §12's objective completion rules — the substance of Phase 09.
 *
 * Completion is derived from the evidence the Founder actually saved: verified
 * uploads, campaign colours, a real interview selection, written story, and a
 * valid controlled social address. No separate generic “done” flag exists.
 *
 * ── A pure decision over a snapshot ─────────────────────────────────────────
 * `decideItems` takes facts and returns decisions. It reads no database, calls
 * no network, and has no clock. Everything expensive or fallible — fetching an
 * object back out of R2, measuring an image, requesting a social URL — happens
 * before it and lands in the snapshot as a recorded result. That split is what
 * makes §33.3.1 assertable: the near-miss cases are constructed as facts and
 * the decision is checked, rather than a network being simulated.
 *
 * It also means the rules are one screenful. §12's list of near-misses is long
 * and each one must be rejected *deliberately*; the phase brief is explicit that
 * they are to be built rather than discovered.
 *
 * ── Rejections are ordered by what to do next ───────────────────────────────
 * §27.1 requires a state to say what the person can do now. So the codes come
 * back in the order the Founder would act on them — supply something, fix it,
 * approve it — rather than in the order the rules happen to be written. The
 * first code is the one the surface leads with.
 */

import type { EvidenceRejection, OptionalItemKey, InterviewStatus } from './registry.js';
import { interviewCompletesItem } from './registry.js';

/* ── The snapshot ─────────────────────────────────────────────────────────── */

export interface AssetFacts {
  id: string;
  purpose: 'visual' | 'logo';
  state: 'pending' | 'stored' | 'rejected';
  /** An `EVIDENCE_REJECTIONS` code recorded at verification, if it failed. */
  rejection: EvidenceRejection | null;
  approved: boolean;
  removed: boolean;
}

export interface SocialFacts {
  id: string;
  url: string;
  accessible: boolean | null;
  rejection: EvidenceRejection | null;
  controlsConfirmed: boolean;
  removed: boolean;
}

export interface BrandDirectionFacts {
  colors: string | null;
  typography: string | null;
  approved: boolean;
}

export interface StoryFacts {
  text: string | null;
  approved: boolean;
}

export interface InterviewFacts {
  status: InterviewStatus | null;
}

export interface WorkspaceSnapshot {
  assets: readonly AssetFacts[];
  socials: readonly SocialFacts[];
  brand: BrandDirectionFacts;
  story: StoryFacts;
  interview: InterviewFacts;
  /** Items an Admin has invalidated (§12). Held incomplete until corrected. */
  invalidated: Partial<Record<OptionalItemKey, boolean>>;
}

export interface ItemDecision {
  item: OptionalItemKey;
  complete: boolean;
  /** In the order the Founder would act on them. Empty when complete. */
  rejections: EvidenceRejection[];
  /** §12: "Each item stores evidence." What the decision rested on. */
  evidence: Record<string, unknown>;
}

/* ── Helpers ──────────────────────────────────────────────────────────────── */

const live = <T extends { removed: boolean }>(rows: readonly T[]) => rows.filter((r) => !r.removed);

/** Whitespace is not a written direction, and " " is not a story. */
const present = (value: string | null | undefined): boolean =>
  typeof value === 'string' && value.trim().length > 0;

/**
 * Collapses a set of failed candidates into the reasons worth showing.
 *
 * When several files failed for the same reason, saying it once is what §27.1
 * asks for; when they failed for different reasons, all of them matter because
 * each one is a different thing to fix.
 */
function distinct(codes: Array<EvidenceRejection | null>): EvidenceRejection[] {
  return [...new Set(codes.filter((c): c is EvidenceRejection => c !== null))];
}

/* ── The five rules ───────────────────────────────────────────────────────── */

/**
 * §12 Visuals: "at least one non-placeholder campaign visual or video is
 * uploaded, accessible, and Founder-approved for campaign use."
 *
 * Four conditions on one file, so the search is for a file that satisfies all
 * four — not for four files that each satisfy one. A stored-but-unapproved
 * visual beside an approved-but-rejected one completes nothing.
 */
function decideVisuals(snapshot: WorkspaceSnapshot): ItemDecision {
  const candidates = live(snapshot.assets).filter((a) => a.purpose === 'visual');
  const qualifying = candidates.filter((a) => a.state === 'stored' && a.approved);

  const evidence = {
    uploaded: candidates.length,
    stored: candidates.filter((a) => a.state === 'stored').length,
    approved: qualifying.length,
    assetIds: qualifying.map((a) => a.id),
  };

  if (qualifying.length > 0) {
    return { item: 'visuals', complete: true, rejections: [], evidence };
  }

  if (candidates.length === 0) {
    return { item: 'visuals', complete: false, rejections: ['nothing_supplied'], evidence };
  }

  // Everything that failed verification says why. A file that passed
  // verification and was simply never approved reports `not_approved` — §12's
  // "unapproved drafts", and the one the Founder can fix in a click.
  const failed = distinct(candidates.filter((a) => a.state !== 'stored').map((a) => a.rejection));
  const awaitingApproval = candidates.some((a) => a.state === 'stored' && !a.approved);

  const rejections: EvidenceRejection[] = [];
  if (awaitingApproval) rejections.push('not_approved');
  rejections.push(...failed);
  if (rejections.length === 0) rejections.push('nothing_supplied');

  return { item: 'visuals', complete: false, rejections, evidence };
}

/**
 * Branding qualifies when a usable, Founder-approved logo/wordmark and saved
 * campaign colours are present.
 *
 * These are the two controls the Founder can actually complete on the current
 * flow. Requiring hidden typography or direction-approval fields would leave
 * a visible discount permanently unobtainable.
 */
function decideBranding(snapshot: WorkspaceSnapshot): ItemDecision {
  const logos = live(snapshot.assets).filter((a) => a.purpose === 'logo');
  const usableLogo = logos.find((a) => a.state === 'stored' && a.approved);

  const hasColors = present(snapshot.brand.colors);

  const evidence = {
    logoAssetId: usableLogo?.id ?? null,
    logosUploaded: logos.length,
    hasColors,
  };

  if (usableLogo && hasColors) {
    return { item: 'branding', complete: true, rejections: [], evidence };
  }

  const rejections: EvidenceRejection[] = [];

  if (!usableLogo) {
    if (logos.length === 0) {
      rejections.push('logo_missing');
    } else if (logos.some((a) => a.state === 'stored' && !a.approved)) {
      rejections.push('not_approved');
      rejections.push(...distinct(logos.filter((a) => a.state !== 'stored').map((a) => a.rejection)));
    } else {
      const failed = distinct(logos.map((a) => a.rejection));
      rejections.push(...(failed.length > 0 ? failed : (['logo_missing'] as EvidenceRejection[])));
    }
  }

  if (!hasColors) rejections.push('nothing_supplied');

  return { item: 'branding', complete: false, rejections, evidence };
}

/**
 * A Founder earns the item when a real platform and time selection is saved.
 *
 * Three refusals, named separately, because they are three different things to
 * do next: confirm the one you picked, book again, book at all.
 */
function decideInterview(snapshot: WorkspaceSnapshot): ItemDecision {
  const status = snapshot.interview.status;
  const evidence = { status };

  if (interviewCompletesItem(status)) {
    return { item: 'interview', complete: true, rejections: [], evidence };
  }

  const rejection: EvidenceRejection =
    status === 'canceled'
        ? 'booking_canceled'
        : // `abandoned` and "no booking at all" both leave the Founder with the
          // same thing to do, and §12 groups them.
          'booking_absent';

  return { item: 'interview', complete: false, rejections: [rejection], evidence };
}

/**
 * A written story is the completing act. Recording and typing share the same
 * saved field, so the rule cannot silently discard one input method.
 */
function decideStory(snapshot: WorkspaceSnapshot): ItemDecision {
  const written = present(snapshot.story.text);
  const evidence = {
    written,
    length: snapshot.story.text?.trim().length ?? 0,
    approved: snapshot.story.approved,
  };

  if (written) {
    return { item: 'story', complete: true, rejections: [], evidence };
  }

  return {
    item: 'story',
    complete: false,
    rejections: ['nothing_supplied'],
    evidence,
  };
}

/**
 * A syntactically valid saved public-profile address plus the Founder's control
 * confirmation completes the item. Remote social sites commonly block server
 * probes, so reachability remains useful diagnostics but is not a fee gate.
 */
function decideSocials(snapshot: WorkspaceSnapshot): ItemDecision {
  const candidates = live(snapshot.socials);
  const qualifying = candidates.filter((s) => {
    try {
      const url = new URL(s.url);
      return (url.protocol === 'https:' || url.protocol === 'http:') && s.controlsConfirmed;
    } catch {
      return false;
    }
  });

  const evidence = {
    supplied: candidates.length,
    accessible: candidates.filter((s) => s.accessible === true).length,
    qualifying: qualifying.map((s) => ({ id: s.id, url: s.url })),
  };

  if (qualifying.length > 0) {
    return { item: 'socials', complete: true, rejections: [], evidence };
  }

  if (candidates.length === 0) {
    return { item: 'socials', complete: false, rejections: ['nothing_supplied'], evidence };
  }

  const malformed = candidates.filter((s) => {
    try {
      const url = new URL(s.url);
      return url.protocol !== 'https:' && url.protocol !== 'http:';
    } catch {
      return true;
    }
  });
  const rejections = distinct(malformed.map(() => 'url_malformed' as const));
  if (candidates.some((s) => !s.controlsConfirmed)) {
    rejections.unshift('not_approved');
  }
  if (rejections.length === 0) rejections.push('url_malformed');

  return { item: 'socials', complete: false, rejections, evidence };
}

/* ── The decision ─────────────────────────────────────────────────────────── */

const RULES: Record<OptionalItemKey, (s: WorkspaceSnapshot) => ItemDecision> = {
  visuals: decideVisuals,
  branding: decideBranding,
  interview: decideInterview,
  story: decideStory,
  socials: decideSocials,
};

/**
 * Decides all five items from one snapshot.
 *
 * An Admin invalidation overrides a passing rule and says so with its own code,
 * because §12 gives Admin that power explicitly: "Admin may invalidate an item
 * before payment with a reason; the Founder can correct it." The evidence the
 * rule produced is still recorded — an invalidation is a decision *about*
 * evidence, and discarding the evidence would make the correction unreviewable.
 */
export function decideItems(snapshot: WorkspaceSnapshot): ItemDecision[] {
  return (Object.keys(RULES) as OptionalItemKey[]).map((item) => {
    const decision = RULES[item](snapshot);
    if (!snapshot.invalidated[item]) return decision;

    return {
      ...decision,
      complete: false,
      rejections: ['invalidated' as EvidenceRejection, ...decision.rejections],
      evidence: { ...decision.evidence, invalidated: true },
    };
  });
}
