/**
 * The Creator's work surface — Creator Flow v2, Session F, 2026-08-20.
 *
 * ═══ THIS IS §17's OWN CONTENT LIST, REDRAWN ════════════════════════════════
 *
 * §17's *"After readiness/activation, show:"* is thirteen bullets, and it is
 * the real specification for the reference's `work` screen. Fourteen of the
 * fields already existed in `buildCreatorPartnership`'s payload before this
 * session — which is why this is a re-presentation and not a rebuild, and is
 * the single largest saving in the phase.
 *
 * `CREATOR_WORK_ITEMS` is that list as a register, so **"every §17 bullet has
 * a field" is a count rather than a claim**. Each entry names the payload field
 * that answers it; the suite walks the register against a real payload, so a
 * bullet that quietly loses its field fails rather than disappearing.
 *
 * ── What this surface may show, and the boundary is §19's ──────────────────
 * §19, verbatim: *"Affiliate sees only aggregate clicks, attributed pre-orders,
 * reward summary, and timestamps."* §28.4 adds that the Creator receives no
 * Backer PII. So there is no Backer name, no survey answer, and no per-order
 * row anywhere in this file or the payload behind it — the reference draws
 * Backer quotes and they are refused in `CREATOR_FLOW_ABSENCES`.
 *
 * ── Refresh-based, never real time (§17's own last bullet, §30) ────────────
 * The server stamps the instant; the surface renders `Updated [local time]`
 * and the explanation. §30 forbids the real-time claim for refresh data, and
 * `BANNED_FRESHNESS_TERMS` is scanned across the rendered surface.
 */

/** One of §17's bullets, and the payload field that answers it. */
export interface CreatorWorkItem {
  id: string;
  /** §17's own words, so the register can be read against the Spec. */
  bullet: string;
  /** The field on the partnership payload that carries it. */
  field: string;
  specRef: string;
}

/**
 * §17's thirteen bullets, in §17's order.
 *
 * `field` is a dotted path into the partnership payload and is what the suite
 * resolves. A bullet whose field is absent from the payload fails the walk —
 * which is the only form of "every §17 bullet has a field" that survives a
 * later refactor renaming one.
 */
export const CREATOR_WORK_ITEMS: readonly CreatorWorkItem[] = [
  {
    id: 'founder_and_product',
    bullet: 'Founder and product.',
    field: 'founder.displayName',
    specRef: '§17',
  },
  {
    id: 'type_and_public_link',
    bullet: 'Campaign type and public link.',
    field: 'product.publicUrl',
    specRef: '§17',
  },
  {
    id: 'tracking_link',
    bullet: 'Unique tracking link with copy confirmation.',
    field: 'trackingLink.url',
    specRef: '§17, §14.1',
  },
  {
    id: 'disclosure',
    bullet: 'Disclosure templates with copy confirmation.',
    field: 'trackingLink.disclosureText',
    specRef: '§17, §14.1',
  },
  {
    id: 'brand_and_rewards',
    bullet:
      'Brand notes, allowed/prohibited claims, rewards/prices, delivery dates, campaign end.',
    field: 'brandRules.requiredWording',
    specRef: '§17',
  },
  {
    id: 'joined_and_activated',
    bullet: 'Joined-at and `activated_at`.',
    field: 'joinedAt',
    specRef: '§17',
  },
  {
    id: 'mid_campaign',
    bullet: 'Remaining-time deliverables for mid-campaign joiners.',
    field: 'midCampaign',
    specRef: '§17, §20',
  },
  {
    id: 'compensation_and_state',
    bullet:
      'Locked compensation, fixed-payment funding/completion state, first-post state, and readiness.',
    field: 'readiness.label',
    specRef: '§17, §14.2, §16',
  },
  {
    id: 'clicks_preorders_conversion',
    bullet: 'Clicks, attributed active pre-orders, conversion.',
    field: 'performance.attributedPreorders',
    specRef: '§17, §19',
  },
  {
    id: 'captured_after_close',
    bullet: 'Captured attributed amount after close.',
    field: 'performance.capturedSubtotalCents',
    specRef: '§17, §19',
  },
  {
    id: 'earnings_and_bonus',
    bullet: 'Estimated/finalized earnings and bonus progress.',
    field: 'earnings.state',
    specRef: '§17, §22.1, §14.3',
  },
  {
    id: 'transfer_state',
    bullet: 'Transfer/payout state.',
    field: 'earnings.label',
    specRef: '§17, §22.1',
  },
  {
    id: 'freshness',
    bullet:
      '`Updated [local time]` and explanation that metrics are refresh-based, not real time.',
    field: 'updatedAt',
    specRef: '§17, §30',
  },
];

export const CREATOR_WORK_ITEM_IDS: readonly string[] = CREATOR_WORK_ITEMS.map((i) => i.id);

/* ── The termination ask (§29.5, §26.7) ───────────────────────────────────── */

/**
 * §29.5's own four valid reasons for ending a partnership.
 *
 * The reference's control says *"One admin decides: pass, warning, restrict, or
 * remove"* — which is §29.4's vocabulary for enforcement actions **against the
 * Creator**, printed on a control that reports a Founder. What it actually is
 * is a request, and §29.5 names what makes one valid.
 */
export const TERMINATION_REASONS = [
  {
    id: 'founder_material_breach',
    label: 'The Founder broke the agreement',
    help: 'Something in the terms you both accepted has not been honoured.',
  },
  {
    id: 'proovd_suspension',
    label: 'The campaign has been suspended',
    help: 'Proovd has stopped the campaign and you want the partnership to end with it.',
  },
  {
    id: 'emergency_or_capacity',
    label: 'Something has come up on my side',
    help: 'An emergency, or you can no longer give the campaign the time you agreed to.',
  },
  {
    id: 'other',
    label: 'Something else',
    help: 'Tell us in your own words. A person reads every one of these.',
  },
] as const;

export type TerminationReasonId = (typeof TERMINATION_REASONS)[number]['id'];

export const TERMINATION_REASON_IDS: readonly string[] = TERMINATION_REASONS.map((r) => r.id);

/**
 * Pinned. Renders on the termination control, where the reference printed
 * §29.4's enforcement vocabulary.
 *
 * Prefixed `CREATOR_` because the Admin workspace already exports a
 * `TERMINATION_DECIDES_NO_MONEY` about the same record from the other side —
 * two audiences, two sentences, and the barrel would otherwise resolve one of
 * them to the wrong one.
 *
 * The ask decides no money and ends nothing by itself — 0048's own header says
 * so about the record it produces. Saying it here is what stops somebody
 * reading the control as the thing that cancels their earnings.
 */
export const CREATOR_TERMINATION_DECIDES_NO_MONEY =
  'Asking does not end the partnership and does not change anything about what you have earned. It opens a case a person reads, and they come back to you.';

/**
 * Pinned. Renders beside the reason field.
 *
 * §24.8's cause and its permitted money treatments are an Admin's recorded
 * judgement (20a), and asking a Creator to pick one would be asking them to
 * classify a refund that does not exist. So the Creator states the reason and
 * Admin classifies — which is also why this route opens a §26.7 case rather
 * than writing 0048's row directly. See `docs/phases/creator-flow-reconciliation.md` §11.
 */
export const TERMINATION_IS_CLASSIFIED_BY_A_PERSON =
  'You say what happened. How it is classified — and what that means for money either way — is a decision somebody at Proovd records, not one this form makes.';

/* ── The first post (§17 steps 4–5) ───────────────────────────────────────── */

/**
 * Pinned. Renders on the first-post control.
 *
 * The reference's `I published my first post` sets `posted: true` from the
 * Creator's own click and says *"First post is live. Tracking is on."* Both
 * halves are wrong: §17's steps 4 and 5 are *"Each Creator submits the public
 * post URL"* and *"Admin verifies the live post"*, with three outcomes — and
 * tracking started at `activated_at` (step 2), not at this click.
 */
export const FIRST_POST_IS_SUBMITTED_FOR_VERIFICATION =
  'Paste the public link to your post. Somebody at Proovd checks it against the campaign’s brand notes and the disclosure rules, and tells you the outcome. Your tracking link has been counting since it went live — this does not switch it on.';

/**
 * Pinned. Renders under the verification outcome while one is pending.
 *
 * §33.4.7: the verification releases US$0. A Creator watching for a decision
 * should not be watching for a payment.
 */
export const VERIFICATION_MOVES_NO_MONEY =
  'Verification decides whether traffic through your link can count toward earnings later. Nothing is paid at this step.';

/* ── The materials (§31.5, §30, §12) ──────────────────────────────────────── */

/**
 * Pinned. Renders where the reference put `Customize` and
 * `Generate milestone graphic`.
 *
 * §30 defers AI pitch rewriting; §12 makes the helper resources static,
 * copy-ready guidance and not an embedded AI product. The tone the Creator
 * recorded is SHOWN — it is their own answer and worth showing back — and is
 * never used to rewrite anything.
 */
export const MATERIALS_ARE_NOT_GENERATED =
  'These are the Founder’s own materials, as they supplied them. Nothing here is written or rewritten for you.';

/**
 * Pinned. Renders where the tone would otherwise have been used.
 *
 * `VOICE_IS_NEVER_USED_TO_REWRITE` says the same thing on the onboarding
 * screen that collects it; this is the same promise on the surface where the
 * reference broke it.
 */
export const TONE_IS_SHOWN_NEVER_APPLIED =
  'You told us how you like to sound. We show it back to you here and use it for nothing else.';

/* ── The safe link test (§14.1) — an omission from the reference ──────────── */

/**
 * Pinned. Renders beside the test link.
 *
 * §14.1 gives the Creator a way to check their own link without earning
 * attribution, and the mechanism has existed since 14b: the ingest reads
 * `LINK_TEST_MARKER` by that exact name and a CHECK ties the `link_test` flag
 * to the ignored outcome. The prototype draws no control for it.
 */
export const LINK_TEST_EARNS_NOTHING =
  'Opening this checks your link works. It is recorded as a test, it earns nothing, and it cannot replace whoever clicked before it.';

/* ── The money on this surface (§22.1, §24.4) ─────────────────────────────── */

/**
 * Pinned. Renders where the reference put `Withdraw` and
 * `Base commission` / `Performance bonus`.
 *
 * §22.1, verbatim: *"The Affiliate never requests a Proovd withdrawal and never
 * receives Backer funds before Transfer creation."* There is no control to
 * refuse, so the sentence is what a person reads instead.
 */
export const EARNINGS_ARE_NOT_WITHDRAWN =
  'There is nothing to withdraw and nothing to request. When your work is verified and the campaign has reconciled, Proovd sends the money to your payout account — one transfer, on or after the third day after close.';

/**
 * The words no control on a Creator money surface may say.
 *
 * Scanned across every rendered button and link. `withdraw` is §22.1's own
 * refusal; the other two are the same act wearing a different verb, and a scan
 * that knew only the first would pass the screen that says the second.
 */
export const BANNED_MONEY_CONTROL_TERMS: readonly string[] = [
  'withdraw',
  'cash out',
  'request payout',
];

/**
 * Pinned. Renders on the tax-document line.
 *
 * The reference's `Get your tax docs` is right about where they come from and
 * wrong about who holds them: §11 forbids reproducing provider-controlled
 * fields and §30 defers a custom tax product. This is a route to Stripe, never
 * a Proovd form — and there is no form here to become one.
 */
export const TAX_DOCUMENTS_ARE_STRIPES =
  'Your tax documents come from Stripe, in the payout account you set up. Proovd does not hold them and has no copy to give you.';
