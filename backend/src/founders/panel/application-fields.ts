/**
 * `APPLICATION_FIELDS` — the rows an Application-review change request may name.
 *
 * The Application review stage renders three sections of saved answers and puts
 * a `Request change` control on each row. §33.12.4's rule for overridable
 * fields applies here for the same reason it applies there: a route that
 * accepted any string would record a change request against a field that may
 * not exist, and the trail would look complete while pointing at nothing.
 *
 * ── This is not `SETUP_FIELDS` ─────────────────────────────────────────────
 * `SETUP_FIELDS` describes what an Admin may WRITE on the campaign, and it
 * resolves to a table and a column. This register describes what an Admin may
 * ASK THE FOUNDER to change on their application, and it resolves to nothing —
 * the request is a message about a row, not a write to it. Keeping them apart
 * is deliberate: several rows here (Password, Account standing, Email
 * verification) have no editable column at all, and putting them in a register
 * that maps to columns would imply one exists.
 *
 * ── No deep link is stored ─────────────────────────────────────────────────
 * §15's existing feedback route requires a deep link because a change with
 * nowhere to point is not actionable. The addresses of the Founder onboarding
 * screens live in the FRONTEND's flow register, which the backend cannot import
 * and must not restate — a hand-copied address is one that goes stale the first
 * time a screen moves, and "a control whose route does not exist is worse than
 * no control." The key is stable and the surface that owns the routes resolves
 * it.
 *
 * ── Branding is ONE §12 item shown as TWO rows ─────────────────────────────
 * §12 defines five optional items. The reference splits `branding` into
 * "Branding · logos" and "Branding · colors", so both entries below carry the
 * same `optionalItemKey`. Anything that reads the item — the −$2 listing-fee
 * effect above all — must read the one `campaign_optional_items` row through
 * that key, or the discount is claimed twice.
 */

export const APPLICATION_FIELD_GROUPS = [
  'founder_and_account',
  'campaign_answers',
  'optional_items',
] as const;
export type ApplicationFieldGroupId = (typeof APPLICATION_FIELD_GROUPS)[number];

/** The reference's own section headings, verbatim. */
export const APPLICATION_FIELD_GROUP_LABELS: Record<ApplicationFieldGroupId, string> = {
  founder_and_account: 'Founder and account',
  campaign_answers: 'Campaign answers',
  optional_items: 'Optional items',
};

export interface ApplicationFieldDefinition {
  key: string;
  label: string;
  group: ApplicationFieldGroupId;
  /** The §12 optional item this row reads, when it is one of the six. */
  optionalItemKey?: string;
}

export const APPLICATION_FIELDS: readonly ApplicationFieldDefinition[] = [
  /* Founder and account — nine rows. */
  { key: 'account.campaign_choice', label: 'Campaign choice', group: 'founder_and_account' },
  { key: 'account.email_verification', label: 'Email verification', group: 'founder_and_account' },
  { key: 'account.password', label: 'Password', group: 'founder_and_account' },
  { key: 'account.username', label: 'Username', group: 'founder_and_account' },
  { key: 'account.phone', label: 'Phone', group: 'founder_and_account' },
  { key: 'account.date_of_birth', label: 'Date of birth', group: 'founder_and_account' },
  { key: 'account.display_name', label: 'Display name', group: 'founder_and_account' },
  { key: 'account.legal_name', label: 'Legal name', group: 'founder_and_account' },
  { key: 'account.standing', label: 'Account standing', group: 'founder_and_account' },

  /* Campaign answers — six rows. */
  { key: 'answers.problem', label: 'Problem', group: 'campaign_answers' },
  { key: 'answers.solution', label: 'Solution', group: 'campaign_answers' },
  { key: 'answers.competition', label: 'Competition', group: 'campaign_answers' },
  { key: 'answers.views_count', label: 'Number of views', group: 'campaign_answers' },
  {
    key: 'answers.affiliate_matches',
    label: 'Possible affiliate matches',
    group: 'campaign_answers',
  },
  { key: 'answers.affiliate_type', label: 'Affiliate type', group: 'campaign_answers' },

  /* Optional items — six rows over five §12 items. */
  {
    key: 'optional.product_visuals',
    label: 'Product visuals',
    group: 'optional_items',
    optionalItemKey: 'visuals',
  },
  {
    key: 'optional.branding_logos',
    label: 'Branding · logos',
    group: 'optional_items',
    optionalItemKey: 'branding',
  },
  {
    key: 'optional.branding_colors',
    label: 'Branding · colors',
    group: 'optional_items',
    optionalItemKey: 'branding',
  },
  {
    key: 'optional.founder_interview',
    label: 'Founder interview',
    group: 'optional_items',
    optionalItemKey: 'interview',
  },
  {
    key: 'optional.founder_story',
    label: 'Founder story',
    group: 'optional_items',
    optionalItemKey: 'story',
  },
  {
    key: 'optional.social_links',
    label: 'Social links',
    group: 'optional_items',
    optionalItemKey: 'socials',
  },
];

const BY_KEY = new Map<string, ApplicationFieldDefinition>(
  APPLICATION_FIELDS.map((f) => [f.key, f]),
);

export const APPLICATION_FIELD_KEYS: readonly string[] = APPLICATION_FIELDS.map((f) => f.key);

export function applicationFieldByKey(key: string): ApplicationFieldDefinition | null {
  return BY_KEY.get(key) ?? null;
}
