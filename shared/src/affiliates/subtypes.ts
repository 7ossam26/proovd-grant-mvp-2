/**
 * Affiliate subtypes and their required verification evidence — Spec §5.3.
 *
 * §5.3 states the seven subtypes as a table with one evidence column, and §8
 * requires Admin to record "verification status and evidence" on the prospect.
 * Those two facts meet here: the subtype decides which evidence inputs the
 * recruitment surface asks for, and a prospect is not verifiable until the ones
 * its subtype names are present.
 *
 * ── Why the evidence list is data and not a form ────────────────────────────
 * The same reason the §31.4 policy register and the §6 settings register are
 * data. The acceptance suite asserts against this list, the Admin surface
 * renders from it, and the backend validates against a restated copy that is
 * drift-tested. A subtype whose required evidence lived in JSX would be a
 * subtype whose requirements changed the moment someone tidied the form.
 *
 * ── What "required" means here, and what it does not ────────────────────────
 * Required to record a *complete* verification, not required to create a
 * prospect. §8 has Admin build the record incrementally from public research,
 * and a channel that publishes no engagement numbers is a real recruitment case
 * — §5.3's own wording is "audit where appropriate". So the register names what
 * completeness looks like and `missingEvidence` reports the gap; it does not
 * refuse the row. Refusing would push Admin to type a placeholder into an
 * evidence field, which is worse than an honestly incomplete record (§1.4).
 *
 * The one thing this file must never grow is a compensation input. §8: internal
 * quality tier is "used only as assessment data—not as a commission floor."
 * There is no rate, no floor, no percentage, and no multiplier in this register,
 * and a later phase that reaches here for one has taken a wrong turn.
 */

/** §5.3's table, in the order it states them. */
export const AFFILIATE_SUBTYPES = [
  'social_creator',
  'newsletter_blog_operator',
  'podcast_host',
  'community_owner',
  'course_instructor',
  'student_affiliate',
  'niche_marketer',
] as const;

export type AffiliateSubtype = (typeof AFFILIATE_SUBTYPES)[number];

/**
 * One required evidence input, from §5.3's evidence column.
 *
 * `id` is what the record stores; `label` is what Admin reads. `basis` answers
 * "why is Proovd asking for this", which §5.3 implies and the surface states,
 * because an Admin who does not know what an input is for records something
 * that looks like it.
 */
export interface EvidenceInput {
  id: string;
  label: string;
  basis: string;
  /** §5.3 qualifies two of these with "where appropriate"/"need". */
  conditional?: boolean;
}

export interface AffiliateSubtypeDefinition {
  id: AffiliateSubtype;
  /** §3: what this is called in front of a person. Never `affiliate`. */
  label: string;
  /** The channel noun the recruitment surface uses in its prompts. */
  channelNoun: string;
  specRef: string;
  evidence: readonly EvidenceInput[];
}

export const AFFILIATE_SUBTYPE_DEFINITIONS: readonly AffiliateSubtypeDefinition[] = [
  {
    id: 'social_creator',
    label: 'Social creator',
    channelNoun: 'profile',
    specRef: '§5.3',
    evidence: [
      {
        id: 'platform',
        label: 'Platform',
        basis: 'Which network the audience is on. Decides what the other numbers mean.',
      },
      {
        id: 'followers',
        label: 'Followers',
        basis: 'The audience-size metric §8 requires on the prospect.',
      },
      {
        id: 'engagement',
        label: 'Engagement',
        basis: 'Reach without engagement does not move a campaign. §8 asks for the evidence, not the claim.',
      },
      {
        id: 'demographics',
        label: 'Audience demographics',
        basis: 'Campaign fit and the US-only launch limit (§2.2).',
        conditional: true,
      },
      {
        id: 'analytics',
        label: 'Analytics screenshot or export',
        basis: 'The source behind the numbers above.',
      },
      {
        id: 'audit',
        label: 'Third-party audience audit',
        basis: '§5.3: "audit where appropriate" — for follower counts that warrant checking.',
        conditional: true,
      },
    ],
  },
  {
    id: 'newsletter_blog_operator',
    label: 'Newsletter or blog operator',
    channelNoun: 'publication',
    specRef: '§5.3',
    evidence: [
      {
        id: 'subscribers',
        label: 'Subscribers',
        basis: 'The audience-size metric §8 requires on the prospect.',
      },
      {
        id: 'click_through',
        label: 'Click-through rate',
        basis: 'A newsletter that is opened and not clicked sends no traffic.',
      },
      {
        id: 'engagement',
        label: 'Open rate or other engagement',
        basis: 'The delivered-and-read half of the subscriber number.',
      },
      {
        id: 'prior_sponsored',
        label: 'Prior sponsored content',
        basis: '§8: prior sponsored content and compliance evidence.',
        conditional: true,
      },
    ],
  },
  {
    id: 'podcast_host',
    label: 'Podcast host',
    channelNoun: 'show',
    specRef: '§5.3',
    evidence: [
      {
        id: 'subscribers',
        label: 'Followers or subscribers',
        basis: 'The audience-size metric §8 requires on the prospect.',
      },
      {
        id: 'downloads',
        label: 'Downloads or listens per episode',
        basis: 'The metric an episode is actually measured by.',
      },
      {
        id: 'prior_sponsorships',
        label: 'Prior sponsorships',
        basis: '§8: prior sponsored content and compliance evidence.',
        conditional: true,
      },
    ],
  },
  {
    id: 'community_owner',
    label: 'Community owner',
    channelNoun: 'community',
    specRef: '§5.3',
    evidence: [
      {
        id: 'members',
        label: 'Members',
        basis: 'The audience-size metric §8 requires on the prospect.',
      },
      {
        id: 'active_users',
        label: 'Active-user or engagement indicators',
        basis: 'Membership counts include people who left without leaving.',
      },
      {
        id: 'rules_permission',
        label: 'Community rules and promotion permission',
        basis:
          '§5.3 names both. A community whose rules forbid promotion cannot carry a campaign, and §8 requires the permission/ownership basis.',
      },
    ],
  },
  {
    id: 'course_instructor',
    label: 'Course instructor',
    channelNoun: 'course',
    specRef: '§5.3',
    evidence: [
      {
        id: 'enrolled_students',
        label: 'Enrolled students',
        basis: 'The audience-size metric §8 requires on the prospect.',
      },
      {
        id: 'ratings',
        label: 'Ratings',
        basis: 'The standing that decides whether a recommendation carries.',
      },
      {
        id: 'platform_constraints',
        label: 'Platform constraints on promotion',
        basis:
          '§5.3 names them. Most course platforms restrict outbound promotion, and a constraint found after recruitment is a campaign with a hole in its roster.',
      },
    ],
  },
  {
    id: 'student_affiliate',
    label: 'Student affiliate or network distributor',
    channelNoun: 'network',
    specRef: '§5.3',
    evidence: [
      {
        id: 'kyc',
        label: 'Identity verification (KYC)',
        basis:
          '§5.3 names KYC for this subtype specifically. Stripe collects the identity data at onboarding; this records that Admin confirmed who they are.',
      },
      {
        id: 'handles',
        label: 'Handles',
        basis: 'The distribution surfaces this person actually controls.',
      },
      {
        id: 'promotion_plan',
        label: 'Written promotion plan',
        basis: '§5.3: a network distributor has no standing channel to inspect, so the plan is the evidence.',
      },
      {
        id: 'institution_disclaimer',
        label: 'Institution-disclaimer need',
        basis:
          '§5.3 names it. Promotion inside a school can read as institutional endorsement, and the disclaimer is what separates the two.',
        conditional: true,
      },
    ],
  },
  {
    id: 'niche_marketer',
    label: 'Niche marketer or distribution partner',
    channelNoun: 'channel',
    specRef: '§5.3',
    evidence: [
      {
        id: 'channel_access',
        label: 'Channel access',
        basis: 'What they can actually post to, as distinct from what they can reach.',
      },
      {
        id: 'identity_disclosed_presence',
        label: 'Identity-disclosed presence',
        basis:
          '§5.3 requires the presence to be identity-disclosed. An anonymous channel cannot carry a disclosed sponsorship (§20).',
      },
      {
        id: 'traffic_plan',
        label: 'Compliant traffic plan',
        basis: '§5.3: how the traffic is produced, in enough detail to tell whether it is compliant.',
      },
      {
        id: 'campaign_fit',
        label: 'Campaign-fit evidence',
        basis: '§8: audience niche and why this campaign fits.',
      },
    ],
  },
];

const BY_ID = new Map<AffiliateSubtype, AffiliateSubtypeDefinition>(
  AFFILIATE_SUBTYPE_DEFINITIONS.map((definition) => [definition.id, definition]),
);

export function affiliateSubtype(id: AffiliateSubtype): AffiliateSubtypeDefinition {
  const definition = BY_ID.get(id);
  if (!definition) throw new Error(`Unknown affiliate subtype: ${id}`);
  return definition;
}

/**
 * The evidence ids this subtype requires unconditionally.
 *
 * Conditional inputs are excluded: §5.3 qualifies them ("where appropriate",
 * "need"), and treating a qualified input as mandatory would make a complete
 * record impossible for a channel the Spec expects to recruit.
 */
export function requiredEvidenceIds(id: AffiliateSubtype): readonly string[] {
  return affiliateSubtype(id)
    .evidence.filter((input) => !input.conditional)
    .map((input) => input.id);
}

/**
 * What is still missing before this prospect's verification can be recorded as
 * complete. An empty array means the §5.3 evidence for the subtype is present —
 * it does not mean anyone has checked that the evidence is true. That judgement
 * is the recruiting Admin's, recorded as the verification status beside it.
 */
export function missingEvidence(
  id: AffiliateSubtype,
  recorded: Readonly<Record<string, unknown>> | null | undefined,
): readonly string[] {
  const present = recorded ?? {};
  return requiredEvidenceIds(id).filter((key) => {
    const value = present[key];
    if (value === null || value === undefined) return true;
    if (typeof value === 'string') return value.trim() === '';
    return false;
  });
}
