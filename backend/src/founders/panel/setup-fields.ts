/**
 * `SETUP_FIELDS` — the register behind Campaign setup's Edit rows and the
 * Ready-to-launch recap, 2026-08-22.
 *
 * ── Why a register and not a column name in the URL ────────────────────────
 * `PATCH /api/admin/campaigns/:id/setup/:fieldKey` takes a KEY, never a table
 * or a column. A route that accepted a column name would record an override of
 * something that might not exist, and the trail would look complete while
 * pointing at nothing — the same reasoning `admin-founders.ts` records for its
 * overridable fields. Every key below resolves to exactly one table, one
 * column, one label, one materiality, and one refusal reason where the write is
 * not allowed at all.
 *
 * ── Absent with the reason, not disabled ───────────────────────────────────
 * §1.4's corollary: "a disabled control invites someone to work out how to
 * enable it, so prefer absent with the reason rendered where the control would
 * be." Fields that cannot be written through this route are still IN the
 * register, carrying `refusal` — so the surface can render the row and say why
 * there is no Edit button, rather than drawing one that fails.
 *
 * ── Materiality is derived from §20's register, never invented ─────────────
 * §15 makes the classification an Admin judgement, and §1 rule 6 forbids
 * inventing one. So `materiality` here is read off the §20 live-editing tier
 * that `campaign/editing-logic.ts` already carries:
 *
 *   `direct_versioned` → `non_material`
 *   `requires_review`  → `material_to_creator_terms`
 *   `never_direct`     → not writable through this route at all
 *
 * A field with no §20 entry has no live write path, so it is writable here only
 * before the campaign goes live, and `liveEditRefusal` says exactly that.
 *
 * ── What this route deliberately cannot write ──────────────────────────────
 *  · derived aggregates — Backers, reserved, clicks, posts (§33.8.13: an
 *    editable input is a second answer waiting to disagree with the resolver);
 *  · auto-populated Stripe fields (§26.2: "There is no route that writes an
 *    auto-populated field");
 *  · the three anchors and any business-day deadline (§29.6, trigger-immutable);
 *  · the campaign type (§33.1.7's trigger — a wrong type archives and restarts);
 *  · the platform cap and any §6 setting (versioned through
 *    `app_setting_versions`, not a one-field dialog);
 *  · locked listing-fee and tax records;
 *  · Creator compensation terms (§14.2 keeps those bilateral).
 *
 * ── §3.1 ───────────────────────────────────────────────────────────────────
 * The reference labels two rows "Founder order goal" and "Separate from goal".
 * `goal` is a banned token scanned across the built bundle (§33.11.3), and it
 * has been caught three times. The rows are named for the thing they actually
 * hold — the disclosed order threshold — in both the key and the label.
 */

import { tierFor, type EditSurface } from '../../campaign/editing-logic.js';

/* ── Shape ─────────────────────────────────────────────────────────────────── */

/** The three tables this route may write. Nothing else is reachable from it. */
export type SetupFieldTable = 'campaign_build' | 'campaign_faqs' | 'campaign_reward_packages';

/** How the wire value is read and how the stored value is rendered for the trail. */
export type SetupFieldKind = 'text' | 'cents' | 'integer' | 'date' | 'instant';

/** The two values `campaign_admin_field_edits.materiality` admits by CHECK. */
export type SetupFieldMateriality = 'non_material' | 'material_to_creator_terms';

export const SETUP_FIELD_GROUPS = [
  'brand_voice',
  'campaign_identity',
  'campaign_page',
  'refund_policy',
  'faqs',
  'rewards',
  'threshold_and_limits',
  'payout_and_publishing',
  'listing_fee',
  'creator_terms',
  'live_totals',
] as const;
export type SetupFieldGroupId = (typeof SETUP_FIELD_GROUPS)[number];

export const SETUP_FIELD_GROUP_LABELS: Record<SetupFieldGroupId, string> = {
  brand_voice: 'Brand voice',
  campaign_identity: 'Campaign identity',
  campaign_page: 'Campaign page',
  refund_policy: 'Product refunds page',
  faqs: 'Founder-authored FAQs',
  rewards: 'Founder-authored rewards',
  threshold_and_limits: 'Order threshold and system limits',
  payout_and_publishing: 'Payout and publishing checks',
  listing_fee: 'Listing fee, checkout and Stripe',
  creator_terms: 'Creator payment model',
  live_totals: 'Live campaign totals',
};

export interface SetupFieldDefinition {
  /** The stable register key. Row-scoped keys arrive as `<prefix>.<rowId>.<field>`. */
  key: string;
  label: string;
  group: SetupFieldGroupId;
  /** Null exactly when `refusal` is set. */
  table: SetupFieldTable | null;
  /** The Drizzle property name, not the snake_case column. Null when refused. */
  column: string | null;
  multiline: boolean;
  materiality: SetupFieldMateriality;
  kind: SetupFieldKind;
  /** True when the key carries a row id — one FAQ, one reward package. */
  rowScoped: boolean;
  maxLength: number | null;
  /** §20's register entry, when this field has one. */
  liveSurface: EditSurface | null;
  liveField: string | null;
  /** Present = no write path here, and this is what the surface renders instead. */
  refusal?: string;
}

/* ── Builders, so the repetition below cannot drift row to row ─────────────── */

function build(
  key: string,
  label: string,
  group: SetupFieldGroupId,
  column: string,
  opts: {
    multiline?: boolean;
    kind?: SetupFieldKind;
    maxLength?: number;
    materiality: SetupFieldMateriality;
    liveField?: string;
  },
): SetupFieldDefinition {
  return {
    key,
    label,
    group,
    table: 'campaign_build',
    column,
    multiline: opts.multiline ?? false,
    materiality: opts.materiality,
    kind: opts.kind ?? 'text',
    rowScoped: false,
    maxLength: opts.maxLength ?? 20000,
    liveSurface: opts.liveField ? 'build' : null,
    liveField: opts.liveField ?? null,
  };
}

function rowField(
  key: string,
  label: string,
  group: SetupFieldGroupId,
  table: SetupFieldTable,
  column: string,
  opts: {
    multiline?: boolean;
    kind?: SetupFieldKind;
    maxLength?: number;
    materiality: SetupFieldMateriality;
    liveSurface?: EditSurface;
    liveField?: string;
  },
): SetupFieldDefinition {
  return {
    key,
    label,
    group,
    table,
    column,
    multiline: opts.multiline ?? false,
    materiality: opts.materiality,
    kind: opts.kind ?? 'text',
    rowScoped: true,
    maxLength: opts.maxLength ?? 20000,
    liveSurface: opts.liveSurface ?? null,
    liveField: opts.liveField ?? null,
  };
}

function refused(
  key: string,
  label: string,
  group: SetupFieldGroupId,
  refusal: string,
): SetupFieldDefinition {
  return {
    key,
    label,
    group,
    table: null,
    column: null,
    multiline: false,
    // Recorded so the surface can still say what class of change this would be.
    materiality: 'material_to_creator_terms',
    kind: 'text',
    rowScoped: false,
    maxLength: null,
    liveSurface: null,
    liveField: null,
    refusal,
  };
}

/* ── The register ──────────────────────────────────────────────────────────── */

export const SETUP_FIELDS: readonly SetupFieldDefinition[] = [
  /* Brand voice — the reference's first setup group. */
  build('build.brand_voice', 'Final voice', 'brand_voice', 'brandVoice', {
    multiline: true,
    materiality: 'non_material',
    liveField: 'brandVoice',
  }),
  build('build.brand_perception', 'More context', 'brand_voice', 'brandPerception', {
    multiline: true,
    materiality: 'non_material',
    liveField: 'brandPerception',
  }),
  refused(
    'draft.brand_voice_prefills',
    'Original prefills',
    'brand_voice',
    'The two brand-voice descriptors are the invitation’s own prefills. They are edited on the Invite stage (PUT /api/admin/founders/:draftId/prefills), where the record they belong to lives.',
  ),

  /* Campaign identity. */
  build('build.title', 'Campaign title', 'campaign_identity', 'title', {
    maxLength: 500,
    materiality: 'material_to_creator_terms',
    liveField: 'title',
  }),
  build(
    'build.founder_display_name',
    'Founder display name',
    'campaign_identity',
    'founderDisplayName',
    { maxLength: 500, materiality: 'non_material' },
  ),
  build(
    'build.founder_entity_display',
    'Business display name',
    'campaign_identity',
    'founderEntityDisplay',
    { maxLength: 500, materiality: 'non_material' },
  ),
  build('build.founder_country', 'Founder country', 'campaign_identity', 'founderCountry', {
    maxLength: 200,
    materiality: 'non_material',
  }),
  build(
    'build.founder_profile_url',
    'Founder profile link',
    'campaign_identity',
    'founderProfileUrl',
    { maxLength: 2000, materiality: 'non_material', liveField: 'founderProfileUrl' },
  ),
  build('build.community_url', 'Community link', 'campaign_identity', 'communityUrl', {
    maxLength: 2000,
    materiality: 'non_material',
    liveField: 'communityUrl',
  }),

  /* Campaign page copy. */
  build('build.hero_headline', 'Hero headline', 'campaign_page', 'heroHeadline', {
    maxLength: 500,
    materiality: 'material_to_creator_terms',
    liveField: 'heroHeadline',
  }),
  build(
    'build.hero_headline_accent',
    'Hero headline accent',
    'campaign_page',
    'heroHeadlineAccent',
    { maxLength: 500, materiality: 'material_to_creator_terms', liveField: 'heroHeadlineAccent' },
  ),
  build('build.hero_subheadline', 'Hero subheadline', 'campaign_page', 'heroSubheadline', {
    multiline: true,
    materiality: 'material_to_creator_terms',
    liveField: 'heroSubheadline',
  }),
  build('build.founder_pull_quote', 'Founder pull quote', 'campaign_page', 'founderPullQuote', {
    multiline: true,
    materiality: 'material_to_creator_terms',
    liveField: 'founderPullQuote',
  }),
  build('build.platform_line', 'Platform line', 'campaign_page', 'platformLine', {
    maxLength: 500,
    materiality: 'material_to_creator_terms',
    liveField: 'platformLine',
  }),
  build('build.hero_preference', 'Hero preference', 'campaign_page', 'heroPreference', {
    multiline: true,
    materiality: 'non_material',
    liveField: 'heroPreference',
  }),
  build('build.demo_context_label', 'Demo context label', 'campaign_page', 'demoContextLabel', {
    maxLength: 200,
    materiality: 'non_material',
    liveField: 'demoContextLabel',
  }),
  build('build.benefits_heading', 'Benefits heading', 'campaign_page', 'benefitsHeading', {
    maxLength: 200,
    materiality: 'non_material',
    liveField: 'benefitsHeading',
  }),
  build('build.rewards_heading', 'Rewards heading', 'campaign_page', 'rewardsHeading', {
    maxLength: 200,
    materiality: 'non_material',
    liveField: 'rewardsHeading',
  }),
  build('build.updates_heading', 'Updates heading', 'campaign_page', 'updatesHeading', {
    maxLength: 200,
    materiality: 'non_material',
    liveField: 'updatesHeading',
  }),
  build('build.faq_heading', 'FAQ heading', 'campaign_page', 'faqHeading', {
    maxLength: 200,
    materiality: 'non_material',
    liveField: 'faqHeading',
  }),
  build('build.public_story', 'Founder story', 'campaign_page', 'publicStory', {
    multiline: true,
    materiality: 'material_to_creator_terms',
    liveField: 'publicStory',
  }),
  build('build.required_wording', 'Required wording', 'campaign_page', 'requiredWording', {
    multiline: true,
    materiality: 'material_to_creator_terms',
    liveField: 'requiredWording',
  }),
  build('build.prohibited_claims', 'Prohibited claims', 'campaign_page', 'prohibitedClaims', {
    multiline: true,
    materiality: 'material_to_creator_terms',
    liveField: 'prohibitedClaims',
  }),
  build('build.delivery_window', 'Delivery window', 'campaign_page', 'deliveryWindow', {
    maxLength: 500,
    materiality: 'material_to_creator_terms',
    liveField: 'deliveryWindow',
  }),
  build(
    'build.early_product_disclaimer',
    'Early product disclaimer',
    'campaign_page',
    'earlyProductDisclaimer',
    { multiline: true, materiality: 'material_to_creator_terms', liveField: 'earlyProductDisclaimer' },
  ),
  build('build.risks_and_challenges', 'Risks and challenges', 'campaign_page', 'risksAndChallenges', {
    multiline: true,
    materiality: 'material_to_creator_terms',
    liveField: 'risksAndChallenges',
  }),
  build('build.opens_at', 'Proposed open date', 'campaign_page', 'opensAt', {
    kind: 'instant',
    materiality: 'material_to_creator_terms',
    liveField: 'opensAt',
  }),
  build('build.closes_at', 'Proposed close date', 'campaign_page', 'closesAt', {
    kind: 'instant',
    materiality: 'material_to_creator_terms',
    liveField: 'closesAt',
  }),

  /* Product refunds page (§24 policy record on the build row). */
  build('build.refund_policy_title', 'Refunds page title', 'refund_policy', 'refundPolicyTitle', {
    maxLength: 500,
    materiality: 'material_to_creator_terms',
    liveField: 'refundPolicyTitle',
  }),
  build('build.refund_policy_text', 'Refunds page text', 'refund_policy', 'refundPolicyText', {
    multiline: true,
    materiality: 'material_to_creator_terms',
    liveField: 'refundPolicyText',
  }),
  build(
    'build.refund_policy_source_url',
    'Product refunds page',
    'refund_policy',
    'refundPolicySourceUrl',
    { maxLength: 2000, materiality: 'material_to_creator_terms', liveField: 'refundPolicySourceUrl' },
  ),
  build(
    'build.refund_policy_version',
    'Refunds page version',
    'refund_policy',
    'refundPolicyVersion',
    { maxLength: 200, materiality: 'material_to_creator_terms', liveField: 'refundPolicyVersion' },
  ),
  build(
    'build.refund_policy_effective_date',
    'Refunds page effective date',
    'refund_policy',
    'refundPolicyEffectiveDate',
    { kind: 'date', materiality: 'material_to_creator_terms', liveField: 'refundPolicyEffectiveDate' },
  ),

  /* FAQs — row-scoped: `faq.<faqId>.question`. */
  rowField('faq.question', 'Question', 'faqs', 'campaign_faqs', 'question', {
    maxLength: 500,
    materiality: 'non_material',
    liveSurface: 'faq',
    liveField: 'question',
  }),
  rowField('faq.answer', 'Answer', 'faqs', 'campaign_faqs', 'answer', {
    multiline: true,
    materiality: 'non_material',
    liveSurface: 'faq',
    liveField: 'answer',
  }),

  /* Rewards — row-scoped: `reward.<packageId>.price_cents`. */
  rowField('reward.title', 'Title', 'rewards', 'campaign_reward_packages', 'title', {
    maxLength: 500,
    materiality: 'material_to_creator_terms',
  }),
  rowField('reward.price_cents', 'Price', 'rewards', 'campaign_reward_packages', 'priceCents', {
    kind: 'cents',
    materiality: 'material_to_creator_terms',
    liveSurface: 'reward_package',
    liveField: 'priceCents',
  }),
  rowField('reward.delivery', 'Delivery', 'rewards', 'campaign_reward_packages', 'delivery', {
    maxLength: 500,
    materiality: 'material_to_creator_terms',
    liveSurface: 'reward_package',
    liveField: 'delivery',
  }),
  rowField('reward.contents', 'Description', 'rewards', 'campaign_reward_packages', 'contents', {
    multiline: true,
    materiality: 'material_to_creator_terms',
    liveSurface: 'reward_package',
    liveField: 'contents',
  }),
  rowField(
    'reward.fulfillment_commitment',
    'Fulfillment commitment',
    'rewards',
    'campaign_reward_packages',
    'fulfillmentCommitment',
    {
      multiline: true,
      materiality: 'material_to_creator_terms',
      liveSurface: 'reward_package',
      liveField: 'fulfillmentCommitment',
    },
  ),
  rowField('reward.badge', 'Badge', 'rewards', 'campaign_reward_packages', 'badge', {
    maxLength: 60,
    materiality: 'material_to_creator_terms',
    liveSurface: 'reward_package',
    liveField: 'badge',
  }),
  rowField(
    'reward.limited_quantity',
    'Limited quantity',
    'rewards',
    'campaign_reward_packages',
    'limitedQuantity',
    { kind: 'integer', materiality: 'material_to_creator_terms' },
  ),
  refused(
    'reward.sku',
    'Reward SKU',
    'rewards',
    'A reward SKU is the identifier every pre-order already carries. Renaming it here would leave the reservations pointing at a package that no longer answers to that name.',
  ),

  /* The order threshold and the system limits. §3.1: never the banned word. */
  refused(
    'build.order_threshold',
    'Founder order threshold',
    'threshold_and_limits',
    '§20 puts the disclosed order threshold in the never-direct column: it is the success rule Backers were shown and Creators were recruited against, so it cannot be changed from a one-field dialog. A change before launch goes through the build; after launch there is no path.',
  ),
  refused(
    'build.internal_target_cents',
    'Internal momentum target',
    'threshold_and_limits',
    '§20 puts the internal momentum target in the never-direct column. It is not a public promise, and it is not editable here.',
  ),
  refused(
    'campaign.type',
    'Campaign type',
    'threshold_and_limits',
    'The campaign type is locked by a database trigger once chosen (§33.1.7). A wrong type archives the campaign and restarts it; there is no migration path and no edit.',
  ),
  refused(
    'campaign.limit_cents',
    'Campaign limit',
    'threshold_and_limits',
    'The US$50,000 limit is a platform-wide §6 setting, versioned through `app_setting_versions`. It is not a per-campaign value, and a one-field dialog would bypass the version history that makes it auditable.',
  ),
  refused(
    'campaign.campaign_live_at',
    'Launch time',
    'threshold_and_limits',
    'The three campaign anchors are dedicated, trigger-immutable columns (§21, §29.6). A retry or an edit can never silently reset a deadline.',
  ),
  refused(
    'campaign.campaign_close_at',
    'Close time',
    'threshold_and_limits',
    'The close time is derived at launch and is trigger-immutable (§29.6). Changing it would move a deadline Backers and Creators were already told.',
  ),

  /* Payout and publishing checks. */
  refused(
    'campaign.stripe_account',
    'Stripe account',
    'payout_and_publishing',
    '§26.2: there is no route that writes an auto-populated field. The connected account comes from Stripe, and an Admin-typed value would be a second answer that disagrees with the provider.',
  ),
  refused(
    'campaign.stripe_status',
    'Stripe status',
    'payout_and_publishing',
    '§26.2: the onboarding status is read from Stripe on every request. Writing it here would let the panel claim a payment setup that does not exist (§1.4).',
  ),
  refused(
    'build.draft_version',
    'Draft campaign version',
    'payout_and_publishing',
    'The draft version is derived: every recorded edit through this route bumps it by one. Setting it by hand would break the only guarantee it offers, which is that it counts.',
  ),
  refused(
    'snapshot.published_version',
    'Public campaign version',
    'payout_and_publishing',
    'The published version is stamped onto the immutable approved snapshot at approval. The snapshot is the record of what was approved; it is not editable afterwards.',
  ),

  /* The listing-fee stream. */
  refused(
    'listing_fee.subtotal_cents',
    'Listing fee',
    'listing_fee',
    'The listing fee is a locked calculation derived from the five §12 optional items. Changing an optional item creates a new fee version and a new checkout link; there is no route that overrides the arithmetic.',
  ),
  refused(
    'listing_fee.tax_cents',
    'Tax',
    'listing_fee',
    'Tax is the provider’s calculation for the address at checkout. §24.3 keeps it outside every Proovd percentage, and no route substitutes a total.',
  ),

  /* Creator terms — §14.2 keeps these bilateral. */
  refused(
    'association.base_percent',
    'Creator percentage',
    'creator_terms',
    '§14.2 makes compensation bilateral: the Creator proposes and the Founder accepts. Admin can record an offer (POST …/affiliates/:associationId/offer), but no Admin route agrees on a party’s behalf.',
  ),
  refused(
    'association.fixed_payment_cents',
    'Fixed Creator payment',
    'creator_terms',
    'The fixed payment is the Creator’s request, accepted bilaterally through one §14.2 version. There is no Admin route that sets the amount.',
  ),
  refused(
    'association.founder_response',
    'Founder response',
    'creator_terms',
    'The association status is a nineteen-state machine with append-only history, and every illegal reversal is refused by a trigger (§23). A four-value select would flatten it and try to write a reversal.',
  ),

  /* Live totals — derived, never inputs. */
  refused(
    'live.backers',
    'Active Backers',
    'live_totals',
    '§33.8.13: a surface that recomputes or overrides a derived total is a second answer waiting to disagree with the resolver. Backer counts compose from the reservation rows.',
  ),
  refused(
    'live.reserved_cents',
    'Reserved before tax',
    'live_totals',
    'The reserved total composes from active pre-orders through `shared/money`, which has a one-implementation rule. There is no column to edit.',
  ),
  refused(
    'live.clicks',
    'Clicks',
    'live_totals',
    'Attribution clicks are recorded events. An editable input would overwrite measurement with an assertion.',
  ),
  refused(
    'live.posts',
    'Posts',
    'live_totals',
    'The post count composes from `creator_post_submissions`. An editable input would disagree with the submissions it counts.',
  ),
];

const BY_KEY = new Map<string, SetupFieldDefinition>(SETUP_FIELDS.map((f) => [f.key, f]));

export const SETUP_FIELD_KEYS: readonly string[] = SETUP_FIELDS.map((f) => f.key);

export function setupFieldByKey(key: string): SetupFieldDefinition | null {
  return BY_KEY.get(key) ?? null;
}

/* ── Resolving a wire key ──────────────────────────────────────────────────── */

const UUID_SHAPE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export interface ResolvedSetupField {
  definition: SetupFieldDefinition;
  /** The FAQ or reward-package id, for a row-scoped key. Null otherwise. */
  rowId: string | null;
}

/**
 * Reads `build.public_story` or `faq.<uuid>.answer` into a register entry.
 *
 * A row-scoped key carries its row id in the middle segment, so one register
 * entry describes every FAQ's Question rather than the register growing a row
 * per FAQ. An unknown key, a row id that is not a uuid, or a row id on a field
 * that is not row-scoped all resolve to null — the caller refuses rather than
 * guessing which of the three it was.
 */
export function resolveSetupField(rawKey: string): ResolvedSetupField | null {
  const direct = BY_KEY.get(rawKey);
  if (direct) return direct.rowScoped ? null : { definition: direct, rowId: null };

  const parts = rawKey.split('.');
  if (parts.length !== 3) return null;
  const [prefix, rowId, field] = parts as [string, string, string];
  if (!UUID_SHAPE.test(rowId)) return null;
  const definition = BY_KEY.get(`${prefix}.${field}`);
  if (!definition || !definition.rowScoped) return null;
  return { definition, rowId };
}

/* ── The live-editing gate ─────────────────────────────────────────────────── */

/**
 * Whether §20 permits this field to change once the campaign is live.
 *
 * The register in `campaign/editing-logic.ts` already answers this, and it is
 * the answer used rather than a second rule that could disagree with it:
 * `direct_versioned` is the only tier with a direct live write path. Everything
 * else — `requires_review`, `never_direct`, and any field §20 does not register
 * at all — is refused here, because the reacceptance machinery §15 requires
 * takes a classification and an affected-Creator list this route does not
 * collect, and inventing that list would be §1 rule 6.
 *
 * Returns the refusal sentence, or null when the write may proceed.
 */
export function liveEditRefusal(definition: SetupFieldDefinition): string | null {
  if (!definition.liveSurface || !definition.liveField) {
    return `§20 records no direct live-editing path for ${definition.label}, so it cannot be changed while the campaign is live.`;
  }
  let tier;
  try {
    tier = tierFor(definition.liveSurface, definition.liveField).tier;
  } catch {
    return `${definition.label} is not in the §20 live-editing register, so it has no live write path.`;
  }
  if (tier === 'direct_versioned') return null;
  if (tier === 'never_direct') {
    return `§20 puts ${definition.label} in the never-direct column. There is no path that changes it while the campaign is live.`;
  }
  return `§20 makes ${definition.label} a reviewed change while the campaign is live. §15 needs the materiality classification and the affected Creators recorded with it, and this dialog collects neither — use the live-editing review route.`;
}

/* ── Reading and writing values ────────────────────────────────────────────── */

export type SetupValueOutcome =
  | { ok: true; stored: unknown; rendered: string | null }
  | { ok: false; message: string };

/**
 * Turns the wire value into what the column stores, and into the text the edit
 * trail records.
 *
 * `null` and `''` both mean "cleared" — with one exception noted below — so an
 * Admin who emptied the box gets absence rather than a stored blank that reads
 * as a value whose text failed to load.
 */
export function coerceSetupValue(
  definition: SetupFieldDefinition,
  raw: unknown,
): SetupValueOutcome {
  if (raw === null || raw === undefined || raw === '') {
    return { ok: true, stored: null, rendered: null };
  }

  switch (definition.kind) {
    case 'cents': {
      const text = String(raw).trim();
      if (!/^\d+$/.test(text)) {
        return { ok: false, message: 'A price must be a whole number of cents, with no decimal point and no currency symbol.' };
      }
      const cents = BigInt(text);
      if (cents <= 0n) {
        return { ok: false, message: 'A reward price must be more than zero.' };
      }
      return { ok: true, stored: cents, rendered: cents.toString() };
    }
    case 'integer': {
      const text = String(raw).trim();
      if (!/^\d+$/.test(text)) {
        return { ok: false, message: 'That value must be a whole number that is not negative.' };
      }
      const n = Number(text);
      if (!Number.isSafeInteger(n)) {
        return { ok: false, message: 'That number is too large to store.' };
      }
      return { ok: true, stored: n, rendered: String(n) };
    }
    case 'date': {
      const text = String(raw).trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        return { ok: false, message: 'A date must be written as YYYY-MM-DD.' };
      }
      if (Number.isNaN(new Date(`${text}T00:00:00Z`).getTime())) {
        return { ok: false, message: 'That is not a real date.' };
      }
      return { ok: true, stored: text, rendered: text };
    }
    case 'instant': {
      const text = String(raw).trim();
      const at = new Date(text);
      if (Number.isNaN(at.getTime())) {
        return { ok: false, message: 'That is not a time this can read. Use an ISO 8601 timestamp.' };
      }
      return { ok: true, stored: at, rendered: at.toISOString() };
    }
    case 'text':
    default: {
      if (typeof raw !== 'string') {
        return { ok: false, message: 'That value must be text.' };
      }
      const limit = definition.maxLength ?? 20000;
      const trimmed = definition.multiline ? raw : raw.trim();
      if (trimmed.length > limit) {
        return { ok: false, message: `That value is longer than the ${limit} characters this field stores.` };
      }
      // A blank badge is no badge — stored as `''` it renders an empty chip,
      // which reads as a word that failed to load rather than as absence. The
      // same reasoning `upsertRewardPackage` already carries.
      if (trimmed === '') return { ok: true, stored: null, rendered: null };
      return { ok: true, stored: trimmed, rendered: trimmed };
    }
  }
}

/** The prior column value as the text `campaign_admin_field_edits` records. */
export function renderStoredValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}
