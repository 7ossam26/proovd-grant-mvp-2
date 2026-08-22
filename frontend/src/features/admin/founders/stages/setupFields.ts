/**
 * The field register the Campaign setup and Ready to launch stages both read.
 *
 * ── Why one register and not two lists ──────────────────────────────────────
 * Campaign setup shows 23 rows of the record; Ready to launch shows the whole
 * of it as 138. Eleven of those rows are the same stored value seen twice. Two
 * hand-written lists is one chance for the two screens to disagree about what a
 * field is called and where it is written, and the disagreement shows up as one
 * screen editing something the other one calls by another name.
 *
 * ── This is 1:1 with `ProovdAdminFounder.html` ──────────────────────────────
 * Group titles, row labels, sources, status words, control types, select
 * options and row order are the reference's, verbatim and in its order —
 * including `Founder order goal`, `Goal and system limits` and
 * `Separate from goal`, and including the 138 editable controls. The reference
 * is the authority on all of it.
 *
 * The one thing that is NOT taken from the reference is the DATA. The reference
 * ships a fixture (Maya Hassan, Stillday, three named Creators); every value
 * here is read from the workspace payload and the panel supplement, and a value
 * the record does not hold renders as an absence rather than as a plausible
 * default. That is the whole difference between the two.
 *
 * ── Money is never computed here ────────────────────────────────────────────
 * Amounts arrive resolved. The display rows format integer cents through the
 * shared `usd()` (which reads the digits of the `bigint` — no float, no
 * arithmetic), and the numeric launch inputs take the number the route already
 * resolved. Nothing in this file adds, multiplies, or takes a percentage of
 * anything: §24.3 keeps one implementation of the waterfall, and a surface that
 * computes is a second answer waiting to disagree with the ledger.
 */

import { PREFILL_AFFILIATE_TYPES, prefillAffiliateTypeLabel } from '@proovd/shared';
import type { FounderWorkspaceDetail } from '../api.js';
import { absoluteTime } from '../format.js';
import { panelItem, usd, type FounderPanel, type RecordTone } from './recordGroup.js';

/* ── The supplement ────────────────────────────────────────────────────────── */

/**
 * The three sections of `GET /api/admin/founder-panel/:prospectId` that the
 * four earlier stages do not read.
 *
 * It EXTENDS the shared `FounderPanel` rather than restating it: the route
 * composes one document, and the Admin prefills, the account verification
 * facts, the §12 optional items and the listing-fee calculation on it are the
 * same facts these two screens need. A second view of the same JSON with its
 * own copy of those keys is how two readers of one payload start disagreeing.
 *
 * Every member is optional, for the reason the shared type gives: a key that
 * has not arrived renders its own absence, never a zero or a blank.
 */
export interface FounderPanelSupplement extends FounderPanel {
  matching?: {
    /** The composed stage status. `Negotiating` is the reference's default. */
    status?: string | null;
    /** When the offer list last moved, as an ISO instant. */
    lastChange?: string | null;
    paymentModel?: PanelPaymentModel | null;
    offers?: PanelOffer[] | null;
    /** Roster rows that could take an offer. `GET …/affiliate-candidates`. */
    candidates?: PanelCandidate[] | null;
  } | null;

  setup?: {
    status?: string | null;
    draftVersion?: number | null;
    publishedVersion?: number | null;
    /** Keyed by the same field key `PATCH …/setup/:fieldKey` resolves. */
    fields?: Record<string, PanelFieldState> | null;
    faqs?: PanelFaq[] | null;
    rewards?: PanelReward[] | null;
  } | null;

  launch?: {
    status?: string | null;
    campaignVersion?: number | null;
    /**
     * Every launch-recap value the shared sections do not carry, already
     * resolved to the string or number its control shows. Amounts arrive as the
     * dollar figure the reference's inputs hold, not as cents — the recap edits
     * what the Founder typed, and converting in the browser would be the
     * surface doing money arithmetic.
     */
    values?: Record<string, string | number | null> | null;
    creators?: PanelOffer[] | null;
    faqs?: PanelFaq[] | null;
    rewards?: PanelReward[] | null;
  } | null;
}

/** Integer cents (§24.3), as a decimal string — JSON cannot carry a `bigint`. */
export type PanelCents = string | number;

export interface PanelPaymentModel {
  /** §14.3's own words for the cell — never recomposed here. */
  model?: string | null;
  baseCutPercent?: number | null;
  upfrontAmountCents?: PanelCents | null;
  representative?: string | null;
  status?: string | null;
}

/**
 * One row of the Founder-dashboard offer list.
 *
 * `associationId` is one campaign relationship and `prospectId` is the person.
 * Confusing the two is the mistake that routes money to a UUID nobody owns, so
 * both are carried and neither is derived from the other.
 */
export interface PanelOffer {
  associationId?: string | null;
  prospectId?: string | null;
  name?: string | null;
  handle?: string | null;
  fit?: string | null;
  followers?: string | null;
  reach?: string | null;
  engagement?: string | null;
  /** 3250 is 32.5%. Null where Admin has recorded no offer on this row. */
  offerBasisPoints?: number | null;
  offeredAt?: string | null;
  /** Composed by the route from the 19-state association enum. */
  founderResponse?: string | null;
  founderAcceptedAt?: string | null;
  /** Composed from `association_final_campaign_sends`. */
  finalCampaignStatus?: string | null;
  visibleInFounderDashboard?: boolean | null;
  bonus?: string | null;
  meeting?: string | null;
  backers?: number | null;
  reservedCents?: PanelCents | null;
  /** The reserved figure as the recap's own number input holds it. */
  reserved?: number | null;
  clicks?: number | null;
  posts?: string | null;
}

export interface PanelCandidate {
  associationId?: string | null;
  prospectId?: string | null;
  name?: string | null;
  handle?: string | null;
  /** True once a live offer exists, which is what disables the option. */
  offered?: boolean | null;
}

export interface PanelFaq {
  id?: string | null;
  question?: string | null;
  answer?: string | null;
}

export interface PanelReward {
  id?: string | null;
  title?: string | null;
  priceCents?: PanelCents | null;
  /** The price as the recap's number input holds it, resolved by the route. */
  price?: number | null;
  delivery?: string | null;
  description?: string | null;
}

/** The composed state of one Campaign setup row. */
export interface PanelFieldState {
  value?: string | null;
  status?: string | null;
  tone?: RecordTone | null;
  source?: string | null;
}

/**
 * The prop arrives as `unknown` for the same reason the shared reader takes it
 * that way: this file's optimistic view of the route can never fail a build
 * against whatever the panel client settles on.
 */
export function readSupplement(panel: unknown): FounderPanelSupplement {
  return panel && typeof panel === 'object' ? (panel as FounderPanelSupplement) : {};
}

export interface PanelContext {
  detail: FounderWorkspaceDetail;
  panel: FounderPanelSupplement;
}

/* ── Small readers ────────────────────────────────────────────────────────── */

/** `3250` → `"32.5%"`. Basis points are the stored form; percent is the read. */
export function percentFromBasisPoints(bp: number | null | undefined): string | null {
  if (bp === null || bp === undefined || !Number.isFinite(bp)) return null;
  return `${Number((bp / 100).toFixed(1))}%`;
}

/**
 * `"32.5"` → `3250`.
 *
 * Null for anything outside the reference's own 0.1–50 range, which is also
 * migration 0059's CHECK. The browser refusing early is a courtesy; the column
 * is what actually holds the line.
 */
export function basisPointsFromPercent(raw: string): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const bp = Math.round(n * 100);
  if (bp < 10 || bp > 5000) return null;
  return bp;
}

/** The nine prefill labels, read from the register rather than restated. */
export const PREFILL_AFFILIATE_TYPE_LABELS: readonly string[] = PREFILL_AFFILIATE_TYPES.map(
  (t) => t.label,
);

/* ── The reference's select vocabularies ──────────────────────────────────── */

export const ACCOUNT_STATUS_OPTIONS = [
  'Not claimed',
  'Email verified',
  'Password pending',
  'Active',
  'Warning',
  'Restricted',
  'Banned',
] as const;

export const CAMPAIGN_TYPE_OPTIONS = ['Idea Campaign', 'Product Campaign'] as const;

export const FOUNDER_RESPONSE_OPTIONS = ['Waiting', 'Accepted', 'Declined', 'Expired'] as const;

export const FINAL_CAMPAIGN_OPTIONS = [
  'Not sent',
  'Unopened',
  'Opened',
  'Reviewing',
  'Accepted',
  'Declined',
  'Timed out',
] as const;

export const SUCCESS_RULE_OPTIONS = ['USD', 'Backers'] as const;

/* ── Campaign setup: 23 rows in 5 groups ──────────────────────────────────── */

export type SetupAction = 'edit' | 'requestChange' | 'download';

export interface SetupRow {
  /** Stable key for `PATCH /api/admin/campaigns/:id/setup/:fieldKey`. */
  key: string;
  label: string;
  /** Null renders `absence` — never a blank cell. */
  value: string | null;
  absence?: string;
  source: string;
  status: string;
  tone: RecordTone;
  /** The reference's fixed order: Edit, Request change, View, Download. */
  actions: SetupAction[];
  /** A single stored value is an input; prose gets a writing surface. */
  multiline: boolean;
}

export interface SetupGroup {
  title: string;
  rows: SetupRow[];
}

function field(ctx: PanelContext, key: string): PanelFieldState {
  return ctx.panel.setup?.fields?.[key] ?? {};
}

function answer(ctx: PanelContext, key: string): string | null {
  return ctx.detail.overview.vetting.answers.find((a) => a.key === key)?.text ?? null;
}

function provenance(ctx: PanelContext, key: string): string | null {
  return ctx.detail.overview.vetting.answers.find((a) => a.key === key)?.provenance ?? null;
}

function blank(value: string | null | undefined): boolean {
  return (value ?? '').trim().length === 0;
}

function text(value: string | null | undefined): string | null {
  return blank(value) ? null : (value as string).trim();
}

/** What a cell says when the panel route did not compose the fact at all. */
const NOT_STATED = 'Not stated by this record';

/** The reference's `${n} of 6 descriptors`, counted off the saved value. */
function voiceDescriptorStatus(value: string | null | undefined): string {
  const words = (value ?? '')
    .split(',')
    .map((w) => w.trim())
    .filter(Boolean);
  return `${words.length} of 6 descriptors`;
}

export function buildSetupGroups(ctx: PanelContext): SetupGroup[] {
  const setup = ctx.panel.setup ?? null;
  const faqs = setup?.faqs ?? [];
  const rewards = setup?.rewards ?? [];

  const prefill = field(ctx, 'brandVoicePrefill');
  const prefilled =
    text(prefill.value) ??
    text(
      [ctx.panel.prefills?.brandVoice1, ctx.panel.prefills?.brandVoice2]
        .filter(Boolean)
        .join(', '),
    );
  const voice = field(ctx, 'brandVoice');
  const context = field(ctx, 'brandVoiceContext');

  const brandVoice: SetupRow[] = [
    {
      key: 'brandVoicePrefill',
      label: 'Original prefills',
      value: prefilled,
      absence: NOT_STATED,
      source: prefill.source ?? 'Admin prefill',
      status: prefill.status ?? 'Starting values',
      tone: prefill.tone ?? 'plain',
      actions: ['edit', 'requestChange'],
      multiline: false,
    },
    {
      key: 'brandVoice',
      label: 'Final voice',
      value: text(voice.value),
      absence: NOT_STATED,
      source: voice.source ?? 'Founder saved',
      status: voice.status ?? voiceDescriptorStatus(voice.value),
      tone: voice.tone ?? 'done',
      actions: ['edit', 'requestChange'],
      multiline: false,
    },
    {
      key: 'brandVoiceContext',
      label: 'More context',
      value: text(context.value),
      absence: NOT_STATED,
      source: context.source ?? 'Founder saved',
      status: context.status ?? 'Applied to campaign copy',
      tone: context.tone ?? 'done',
      actions: ['edit', 'requestChange'],
      multiline: true,
    },
  ];

  const target = field(ctx, 'founderOrderGoal');
  const rule = field(ctx, 'successRule');
  const limit = field(ctx, 'campaignLimit');

  const limits: SetupRow[] = [
    {
      key: 'founderOrderGoal',
      label: 'Founder order goal',
      value: usd(target.value) ?? text(target.value),
      absence: NOT_STATED,
      source: target.source ?? 'Founder input',
      status: target.status ?? 'Minimum input $500',
      tone: target.tone ?? 'done',
      actions: ['edit', 'requestChange'],
      multiline: false,
    },
    {
      key: 'successRule',
      label: 'Campaign success rule',
      value: text(rule.value),
      absence: NOT_STATED,
      source: rule.source ?? 'Campaign configuration',
      status: rule.status ?? 'Locked before launch',
      tone: rule.tone ?? 'done',
      actions: ['edit', 'requestChange'],
      multiline: false,
    },
    {
      key: 'campaignLimit',
      label: 'Campaign limit',
      value: usd(limit.value) ?? text(limit.value),
      absence: NOT_STATED,
      source: limit.source ?? 'System rule',
      status: limit.status ?? 'Separate from goal',
      tone: limit.tone ?? 'plain',
      actions: ['edit', 'requestChange'],
      multiline: false,
    },
  ];

  const faqRows: SetupRow[] = faqs.flatMap((faq, index) => [
    {
      key: `faq.${index}.question`,
      label: `FAQ ${index + 1} · Question`,
      value: text(faq.question),
      absence: 'Blank',
      source: 'Founder saved',
      status: blank(faq.question) ? 'Incomplete' : 'Complete',
      tone: (blank(faq.question) ? 'action' : 'done') as RecordTone,
      actions: ['edit', 'requestChange', 'download'] as SetupAction[],
      multiline: true,
    },
    {
      key: `faq.${index}.answer`,
      label: `FAQ ${index + 1} · Answer`,
      value: text(faq.answer),
      absence: 'Blank',
      source: 'Founder saved',
      status: blank(faq.answer) ? 'Incomplete' : 'Complete',
      tone: (blank(faq.answer) ? 'action' : 'done') as RecordTone,
      actions: ['edit', 'requestChange'] as SetupAction[],
      multiline: true,
    },
  ]);

  const rewardRows: SetupRow[] = rewards.flatMap((reward, index) => {
    const cell = (
      suffix: string,
      label: string,
      value: string | null,
      multiline: boolean,
    ): SetupRow => ({
      key: `reward.${index}.${suffix}`,
      label: `Reward ${index + 1} · ${label}`,
      value,
      absence: 'Blank',
      source: 'Founder saved',
      status: value === null ? 'Incomplete' : 'Complete',
      tone: (value === null ? 'action' : 'done') as RecordTone,
      actions: ['edit', 'requestChange'] as SetupAction[],
      multiline,
    });
    return [
      cell('title', 'Title', text(reward.title), false),
      cell('price', 'Price', usd(reward.priceCents), false),
      cell('delivery', 'Delivery', text(reward.delivery), false),
      cell('description', 'Description', text(reward.description), true),
    ];
  });

  const account = field(ctx, 'stripeAccount');
  const status = field(ctx, 'stripeStatus');
  const refunds = field(ctx, 'refundsUrl');
  const refundsUrl = text(refunds.value) ?? text(ctx.panel.persistentSetup?.refundsUrl);
  const draftVersion = setup?.draftVersion ?? ctx.detail.campaigns.current?.buildVersion ?? null;
  const publicVersion = setup?.publishedVersion ?? null;

  const checks: SetupRow[] = [
    {
      key: 'stripeAccount',
      label: 'Stripe account',
      value: text(account.value),
      absence: NOT_STATED,
      source: account.source ?? 'Stripe',
      status: account.status ?? 'Saved',
      tone: account.tone ?? 'plain',
      actions: ['edit', 'requestChange'],
      multiline: false,
    },
    {
      key: 'stripeStatus',
      label: 'Stripe status',
      value: text(status.value),
      absence: NOT_STATED,
      source: status.source ?? 'Stripe',
      status: status.status ?? text(status.value) ?? NOT_STATED,
      tone: status.tone ?? 'action',
      actions: ['edit', 'requestChange'],
      multiline: false,
    },
    {
      key: 'refundsUrl',
      label: 'Product refunds page',
      value: refundsUrl,
      absence: NOT_STATED,
      source: refunds.source ?? 'Founder saved',
      status: refunds.status ?? (refundsUrl ? 'Required URL present' : 'Missing blocker'),
      tone: refunds.tone ?? ((refundsUrl ? 'done' : 'action') as RecordTone),
      actions: ['edit', 'requestChange'],
      multiline: false,
    },
    {
      key: 'draftCampaignVersion',
      label: 'Draft campaign version',
      value: draftVersion === null ? null : String(draftVersion),
      absence: NOT_STATED,
      source: 'Versioned page',
      status: 'Draft',
      tone: 'plain',
      actions: ['edit', 'requestChange'],
      multiline: false,
    },
    {
      key: 'publicCampaignVersion',
      label: 'Public campaign version',
      value: publicVersion === null ? null : String(publicVersion),
      absence: NOT_STATED,
      source: 'Versioned page',
      status: 'Published',
      tone: draftVersion !== null && draftVersion === publicVersion ? 'done' : 'waiting',
      actions: ['edit', 'requestChange'],
      multiline: false,
    },
  ];

  return [
    { title: 'Brand voice', rows: brandVoice },
    { title: 'Goal and system limits', rows: limits },
    { title: 'Founder-authored FAQs', rows: faqRows },
    { title: 'Founder-authored rewards', rows: rewardRows },
    { title: 'Payout and publishing checks', rows: checks },
  ];
}

/* ── Ready to launch: 138 editable fields in 13 groups ────────────────────── */

export type LaunchControl = 'text' | 'number' | 'textarea' | 'select';

export interface LaunchField {
  /** Stable key for the setup patch route, and the React key for the row. */
  key: string;
  label: string;
  control: LaunchControl;
  /** The stored value, already rendered as the string its control shows. */
  value: string;
  options?: readonly string[];
  /** `Ot`'s optional qualifier under the control. */
  note?: string;
}

export interface LaunchGroup {
  /** Unique across the screen — two Creators can share a name. */
  id: string;
  title: string;
  fields: LaunchField[];
}

/**
 * The whole record, in the reference's own thirteen subjects and its own order,
 * every row an editable control.
 *
 * A function rather than a constant because six of the thirteen groups are
 * generated from the record — one per Creator, two rows per FAQ, four per
 * reward. The shapes are still data: nothing here renders, and the stage that
 * does render makes no decision this file has not already made.
 */
export function buildLaunchGroups(ctx: PanelContext): LaunchGroup[] {
  const { detail, panel } = ctx;
  const launch = panel.launch ?? null;
  const creators = launch?.creators ?? [];
  const faqs = launch?.faqs ?? [];
  const rewards = launch?.rewards ?? [];

  /**
   * The launch recap's own value bag first, then whatever the shared panel
   * sections already compose, then the workspace payload. One resolver, so a
   * field cannot read one source here and another on Campaign setup.
   */
  const v = (key: string, fallback?: string | number | null): string => {
    const raw = launch?.values?.[key];
    if (raw !== null && raw !== undefined && raw !== '') return String(raw);
    if (fallback === null || fallback === undefined || fallback === '') return '';
    return String(fallback);
  };

  const founderAndBusiness: LaunchField[] = [
    { key: 'founderName', label: 'Founder name', control: 'text', value: v('founderName', detail.header.preferredName) },
    { key: 'businessName', label: 'Business name', control: 'text', value: v('businessName', detail.header.businessName) },
    { key: 'username', label: 'Username', control: 'text', value: v('username', panel.prefills?.username) },
    { key: 'email', label: 'Email', control: 'text', value: v('email', detail.header.email) },
    { key: 'phone', label: 'Phone', control: 'text', value: v('phone', detail.header.phone) },
    {
      key: 'location',
      label: 'Location',
      control: 'text',
      value: v('location', [detail.header.state, detail.header.country].filter(Boolean).join(', ')),
    },
    { key: 'legalName', label: 'Legal name', control: 'text', value: v('legalName', detail.header.legalName) },
    { key: 'dateOfBirth', label: 'Date of birth', control: 'text', value: v('dateOfBirth', panel.account?.dateOfBirth) },
    {
      key: 'accountStatus',
      label: 'Account status',
      control: 'select',
      value: v('accountStatus', panel.account?.standing ?? detail.header.account),
      options: ACCOUNT_STATUS_OPTIONS,
    },
    { key: 'warningCount', label: 'Warning count', control: 'number', value: v('warningCount') },
    { key: 'recordOwner', label: 'Record owner', control: 'text', value: v('recordOwner', detail.overview.invitation.owner) },
    {
      key: 'lastActive',
      label: 'Last active',
      control: 'text',
      value: v('lastActive', detail.header.lastActiveAt ? absoluteTime(detail.header.lastActiveAt) : null),
    },
  ];

  const campaignIdentity: LaunchField[] = [
    { key: 'campaignName', label: 'Campaign name', control: 'text', value: v('campaignName', detail.campaigns.current?.name) },
    { key: 'product', label: 'Product', control: 'text', value: v('product') },
    {
      key: 'campaignType',
      label: 'Campaign type',
      control: 'select',
      value: v('campaignType', detail.campaigns.current?.type ?? detail.header.typeChip),
      options: CAMPAIGN_TYPE_OPTIONS,
    },
    { key: 'adminOwner', label: 'Admin owner', control: 'text', value: v('adminOwner', detail.overview.invitation.owner) },
  ];

  const inviteAndDiscovery: LaunchField[] = [
    { key: 'inviteName', label: 'Name', control: 'text', value: v('inviteName', detail.header.legalName) },
    { key: 'inviteBusinessName', label: 'Business Name', control: 'text', value: v('inviteBusinessName', detail.header.businessName) },
    { key: 'problem', label: 'Problem', control: 'textarea', value: v('problem', answer(ctx, 'problem')) },
    { key: 'solution', label: 'Solution', control: 'textarea', value: v('solution', answer(ctx, 'solution')) },
    { key: 'views', label: 'Number of views', control: 'number', value: v('views', panel.prefills?.viewsCount) },
    { key: 'inviteEmail', label: 'Email', control: 'text', value: v('inviteEmail', detail.header.email) },
    { key: 'inviteUsername', label: 'Username', control: 'text', value: v('inviteUsername', panel.prefills?.username) },
    {
      key: 'affiliateMatches',
      label: 'Affiliate matches',
      control: 'number',
      value: v('affiliateMatches', panel.prefills?.affiliateMatches),
    },
    {
      key: 'affiliateType',
      label: 'Affiliate type',
      control: 'select',
      value: v('affiliateType', prefillAffiliateTypeLabel(panel.prefills?.affiliateType)),
      options: PREFILL_AFFILIATE_TYPE_LABELS,
    },
    { key: 'voiceOne', label: 'Brand voice descriptor 1', control: 'text', value: v('voiceOne', panel.prefills?.brandVoice1) },
    { key: 'voiceTwo', label: 'Brand voice descriptor 2', control: 'text', value: v('voiceTwo', panel.prefills?.brandVoice2) },
    {
      key: 'inviteVersion',
      label: 'Invite version',
      control: 'number',
      value: v('inviteVersion', panel.invitation?.version ?? detail.overview.invitation.tokenVersion),
    },
    {
      key: 'inviteSentAt',
      label: 'Sent at',
      control: 'text',
      value: v('inviteSentAt', panel.invitation?.deliveryAt ? absoluteTime(panel.invitation.deliveryAt) : null),
    },
    { key: 'inviteOpenedAt', label: 'Opened at', control: 'text', value: v('inviteOpenedAt') },
    { key: 'inviteAcceptedAt', label: 'Accepted at', control: 'text', value: v('inviteAcceptedAt') },
    {
      key: 'inviteReminderCount',
      label: 'Reminder count',
      control: 'number',
      value: v('inviteReminderCount', panel.invitation?.reminders),
    },
  ];

  const visuals = panelItem(panel, 'visuals');
  const branding = panelItem(panel, 'branding');
  const interview = panelItem(panel, 'interview');
  const story = panelItem(panel, 'story');

  const applicationAndOnboarding: LaunchField[] = [
    {
      key: 'campaignChoiceStatus',
      label: 'Campaign choice status',
      control: 'text',
      value: v('campaignChoiceStatus', detail.overview.vetting.campaignType),
    },
    {
      key: 'emailVerificationStatus',
      label: 'Email verification status',
      control: 'text',
      value: v(
        'emailVerificationStatus',
        panel.account?.emailVerifiedAt ? absoluteTime(panel.account.emailVerifiedAt) : null,
      ),
    },
    {
      key: 'passwordStatus',
      label: 'Password status',
      control: 'text',
      value: v(
        'passwordStatus',
        panel.account?.passwordSetAt
          ? absoluteTime(panel.account.passwordSetAt)
          : detail.overview.signInMethod,
      ),
    },
    { key: 'problemOriginal', label: 'Original problem', control: 'textarea', value: v('problemOriginal') },
    { key: 'problemCurrent', label: 'Final problem', control: 'textarea', value: v('problemCurrent', answer(ctx, 'problem')) },
    { key: 'problemState', label: 'Problem status', control: 'text', value: v('problemState', provenance(ctx, 'problem')) },
    { key: 'solutionOriginal', label: 'Original solution', control: 'textarea', value: v('solutionOriginal') },
    { key: 'solutionCurrent', label: 'Final solution', control: 'textarea', value: v('solutionCurrent', answer(ctx, 'solution')) },
    { key: 'solutionState', label: 'Solution status', control: 'text', value: v('solutionState', provenance(ctx, 'solution')) },
    { key: 'competition', label: 'Competition', control: 'textarea', value: v('competition', answer(ctx, 'competition')) },
    {
      key: 'competitionState',
      label: 'Competition status',
      control: 'text',
      value: v('competitionState', provenance(ctx, 'competition')),
    },
    { key: 'visualFiles', label: 'Visual files', control: 'text', value: v('visualFiles', visuals?.content) },
    { key: 'logoFiles', label: 'Logo files', control: 'text', value: v('logoFiles', branding?.logo) },
    { key: 'brandColors', label: 'Brand colors', control: 'text', value: v('brandColors', branding?.colors) },
    {
      key: 'interviewPlatform',
      label: 'Interview platform',
      control: 'text',
      value: v('interviewPlatform', interview?.content),
    },
    { key: 'interviewTime', label: 'Interview time', control: 'text', value: v('interviewTime') },
    { key: 'founderStory', label: 'Founder story', control: 'textarea', value: v('founderStory', story?.content) },
    { key: 'instagram', label: 'Instagram', control: 'text', value: v('instagram') },
    { key: 'x', label: 'X', control: 'text', value: v('x') },
    { key: 'discord', label: 'Discord', control: 'text', value: v('discord') },
    { key: 'website', label: 'Website', control: 'text', value: v('website', detail.header.website) },
    {
      key: 'community',
      label: 'Community',
      control: 'text',
      value: v(
        'community',
        [panel.persistentSetup?.community?.choice, panel.persistentSetup?.community?.url]
          .filter(Boolean)
          .join(' · '),
      ),
    },
  ];

  const campaignPage: LaunchField[] = [
    {
      key: 'brandVoice',
      label: 'Final voice descriptors',
      control: 'text',
      value: v('brandVoice', panel.setup?.fields?.['brandVoice']?.value),
    },
    {
      key: 'brandVoiceContext',
      label: 'Brand voice context',
      control: 'textarea',
      value: v('brandVoiceContext', panel.setup?.fields?.['brandVoiceContext']?.value),
    },
    { key: 'founderOrderGoal', label: 'Founder order goal', control: 'number', value: v('founderOrderGoal') },
    {
      key: 'refundsUrl',
      label: 'Refunds page',
      control: 'text',
      value: v('refundsUrl', panel.persistentSetup?.refundsUrl),
    },
  ];

  const fee = panel.listingFee ?? null;
  const feeCheckoutStripe: LaunchField[] = [
    /* The two amounts are the numbers the route resolved. Nothing converts a
       cents column into dollars here — §24.3 keeps that in one place. */
    { key: 'listingFee', label: 'Listing fee', control: 'number', value: v('listingFee') },
    { key: 'listingTax', label: 'Tax', control: 'number', value: v('listingTax') },
    {
      key: 'checkoutStatus',
      label: 'Checkout status',
      control: 'text',
      value: v('checkoutStatus', fee?.status ?? detail.campaigns.current?.listing),
    },
    { key: 'transactionId', label: 'Transaction ID', control: 'text', value: v('transactionId', fee?.transactionId) },
    {
      key: 'paidAt',
      label: 'Paid at',
      control: 'text',
      value: v('paidAt', fee?.paidAt ? absoluteTime(fee.paidAt) : null),
    },
    {
      key: 'stripeAccount',
      label: 'Stripe account',
      control: 'text',
      value: v('stripeAccount', panel.setup?.fields?.['stripeAccount']?.value),
    },
    {
      key: 'stripeStatus',
      label: 'Stripe status',
      control: 'text',
      value: v('stripeStatus', panel.setup?.fields?.['stripeStatus']?.value),
    },
  ];

  const model = panel.matching?.paymentModel ?? null;
  const creatorPaymentModel: LaunchField[] = [
    {
      key: 'creatorPaymentModel',
      label: 'Creator payment model',
      control: 'text',
      value: v('creatorPaymentModel', model?.model),
    },
    {
      key: 'creatorBasePercent',
      label: 'Base Creator percentage',
      control: 'number',
      value: v('creatorBasePercent', model?.baseCutPercent),
    },
    { key: 'creatorUpfrontAmount', label: 'Upfront amount', control: 'number', value: v('creatorUpfrontAmount') },
    {
      key: 'creatorRepresentative',
      label: 'Representative',
      control: 'text',
      value: v('creatorRepresentative', model?.representative),
    },
    {
      key: 'creatorModelStatus',
      label: 'Payment model status',
      control: 'text',
      value: v('creatorModelStatus', model?.status),
    },
  ];

  const creatorGroups: LaunchGroup[] = creators.map((creator, index) => {
    const id = creator.associationId ?? creator.prospectId ?? `creator-${index}`;
    const f = (suffix: string, fallback?: string | number | null) =>
      v(`creator.${id}.${suffix}`, fallback);
    return {
      id: `creator-${id}`,
      title: `Creator · ${creator.name ?? 'Unnamed'}`,
      fields: [
        { key: `creator.${id}.name`, label: 'Name', control: 'text', value: f('name', creator.name) },
        { key: `creator.${id}.handle`, label: 'Handle', control: 'text', value: f('handle', creator.handle) },
        { key: `creator.${id}.followers`, label: 'Followers', control: 'text', value: f('followers', creator.followers) },
        { key: `creator.${id}.reach`, label: 'Reach', control: 'text', value: f('reach', creator.reach) },
        { key: `creator.${id}.engagement`, label: 'Engagement', control: 'text', value: f('engagement', creator.engagement) },
        { key: `creator.${id}.fit`, label: 'Fit notes', control: 'textarea', value: f('fit', creator.fit) },
        {
          key: `creator.${id}.offer`,
          label: 'Admin-set percentage',
          control: 'number',
          /* The stored form is basis points; the control shows the percentage
             the reference shows. Sending it back is the Matching route's job. */
          value: f(
            'offer',
            creator.offerBasisPoints === null || creator.offerBasisPoints === undefined
              ? null
              : creator.offerBasisPoints / 100,
          ),
        },
        {
          key: `creator.${id}.founderResponse`,
          label: 'Founder response',
          control: 'select',
          value: f('founderResponse', creator.founderResponse),
          options: FOUNDER_RESPONSE_OPTIONS,
        },
        {
          key: `creator.${id}.founderAcceptedAt`,
          label: 'Founder accepted at',
          control: 'text',
          value: f('founderAcceptedAt', creator.founderAcceptedAt),
        },
        {
          key: `creator.${id}.finalCampaignStatus`,
          label: 'Final campaign status',
          control: 'select',
          value: f('finalCampaignStatus', creator.finalCampaignStatus),
          options: FINAL_CAMPAIGN_OPTIONS,
        },
        { key: `creator.${id}.bonus`, label: 'Bonus', control: 'text', value: f('bonus', creator.bonus) },
        { key: `creator.${id}.meeting`, label: 'Meeting', control: 'text', value: f('meeting', creator.meeting) },
        { key: `creator.${id}.backers`, label: 'Backers', control: 'number', value: f('backers', creator.backers) },
        { key: `creator.${id}.reserved`, label: 'Reserved', control: 'number', value: f('reserved', creator.reserved) },
        { key: `creator.${id}.clicks`, label: 'Clicks', control: 'number', value: f('clicks', creator.clicks) },
        { key: `creator.${id}.posts`, label: 'Posts', control: 'text', value: f('posts', creator.posts) },
      ],
    };
  });

  const faqFields: LaunchField[] = faqs.flatMap((faq, index) => [
    {
      key: `faq.${index}.question`,
      label: `FAQ ${index + 1} · Question`,
      control: 'textarea' as LaunchControl,
      value: v(`faq.${index}.question`, faq.question),
    },
    {
      key: `faq.${index}.answer`,
      label: `FAQ ${index + 1} · Answer`,
      control: 'textarea' as LaunchControl,
      value: v(`faq.${index}.answer`, faq.answer),
    },
  ]);

  const rewardFields: LaunchField[] = rewards.flatMap((reward, index) => [
    {
      key: `reward.${index}.title`,
      label: `Reward ${index + 1} · Title`,
      control: 'text' as LaunchControl,
      value: v(`reward.${index}.title`, reward.title),
    },
    {
      key: `reward.${index}.price`,
      label: `Reward ${index + 1} · Price`,
      control: 'number' as LaunchControl,
      value: v(`reward.${index}.price`, reward.price),
    },
    {
      key: `reward.${index}.delivery`,
      label: `Reward ${index + 1} · Delivery`,
      control: 'text' as LaunchControl,
      value: v(`reward.${index}.delivery`, reward.delivery),
    },
    {
      key: `reward.${index}.description`,
      label: `Reward ${index + 1} · Description`,
      control: 'textarea' as LaunchControl,
      value: v(`reward.${index}.description`, reward.description),
    },
  ]);

  const launchTiming: LaunchField[] = [
    {
      key: 'draftCampaignVersion',
      label: 'Draft campaign version',
      control: 'number',
      value: v('draftCampaignVersion', panel.setup?.draftVersion ?? detail.campaigns.current?.buildVersion),
    },
    {
      key: 'publishedCampaignVersion',
      label: 'Published campaign version',
      control: 'number',
      value: v('publishedCampaignVersion', panel.setup?.publishedVersion),
    },
    {
      key: 'proposedCampaignVersion',
      label: 'Proposed campaign version',
      control: 'number',
      value: v('proposedCampaignVersion'),
    },
    {
      key: 'launchTime',
      label: 'Launch time',
      control: 'text',
      value: v('launchTime', detail.campaigns.current?.opensAt ? absoluteTime(detail.campaigns.current.opensAt) : null),
    },
    {
      key: 'closeTime',
      label: 'Close time',
      control: 'text',
      value: v('closeTime', detail.campaigns.current?.closesAt ? absoluteTime(detail.campaigns.current.closesAt) : null),
    },
    {
      key: 'successRuleKind',
      label: 'Success rule type',
      control: 'select',
      value: v('successRuleKind'),
      options: SUCCESS_RULE_OPTIONS,
    },
    { key: 'successRuleValue', label: 'Success rule value', control: 'number', value: v('successRuleValue') },
    { key: 'campaignLimit', label: 'Campaign limit', control: 'number', value: v('campaignLimit') },
  ];

  return [
    { id: 'founder-and-business', title: 'Founder and business', fields: founderAndBusiness },
    { id: 'campaign-identity', title: 'Campaign identity', fields: campaignIdentity },
    { id: 'invite-and-discovery', title: 'Invite and discovery', fields: inviteAndDiscovery },
    {
      id: 'application-and-onboarding',
      title: 'Application and onboarding',
      fields: applicationAndOnboarding,
    },
    { id: 'campaign-page', title: 'Campaign page', fields: campaignPage },
    {
      id: 'fee-checkout-stripe',
      title: 'Listing fee, Checkout and Stripe',
      fields: feeCheckoutStripe,
    },
    { id: 'creator-payment-model', title: 'Creator payment model', fields: creatorPaymentModel },
    ...creatorGroups,
    { id: 'faqs', title: 'FAQs', fields: faqFields },
    { id: 'rewards', title: 'Rewards', fields: rewardFields },
    { id: 'launch-timing', title: 'Launch timing and rules', fields: launchTiming },
  ];
}
