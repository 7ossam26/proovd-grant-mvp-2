/**
 * The §8 campaign-specific Affiliate prospect — the nineteen recorded facts.
 *
 * §8 lists what Admin records when recruiting. The list lives here for the same
 * reason the §6 settings register and the §31.4 policy register do: the Admin
 * surface renders it, the backend restates it as columns, and a drift test
 * fails the suite if the two disagree. A field that existed only in a form is a
 * field that quietly stops being collected.
 *
 * ── Grouping ───────────────────────────────────────────────────────────────
 * §8's bullets are grouped below by what they are *for*, because the surface
 * stages them that way (DNA §5.14: Glance → Act → Explore) and because the
 * groups have different rules. Identity and channel are what Proovd reviewed;
 * assessment is what Admin concluded; provenance is who did it and when.
 *
 * ── The quality tier, and why it is free text ──────────────────────────────
 * §8: "Internal quality tier, used only as assessment data—not as a commission
 * floor." That sentence is a constraint on the *type*, not just on the callers.
 *
 * An enum of ranked levels — bronze/silver/gold, 1/2/3 — is a value that can be
 * compared, sorted, and multiplied. The first time a later phase needs a
 * default percentage, a ranked tier is sitting right there, and §8's rule
 * becomes a code-review convention rather than a property of the data. Naming
 * the levels would also invent an eligibility scheme §8 does not state, which
 * §1 rule 6 forbids outright.
 *
 * So the tier is a note an Admin writes, with no ordering and no scale. It
 * cannot become a floor because there is nothing in it to compare. The §33.2.1
 * suite scans for a numeric or ranked tier reaching a money path; the shape
 * below is what makes that scan trivially pass rather than delicately pass.
 */

/**
 * §8's nineteen recorded facts, verbatim in the order §8 lists them.
 *
 * This is the coverage contract. The storable fields below are a finer grain —
 * two of these bullets name two things each ("full legal name and public-facing
 * name/handle", "recruitment source and recruiting Admin") and those are
 * genuinely separate columns, so there are twenty-one fields covering nineteen
 * facts. Keeping both lists means the drift test can assert what §8 actually
 * says rather than a number someone counted once.
 */
export const SPEC_8_FACTS = [
  'full_legal_name_and_public_handle',
  'email_and_phone',
  'channel_subtype',
  'channel_reference',
  'audience_niche_and_campaign_fit',
  'audience_size_or_access_metric',
  'engagement_evidence',
  'audience_demographics',
  'permission_or_ownership_basis',
  'prior_sponsored_content_and_compliance',
  'admin_written_bio',
  'internal_quality_tier',
  'verification_status_and_evidence',
  'recruitment_source_and_recruiting_admin',
  'associated_founder_and_campaign',
  'initial_roster_or_mid_campaign_intent',
  'conflict_notes',
  'sanctions_and_red_flag_notes',
  'internal_comments',
] as const;

export type Spec8Fact = (typeof SPEC_8_FACTS)[number];

/** The storable fields, in the order the surface presents them. */
export const RECRUITMENT_FIELD_IDS = [
  // Identity — who they are (§8, §5.3).
  'legalName',
  'publicHandle',
  'contact',
  // Channel — what Proovd reviewed (§8, §5.3).
  'channelSubtype',
  'channelReference',
  'audienceNiche',
  'audienceSize',
  'engagementEvidence',
  'audienceDemographics',
  'permissionBasis',
  'priorSponsoredContent',
  // Assessment — what Admin concluded (§8).
  'adminBio',
  'qualityTier',
  'verification',
  // Provenance — who recruited them, to what (§8, §25.4).
  'recruitmentSource',
  'recruitingAdmin',
  'campaignAssociation',
  'rosterIntent',
  // Risk (§8).
  'conflictNotes',
  'sanctionsNotes',
  'internalComments',
] as const;

export type RecruitmentFieldId = (typeof RECRUITMENT_FIELD_IDS)[number];

export type RecruitmentGroup = 'identity' | 'channel' | 'assessment' | 'provenance' | 'risk';

export interface RecruitmentFieldDefinition {
  id: RecruitmentFieldId;
  group: RecruitmentGroup;
  /** The §8 bullet this field records. Several fields may share one. */
  fact: Spec8Fact;
  label: string;
  /** Why §8 asks for it, in the words the Admin surface shows. */
  basis: string;
  /** §8 qualifies several with "where available"/"where relevant". */
  conditional?: boolean;
  /**
   * True when the value comes from the subtype's §5.3 evidence table rather
   * than from a field of its own.
   */
  fromSubtype?: boolean;
}

export const RECRUITMENT_FIELDS: readonly RecruitmentFieldDefinition[] = [
  {
    id: 'legalName',
    group: 'identity',
    fact: 'full_legal_name_and_public_handle',
    label: 'Full legal name',
    basis: 'The person who will personally claim the account. §5.3: an agency or manager cannot accept for the operator.',
  },
  {
    id: 'publicHandle',
    group: 'identity',
    fact: 'full_legal_name_and_public_handle',
    label: 'Public-facing name or handle',
    basis: 'What their audience knows them as. The Founder sees this on the roster card, never the legal name.',
  },
  {
    id: 'contact',
    group: 'identity',
    fact: 'email_and_phone',
    label: 'Email and phone',
    basis: 'The invitation goes to the email. Phone is collected and never verified (§5.3).',
  },
  {
    id: 'channelSubtype',
    group: 'channel',
    fact: 'channel_subtype',
    label: 'Channel subtype',
    basis: '§5.3 decides which verification evidence this prospect needs from its subtype.',
  },
  {
    id: 'channelReference',
    group: 'channel',
    fact: 'channel_reference',
    label: 'Primary URL, handle, or channel reference',
    basis: 'The public presence Proovd reviewed. The invitation names it back to them (§8).',
  },
  {
    id: 'audienceNiche',
    group: 'channel',
    fact: 'audience_niche_and_campaign_fit',
    label: 'Audience niche and campaign fit',
    basis: 'Why this Creator for this campaign. §10 forbids showing a Founder a matching score, so this is the reasoning, recorded.',
  },
  {
    id: 'audienceSize',
    group: 'channel',
    fact: 'audience_size_or_access_metric',
    label: 'Audience size or access metric',
    basis: 'The reach figure, in the unit its subtype measures in (§5.3).',
  },
  {
    id: 'engagementEvidence',
    group: 'channel',
    fact: 'engagement_evidence',
    label: 'Engagement evidence',
    basis: '§8: engagement, click, active-user, download, enrollment, rating, or other appropriate evidence. Its shape comes from the subtype.',
    fromSubtype: true,
  },
  {
    id: 'audienceDemographics',
    group: 'channel',
    fact: 'audience_demographics',
    label: 'Audience demographics',
    basis: 'Campaign fit, and the US-only launch limit (§2.2).',
    conditional: true,
  },
  {
    id: 'permissionBasis',
    group: 'channel',
    fact: 'permission_or_ownership_basis',
    label: 'Permission or ownership basis',
    basis: 'Whether they are entitled to promote on this channel at all. A community they moderate is not a community they own.',
  },
  {
    id: 'priorSponsoredContent',
    group: 'channel',
    fact: 'prior_sponsored_content_and_compliance',
    label: 'Prior sponsored content and compliance evidence',
    basis: 'Whether they have disclosed a sponsorship correctly before (§20).',
    conditional: true,
  },
  {
    id: 'adminBio',
    group: 'assessment',
    fact: 'admin_written_bio',
    label: 'Admin-written bio',
    basis: 'Prefills the signup and the Founder-facing card. §11 lets the Creator correct it, with the source labelled.',
  },
  {
    id: 'qualityTier',
    group: 'assessment',
    fact: 'internal_quality_tier',
    label: 'Internal quality tier',
    basis: 'Assessment data only. §8 forbids it acting as a commission floor, so it is a note with no scale — nothing can rank or compute on it.',
  },
  {
    id: 'verification',
    group: 'assessment',
    fact: 'verification_status_and_evidence',
    label: 'Verification status and evidence',
    basis: 'What was checked and what it rested on. The evidence inputs come from the subtype (§5.3).',
  },
  {
    id: 'recruitmentSource',
    group: 'provenance',
    fact: 'recruitment_source_and_recruiting_admin',
    label: 'Recruitment source',
    basis: 'How Proovd found them. §25.4 keeps it per campaign.',
  },
  {
    id: 'recruitingAdmin',
    group: 'provenance',
    fact: 'recruitment_source_and_recruiting_admin',
    label: 'Recruiting Admin',
    basis: 'The named person accountable for this recruitment (§1.3, §25.6).',
  },
  {
    id: 'campaignAssociation',
    group: 'provenance',
    fact: 'associated_founder_and_campaign',
    label: 'Associated Founder and campaign',
    basis: 'The one campaign this invitation is for. §11: the Creator stays tied to the campaign that caused it.',
  },
  {
    id: 'rosterIntent',
    group: 'provenance',
    fact: 'initial_roster_or_mid_campaign_intent',
    label: 'Initial-roster or mid-campaign intent',
    basis: '§23.4 stores this separately from the association status, because it is a designation and not a state.',
  },
  {
    id: 'conflictNotes',
    group: 'risk',
    fact: 'conflict_notes',
    label: 'Conflict notes',
    basis: 'A competing product, an existing relationship with the Founder, anything that would compromise the promotion.',
    conditional: true,
  },
  {
    id: 'sanctionsNotes',
    group: 'risk',
    fact: 'sanctions_and_red_flag_notes',
    label: 'Sanctions and red-flag notes',
    basis: 'Recorded at recruitment; the Creator confirms OFAC eligibility themselves at signup (§11).',
    conditional: true,
  },
  {
    id: 'internalComments',
    group: 'risk',
    fact: 'internal_comments',
    label: 'Internal comments',
    basis: 'Never leaves Admin. Not shown to the Founder or the Creator.',
    conditional: true,
  },
];

/**
 * §23.4: "Store initial-roster versus mid-campaign designation separately."
 * A designation, not a state — which is why it is its own column on the
 * association and its own value here.
 */
export const ROSTER_INTENTS = ['initial_roster', 'mid_campaign'] as const;

export type RosterIntent = (typeof ROSTER_INTENTS)[number];

/**
 * §8's verification status. Three values, and none of them means "verified
 * enough to skip the evidence" — `verified` requires the subtype's §5.3
 * evidence to be present, which `missingEvidence` decides.
 */
export const VERIFICATION_STATUSES = ['unverified', 'in_review', 'verified', 'rejected'] as const;

export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

/** Fields §8 requires before an invitation may be sent. */
export const REQUIRED_BEFORE_INVITE: readonly RecruitmentFieldId[] = RECRUITMENT_FIELDS.filter(
  (field) => !field.conditional && !field.fromSubtype,
).map((field) => field.id);
