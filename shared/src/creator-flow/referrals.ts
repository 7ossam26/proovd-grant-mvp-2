/**
 * The Creator referral — Creator Flow v2 **deviation 3**, Session A, 2026-08-19.
 *
 * ═══ A RECORDED DEVIATION FROM §1 RULE 6, BY EXPLICIT PRODUCT DIRECTION ═════
 *
 * The reference's Home draws `Refer other affiliates`, `Bring an affiliate
 * you'd vouch for and earn a percentage of their campaigns`, and the URL
 * `proovd.co/join/mohab`.
 *
 * §5.3: *"No open public signup. Enters only through a private,
 * campaign-specific invitation."* §8: *"No generic Affiliate credential email
 * and no public signup exist."*
 *
 * ── The record is an INTRODUCTION, not a signup route ──────────────────────
 * A referral produces an **Admin task** naming who vouched for whom. Recruitment
 * stays §8's — an Admin researches the person, records the §5.3 evidence, and
 * decides — and the invitation stays campaign-specific. The link creates no
 * account, no `affiliate_prospects` row, and no association: it opens a form an
 * Admin reads, not a route that admits anybody.
 *
 * That is what keeps §5.3's first sentence true. The person referred still
 * enters exactly the way everybody else does, and if nobody recruits them,
 * nothing happens.
 *
 * ── `earn a percentage of their campaigns` is REFUSED OUTRIGHT ─────────────
 * §24 defines four money streams — campaign charges, the listing fee, the fixed
 * Creator payment, and the Creator commission — and this would be a fifth,
 * paid out of somebody else's campaign, to a person with no association to it.
 * It is not narrowed or deferred; it does not exist, and the enforcement is
 * that `affiliate_referrals` has **no amount, percentage, or commission
 * column**, asserted as an exact column set the way 0052's openness record is.
 *
 * ── What a later phase must not read this as licence for ───────────────────
 * Not a public join page. Not a referral commission. Not an affiliate-of-
 * affiliate tree.
 */

/**
 * What a referral records. Five facts, and none of them is money.
 *
 * `relationship` and `why` are the two an Admin actually needs to decide
 * whether to research somebody — §8's recruitment record asks the same two
 * questions in its own words — and asking for them at the point of referral is
 * what makes this a vouch rather than an address harvest.
 */
export const CREATOR_REFERRAL_FIELDS = [
  {
    id: 'referred_name',
    label: 'Their name',
    required: true,
  },
  {
    id: 'referred_contact',
    label: 'How to reach them',
    required: true,
    help: 'An email, or a link to the channel they run.',
  },
  {
    id: 'relationship',
    label: 'How you know them',
    required: true,
    help: 'One line. An Admin reads this before deciding whether to look into it.',
  },
  {
    id: 'why',
    label: 'Why you would vouch for them',
    required: true,
    help: 'What they cover, and who listens.',
  },
  {
    id: 'note',
    label: 'Anything else',
    required: false,
  },
] as const;

export type CreatorReferralFieldId = (typeof CREATOR_REFERRAL_FIELDS)[number]['id'];

/**
 * The lifecycle of a referral, from the referrer's side.
 *
 * Three states and no fourth. There is deliberately no `accepted` or `joined`:
 * whether the person was eventually recruited is §8's record, and reporting it
 * back here would tell a Creator about somebody else's admission decision —
 * and would make the referral feel like a pipeline with an outcome, which is
 * the shape a commission would need.
 */
export const CREATOR_REFERRAL_STATES = ['recorded', 'reviewed', 'closed'] as const;

export type CreatorReferralState = (typeof CREATOR_REFERRAL_STATES)[number];

export const CREATOR_REFERRAL_STATE_LABELS: Record<CreatorReferralState, string> = {
  recorded: 'Sent to Proovd',
  reviewed: 'Read by our team',
  closed: 'Closed',
};

/* ── The pinned sentences ─────────────────────────────────────────────────── */

/**
 * Pinned. Renders BESIDE the referral control, not in a disclosure below it.
 *
 * The reference's own copy promises a percentage. Anybody who has seen a
 * referral programme before will assume one exists unless the control says
 * otherwise, and the place to say it is where the control is.
 */
export const REFERRAL_PAYS_NOTHING =
  'There is no referral payment. Proovd pays for campaign work through your agreed campaign terms and nothing else. This is a way to point us at somebody good.';

/**
 * Pinned. Renders under the referral form.
 *
 * The honest description of what happens next, in §27.1's shape: what happened,
 * what is next, who owns it. It is also what stops the form reading as an
 * invitation the Creator is sending.
 */
export const REFERRAL_IS_AN_INTRODUCTION =
  'We will look them up the same way we found you. We do not email them on your behalf, and being referred does not create an account or guarantee an invitation.';

/**
 * Pinned. Renders where the reference put `proovd.co/join/mohab`.
 *
 * §5.3's first sentence, stated on the one surface that would otherwise imply
 * the opposite. There is no public join address, so there is no link to copy —
 * and a link-shaped thing that opened a form for an Admin would still read as
 * a signup route to everybody who saw it.
 */
export const REFERRAL_HAS_NO_PUBLIC_LINK =
  'There is no public sign-up link to share. Creators only ever join through a private invitation to a specific campaign, which is how you joined.';
