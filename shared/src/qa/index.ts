/**
 * The P0 pass — Spec §33.11, §28.5, DNA §5.13 (Phase 23a).
 *
 * §33.11 is seven sentences of prose about everything built so far: "full
 * principal flows pass", "every CTA names the actual action", "campaign,
 * checkout, confirmation, email, magic link, and evidence agree" (the Admin
 * ledger surface §33.11.5 also named was removed with the rest of the Admin
 * money panels). Read as
 * prose those are a review; read as registers they are a test, and the phase's
 * own trap says why the difference matters — eight facts across six surfaces
 * is beyond what a person checks reliably, and a flow nobody listed is a flow
 * nobody swept.
 *
 * So each list is a record here, the suites walk the register rather than a
 * hand-written copy, and a flow, fact, or surface added later fails a count
 * until it is swept. This is the same arrangement §26.5's eleven ledger
 * dimensions, §31.7's ten risk signals, and §27's coverage machine already use.
 *
 * Nothing here is a new product rule. Every entry cites the section it restates,
 * and §33.11's own words are the whole of it — Phase 23 builds no behaviour
 * (§32.1 step 17).
 */

import { STATE_PATTERN_QUESTIONS, type StatePatternQuestion } from '../notifications/contract.js';

/* ── §33.11.1 the principal flows ──────────────────────────────────────────── */

/**
 * Who reads the surface. This decides which half of §3's naming contract binds
 * it: §3.1's internal names (`reservation`, `affiliate`, `pre_build`) are
 * forbidden in anything a Founder, Creator, or Backer reads and permitted in
 * the Admin panel, which is where those tables are actually being read against.
 * §3.2's replacements bind every audience — see `namingViolations`.
 */
export type FlowAudience = 'founder' | 'creator' | 'backer' | 'public' | 'admin';

export interface PrincipalFlow {
  key: string;
  /** What the person is doing, in their words. */
  label: string;
  /** The section that makes this flow principal. */
  specRef: string;
  audience: FlowAudience;
  /** The addresses the flow occupies, in the order a person meets them. */
  routes: readonly string[];
  /**
   * §28.5 names five flows whose keyboard path must be complete end to end.
   * The rest are still swept for axe, names, and structure — this flags the
   * ones where a keyboard trap is a §28.5 failure rather than a defect.
   */
  keyboardPathRequired: boolean;
}

/**
 * Every principal flow in the product.
 *
 * The list is the phase brief's ten, expanded to the addresses each one
 * actually occupies, plus the surfaces those ten pass through on the way. It is
 * deliberately exhaustive over the *routes a person reaches without an Admin
 * account*, because "every principal flow" cannot be checked against a list
 * somebody trimmed to what was convenient to fixture.
 *
 * `keyboardPathRequired` reproduces §28.5's own five: "Founder forms, Affiliate
 * decisions, campaign/checkout, magic-link cancellation/card recovery, and
 * support."
 */
export const PRINCIPAL_FLOWS = [
  {
    key: 'public_site',
    label: 'Reading the public site and its policies',
    specRef: '§18, §31.4',
    audience: 'public',
    routes: ['/', '/about', '/how-payments-work', '/safety'],
    keyboardPathRequired: false,
  },
  {
    key: 'founder_vetting',
    label: 'The invited Founder: the invite, §9’s answers, and the account claim',
    specRef: '§7, §9, §10',
    audience: 'founder',
    // Founder Flow v2 Session B (2026-08-18) split the first four screens onto
    // their own addresses. The first four are restated from
    // `FOUNDER_FLOW_PAGES` rather than imported, because this register is
    // `as const` and a spread would widen every route to `string` — and they
    // are drift-tested against it, the arrangement the state enums, the §6
    // settings and the notification keys all use.
    routes: [
      '/draft/:token',
      '/draft/:token/problem',
      '/draft/:token/solution',
      '/draft/:token/campaign-type',
      '/draft/:token/vetting',
      '/draft/:token/claim',
    ],
    keyboardPathRequired: true,
  },
  {
    key: 'founder_workspace',
    label: 'The optional items, the interview, and the listing fee',
    specRef: '§12, §24.6',
    audience: 'founder',
    routes: ['/campaigns/:campaignId/workspace'],
    keyboardPathRequired: true,
  },
  {
    key: 'founder_build',
    label: 'Building the campaign and submitting it for review',
    specRef: '§14.4, §15',
    audience: 'founder',
    routes: ['/campaigns/:campaignId/build', '/campaigns/:campaignId/preview'],
    keyboardPathRequired: true,
  },
  {
    key: 'founder_roster',
    label: 'Watching the roster and the Creator readiness',
    specRef: '§14.5, §16',
    audience: 'founder',
    routes: ['/campaigns/:campaignId/roster', '/campaigns/:campaignId/creator-readiness'],
    keyboardPathRequired: false,
  },
  {
    key: 'founder_live',
    label: 'The live campaign home, updates, results, and fulfillment',
    specRef: '§20, §21, §22.5',
    audience: 'founder',
    routes: [
      '/campaigns/:campaignId/home',
      '/campaigns/:campaignId/updates',
      '/campaigns/:campaignId/results',
      '/campaigns/:campaignId/fulfillment',
    ],
    keyboardPathRequired: true,
  },
  {
    key: 'creator_signup',
    label: 'The Creator invitation, signup, and payout setup',
    specRef: '§11, §13',
    audience: 'creator',
    routes: ['/creator-invitation/:token', '/creator/campaigns'],
    keyboardPathRequired: false,
  },
  {
    key: 'creator_decisions',
    label: 'The formal opportunity and the three decisions',
    specRef: '§14.1, §14.2',
    audience: 'creator',
    routes: ['/creator/campaigns/:associationId/opportunity'],
    keyboardPathRequired: true,
  },
  {
    key: 'creator_partnership',
    label: 'The active partnership and the campaign close',
    specRef: '§18, §21, Appendix B.7',
    audience: 'creator',
    routes: [
      '/creator/campaigns/:associationId/partnership',
      '/creator/campaigns/:associationId/close',
    ],
    keyboardPathRequired: false,
  },
  {
    key: 'public_campaign',
    label: 'The live campaign page a Backer reads',
    specRef: '§18',
    audience: 'public',
    routes: ['/campaign/:campaignId'],
    keyboardPathRequired: true,
  },
  {
    key: 'backer_checkout',
    label: 'The pre-order: reward, amounts, consent, and the saved card',
    specRef: '§19, Appendix A.3, A.4',
    audience: 'backer',
    routes: ['/campaign/:campaignId#checkout'],
    keyboardPathRequired: true,
  },
  {
    key: 'backer_magic_link',
    label: 'The magic link: status, cancellation, card recovery, and support',
    specRef: '§20, §21, §29.9',
    audience: 'backer',
    routes: ['/backer/:token'],
    keyboardPathRequired: true,
  },
  {
    key: 'notification_settings',
    label: 'The digest preference and the notification history',
    specRef: '§27.7',
    audience: 'founder',
    routes: ['/settings/notifications', '/creator/settings/notifications'],
    keyboardPathRequired: false,
  },
  {
    key: 'token_unavailable',
    label: 'A link that no longer works',
    specRef: '§5.5',
    audience: 'public',
    routes: ['/link-unavailable'],
    keyboardPathRequired: false,
  },
  {
    key: 'admin_panel',
    label: 'The Admin panel',
    specRef: '§26',
    audience: 'admin',
    // §26.1's two addresses: every Founder, and one Founder's workspace. The
    // panel's other sections are parked in the shell and have no route, so
    // listing them here would sweep a surface that does not exist — and the
    // register is what "every principal flow" is counted from.
    routes: ['/admin/founders', '/admin/founders/:prospectId'],
    keyboardPathRequired: true,
  },
] as const satisfies readonly PrincipalFlow[];

export type PrincipalFlowKey = (typeof PRINCIPAL_FLOWS)[number]['key'];

/** §28.5's five: the flows where an incomplete keyboard path is a failure. */
export const KEYBOARD_PATH_FLOWS = PRINCIPAL_FLOWS.filter((flow) => flow.keyboardPathRequired);

/* ── §33.11.4 every CTA names the actual action ────────────────────────────── */

/**
 * Labels that name no object.
 *
 * §33.11.4 is one sentence — "every CTA names the actual action" — and the
 * phase brief names the three that fail it most often: `Submit`, `OK`,
 * `Continue`. The register is exact-match and deliberately short, because the
 * rule is about a label that could sit on any button in the product, not about
 * a house style for verbs. `Cancel` is absent on purpose: on the magic-link
 * page cancelling *is* the action, and banning the word would push that surface
 * toward a euphemism for the one thing §20 requires it to offer plainly.
 *
 * Matching is case-insensitive on the trimmed accessible name, so `Continue →`
 * and `CONTINUE` are the same violation. A label that names the action *and*
 * carries one of these words — `Continue to your code`, `Submit for review` —
 * is not a violation, which is the whole distinction §33.11.4 draws.
 */
export const OBJECTLESS_CTA_LABELS = [
  'submit',
  'ok',
  'okay',
  'continue',
  'next',
  'back',
  'done',
  'go',
  'proceed',
  'start',
  'finish',
  'send',
  'confirm',
  'apply',
  'update',
  'yes',
  'no',
  'click here',
  'learn more',
  'read more',
  'here',
] as const;

/** Punctuation a label may carry without changing what it names. */
const CTA_DECORATION = /[\s.,;:!→›»↦<>—–-]+$/u;

export function ctaNamesItsAction(label: string): boolean {
  const bare = label.trim().replace(CTA_DECORATION, '').toLowerCase();
  return !(OBJECTLESS_CTA_LABELS as readonly string[]).includes(bare);
}

/* ── §33.11.6 nothing unresolved, placeholder, or stale ────────────────────── */

export interface PlaceholderPattern {
  key: string;
  specRef: string;
  description: string;
  pattern: RegExp;
}

/**
 * What must never appear in text a person reads.
 *
 * The first two are the §7/§8 preview gate applied to a surface rather than to
 * an email: a rendered `[AMOUNT]` or `{{name}}` is a variable that did not
 * resolve, and Appendix A.3, A.4, A.5, B.5, B.6, and B.8 all already refuse to
 * render with a bracket left in them. The rest are the states that look
 * finished and are not — and `placeholder_policy` is the one §31.4 names
 * outright, because a policy page saying "coming soon" is the failure §33.11.6
 * exists to catch, while the eight documents honestly describing themselves as
 * in legal review is the state Track A2 is actually in.
 */
export const PLACEHOLDER_PATTERNS = [
  {
    key: 'square_bracket_variable',
    specRef: '§7, §33.11.6',
    description: 'A template variable that did not resolve.',
    pattern: /\[[A-Z][A-Z0-9 _]{2,}\]/,
  },
  {
    key: 'brace_variable',
    specRef: '§7, §33.11.6',
    description: 'An interpolation that reached the page unrendered.',
    pattern: /\{\{[^}]*\}\}|\$\{[^}]*\}/,
  },
  {
    key: 'undefined_value',
    specRef: '§33.11.6',
    description: 'A value that stringified to undefined, null, or NaN.',
    pattern: /\b(undefined|NaN)\b|\bnull\b(?!\s*(hypothesis|island))/,
  },
  {
    key: 'lorem',
    specRef: '§33.11.6',
    description: 'Filler copy.',
    pattern: /\blorem ipsum\b/i,
  },
  {
    key: 'todo',
    specRef: '§33.11.6',
    description: 'A note to the team that reached the reader.',
    pattern: /\b(TODO|FIXME|TBD|XXX)\b/,
  },
  {
    key: 'placeholder_policy',
    specRef: '§18, §31.4',
    description: 'A document presented as final while it is a stub.',
    pattern: /\b(coming soon|placeholder|to be (written|added)|content pending)\b/i,
  },
] as const satisfies readonly PlaceholderPattern[];

export function placeholderViolations(text: string): string[] {
  return PLACEHOLDER_PATTERNS.filter((rule) => rule.pattern.test(text)).map((rule) => rule.key);
}

/* ── §33.11.7 the six-question pattern, on a surface ───────────────────────── */

/**
 * How each of §27.1's six questions is answered on a rendered surface.
 *
 * `StatePanel` is the one component that answers all six, and its row labels
 * are what a reader actually sees — so the detector reads those labels rather
 * than a class name. Question 5 has two honest answers: a control, or the
 * literal `No action needed` §11 pins and §33.2.3 tests for. Question 6 is a
 * route to a person that carries the reference with it, which is a link or a
 * button, never a sentence telling someone to write in.
 */
export const STATE_QUESTION_MARKERS: Record<StatePatternQuestion, readonly RegExp[]> = {
  what_happened: [/what happened/i],
  what_happens_next: [/\bnext\b/i],
  who_owns_it: [/\bowner\b/i],
  when_is_the_next_update: [/next update by/i],
  // Question 5's honest answer is usually not a word at all — it is a control.
  // Text alone can only see the case where the answer is that there is nothing
  // to do, which §11 pins as `No action needed`.
  what_can_the_user_do_now: [/no action needed/i],
  how_do_they_get_help_without_losing_context: [/get help/i, /\bsupport\b/i],
};

export const STATE_QUESTIONS = STATE_PATTERN_QUESTIONS;

/**
 * What the caller observed structurally, as distinct from what the state says.
 *
 * Question 5 is the reason this exists. "What can I do now" is answered by an
 * operable control, and a scanner reading text would have to accept the *word*
 * `action` as evidence — which would pass a panel that says "no action is
 * possible at this time" and offers nothing. So the caller reports whether a
 * control is actually there, and the register decides what that means.
 */
export interface StateEvidence {
  /** An enabled control the reader can operate right now. */
  hasControl?: boolean;
  /** A route to a person that carries the state's own reference with it. */
  hasSupportRoute?: boolean;
}

/** The §27.1 questions a rendered state does not answer. */
export function missingStateQuestions(
  renderedText: string,
  evidence: StateEvidence = {},
): StatePatternQuestion[] {
  return STATE_PATTERN_QUESTIONS.filter((question) => {
    if (question === 'what_can_the_user_do_now' && evidence.hasControl) return false;
    if (question === 'how_do_they_get_help_without_losing_context' && evidence.hasSupportRoute) {
      return false;
    }
    return !STATE_QUESTION_MARKERS[question].some((marker) => marker.test(renderedText));
  });
}

/* ── §33.11.3 the built bundle ─────────────────────────────────────────────── */

/**
 * What a bundle scan can and cannot prove, stated rather than assumed.
 *
 * §33.11.3's trap is "grep the built bundle, not just the source" — banned
 * vocabulary hides in generated strings. But the shipped bundle is one file
 * containing every surface, and §3.1's internal names are *permitted* in the
 * Admin panel: `reservation` is the table an Admin is reading the ledger
 * against. A bundle-wide scan for those terms would flag correct Admin copy and
 * would have to be silenced, and a silenced check is worse than none.
 *
 * So the two halves of §3 are checked in the two places where each is
 * decidable:
 *
 *  - §3.2's replacements — `pledge`, `escrow`, `all-or-nothing`, `goal` — bind
 *    every audience *including* internal names, so they are scanned across the
 *    whole bundle. That is the half the trap is really about.
 *  - §3.1's internal names are scanned against the *rendered text* of every
 *    customer-facing principal flow, which is stronger than a grep: it is what
 *    the person actually sees, with the Admin panel excluded because §3.1
 *    excludes it.
 */
export const BUNDLE_SCAN_SCOPE = {
  universal:
    '§3.2 replacements — scanned across the whole built bundle, including Admin, log, and identifier strings.',
  customerOnly:
    '§3.1 internal names — scanned against the rendered text of every customer-facing principal flow, Admin excluded.',
} as const;

/**
 * Whether a string extracted from a bundle is text a person could read.
 *
 * A minifier keeps string literals intact, so the bundle contains both
 * `"Your card is saved"` and `"/api/backer/reservations"`. Only the first is
 * copy. The rule is deliberately literal — two or more space-separated words,
 * no slashes, no camelCase run — because a cleverer rule is one that quietly
 * stops looking at the thing it was written to find.
 */
export function isReadableCopy(literal: string): boolean {
  const text = literal.trim();
  if (text.length < 8) return false;
  if (/[/\\{}<>$]/.test(text)) return false;
  if (/^[A-Z_]+$/.test(text)) return false;
  return text.split(/\s+/).filter((word) => /^[A-Za-z][a-z'’-]*$/.test(word)).length >= 2;
}

/* ── §33.11.5 the cross-surface contract ───────────────────────────────────── */

/**
 * The seven renderings of one pre-order §33.11.5 requires to agree.
 *
 * They are seven rather than one because each is assembled by different code
 * from a different read, which is exactly why they drift: the campaign page
 * composes the frozen build, the checkout quotes live tax, the emails render
 * from the notification catalog, the magic link reads the reservation, Admin
 * reads the ledger, and the evidence packet assembles stored records for a
 * dispute. Nothing forces them through one function, so nothing but a test
 * makes them agree.
 */
export const CONSISTENCY_SURFACES = {
  campaign: {
    specRef: '§18',
    description: 'The public campaign page a Backer reads before deciding.',
    readBy: 'backend/src/campaign/public-page.ts — buildPublicCampaign',
  },
  checkout: {
    specRef: '§19',
    description: 'The pre-order quote: reward, amounts, tax, and the consent.',
    readBy: 'backend/src/reservations/quote.ts — the checkout quote',
  },
  confirmation: {
    specRef: '§19',
    description: 'What the Backer is shown at the moment the pre-order succeeds.',
    readBy: 'the createReservation result',
  },
  email: {
    specRef: '§27.5',
    description: 'The transactional messages about this pre-order.',
    readBy: 'backend/src/notifications/catalog.ts — the rendered message',
  },
  magic_link: {
    specRef: '§20',
    description: 'The campaign-scoped magic-link page, the Backer’s durable copy.',
    readBy: 'backend/src/reservations/backer-page.ts — readBackerPage',
  },
  evidence: {
    specRef: '§24.11',
    description: 'The dispute evidence packet assembled from stored records.',
    readBy: 'backend/src/disputes/service.ts — readDisputeEvidencePacket',
  },
} as const;

export type ConsistencySurface = keyof typeof CONSISTENCY_SURFACES;

export const CONSISTENCY_SURFACE_KEYS = Object.keys(
  CONSISTENCY_SURFACES,
) as ConsistencySurface[];

export interface ConsistencyFact {
  specRef: string;
  description: string;
  /**
   * The surfaces that must carry the fact. A surface outside this list may
   * still carry it — and if it does, it must agree; what the list decides is
   * where an *absence* is itself the failure.
   */
  requiredOn: readonly ConsistencySurface[];
  /** Why the fact is absent where it is absent. */
  absentBecause?: string;
}

/**
 * §33.11.5's eight facts.
 *
 * `requiredOn` is not "everywhere" for any of them, and each exception is a
 * fact about the product rather than a concession. A statement descriptor
 * belongs to a card charge, so the campaign page — read by people who have not
 * pre-ordered — does not assert one. The support SLA is a promise made where
 * someone is asking for help, not on a marketing page. Making every fact
 * required everywhere would force each surface to assert something it has no
 * business asserting, which is the failure mode §27.2's money classes already
 * had to solve.
 */
export const CONSISTENCY_FACTS = {
  reward: {
    specRef: '§18, §19',
    description: 'The reward package the pre-order is for, by its name.',
    requiredOn: ['campaign', 'checkout', 'confirmation', 'email', 'magic_link', 'evidence'],
  },
  amounts: {
    specRef: '§19, §24.3',
    description: 'Subtotal, sales tax, and total, in integer cents.',
    requiredOn: ['checkout', 'confirmation', 'email', 'magic_link', 'evidence'],
    absentBecause:
      'The campaign page shows the reward price; a total exists only once there is a billing address to tax against (§24.3).',
  },
  seller: {
    specRef: '§2.1, §3.3',
    description: 'The Founder as merchant of record, by the name that is disclosed.',
    requiredOn: ['campaign', 'checkout', 'confirmation', 'email', 'magic_link', 'evidence'],
  },
  trigger: {
    specRef: '§19, §21',
    description: 'The disclosed rule under which the card is charged later.',
    requiredOn: ['campaign', 'checkout', 'confirmation', 'email', 'magic_link'],
    absentBecause:
      'The evidence packet carries the reservation’s own state and its stored snapshots rather than the campaign’s charge rule — §24.11 asks it for the consent and the disclosure version, which is where the rule the Backer agreed to actually lives.',
  },
  delivery: {
    specRef: '§18, §22.5',
    description: 'The delivery commitment the Backer was shown.',
    requiredOn: ['campaign', 'checkout', 'confirmation', 'email', 'magic_link', 'evidence'],
    absentBecause:
      'Delivery is a campaign-level promise, and §22.5 tracks the commitment on its own record.',
  },
  policy: {
    specRef: '§24.10',
    description: 'The refund and cancellation policy version the pre-order was made under.',
    requiredOn: ['campaign', 'checkout', 'confirmation', 'magic_link', 'evidence'],
    absentBecause:
      'A transactional message names the recovery path rather than reciting a policy version (§27.2); the snapshot itself is what the evidence packet reads back.',
  },
  descriptor: {
    specRef: '§24.12',
    description: 'The statement descriptor the charge will appear under.',
    requiredOn: ['checkout', 'confirmation', 'email', 'magic_link', 'evidence'],
    absentBecause:
      'A descriptor belongs to a card charge. The campaign page is read by people who have not pre-ordered, and asserting one there implies a charge that does not exist (§30).',
  },
  sla: {
    specRef: '§27.8',
    description: 'The published support response promise, in the words §27.8 publishes.',
    requiredOn: ['magic_link', 'email'],
    absentBecause:
      '§27.8 publishes the promise where someone is asking for help: the acknowledgement on screen and the same acknowledgement in the inbox. Everywhere else the product carries the *deadline* that promise produced rather than the sentence — and whether that deadline was computed from the committed calendar is §29.6’s question, tested against the case record itself.',
  },
} as const satisfies Record<string, ConsistencyFact>;

export type ConsistencyFactKey = keyof typeof CONSISTENCY_FACTS;

export const CONSISTENCY_FACT_KEYS = Object.keys(CONSISTENCY_FACTS) as ConsistencyFactKey[];

/** A fact one surface renders. `null` means the surface does not carry it. */
export type SurfaceFacts = Record<ConsistencyFactKey, string | null>;

export interface Disagreement {
  fact: ConsistencyFactKey;
  specRef: string;
  /** Every distinct value, by the surface that produced it. */
  values: Array<{ surface: ConsistencySurface; value: string | null }>;
  kind: 'missing' | 'conflicting';
}

/**
 * The §33.11.5 comparison: for every fact, the surfaces that must carry it do,
 * and every surface that carries it says the same thing.
 *
 * Values are compared exactly. Normalising them here — trimming currency
 * symbols, collapsing case — would make the check pass on two renderings that
 * a reader would see as different, which is the entire failure §33.11.5 is
 * about. Normalisation belongs to the callers that produce the values, where it
 * is a rendering decision somebody made on purpose.
 */
export function crossSurfaceDisagreements(
  rendered: Partial<Record<ConsistencySurface, SurfaceFacts>>,
): Disagreement[] {
  const found: Disagreement[] = [];

  for (const fact of CONSISTENCY_FACT_KEYS) {
    const definition = CONSISTENCY_FACTS[fact];
    const values: Array<{ surface: ConsistencySurface; value: string | null }> = [];

    for (const surface of CONSISTENCY_SURFACE_KEYS) {
      const facts = rendered[surface];
      if (!facts) continue;
      values.push({ surface, value: facts[fact] });
    }

    const missing = values.filter(
      (entry) =>
        (definition.requiredOn as readonly string[]).includes(entry.surface) &&
        (entry.value === null || entry.value.trim() === ''),
    );
    if (missing.length > 0) {
      found.push({ fact, specRef: definition.specRef, values: missing, kind: 'missing' });
      continue;
    }

    const present = values.filter((entry) => entry.value !== null && entry.value.trim() !== '');
    const distinct = new Set(present.map((entry) => entry.value));
    if (distinct.size > 1) {
      found.push({ fact, specRef: definition.specRef, values: present, kind: 'conflicting' });
    }
  }

  return found;
}
