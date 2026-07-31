/**
 * The canonical policy register — Spec §18, §31.4, §29.8, §34.
 *
 * §18 and §31.4 require every policy route to carry the complete canonical
 * approved text: no placeholder, no `coming soon`, no summary-only content at
 * launch. That text is Track A2 — eight legal documents under counsel review —
 * and it is not something this repository may author. Spec §1 rule 6 forbids
 * inventing it, and §31.4 forbids shipping a summary in its place.
 *
 * So this file is the *register*, not the text. Each document has a durable
 * identity, a version, a status, and — once published — an effective date, a
 * plain-language overview, and the canonical body. Until then the record is
 * `draft`, which means exactly three things:
 *
 *   1. the route still renders, honestly, as a document in legal review;
 *   2. nothing on it presents itself as final;
 *   3. `draft` blocks §34's fourth condition ("all canonical policy files are
 *      complete and consistent"). Phase 24 releases that gate by publishing —
 *      never by routing around it.
 *
 * The version identifier is the durable part. Consent records cite it from
 * Phase 15 on, and §29.8's reacceptance flow compares it. The backend's
 * `policy_versions` table mirrors this register row-for-row; a drift test in
 * `backend/src/tests/policy-versions.test.ts` fails the suite if they diverge.
 *
 * `coverage` is the §31.4 required-contents list for each document, restated
 * in customer-facing language (§3.1: `Creator`, not `affiliate`). It says what
 * the document will govern. It is never rendered as, or in place of, the
 * policy itself.
 */

export type PolicyStatus = 'draft' | 'published';

export interface PolicySection {
  heading: string;
  paragraphs: readonly string[];
}

export interface PolicyDocument {
  /** Stable identifier. Consent records cite `slug` + `version`. */
  slug: string;
  /** The §18 public route this document is published at. */
  route: string;
  title: string;
  /**
   * Durable version identifier. A published document's text never changes
   * under a version — a change is a new version, which is what §29.8 compares
   * and what a reacceptance decision is made against.
   */
  version: string;
  status: PolicyStatus;
  /** ISO calendar date. `null` while the document is unpublished. */
  effectiveDate: string | null;
  /** The Spec section that defines this document's required contents. */
  specRef: string;
  /** §31.4's required coverage, in customer-facing language. Never the policy. */
  coverage: readonly string[];
  /** DNA §5.12 Glance overview. Published documents only. */
  overview: string | null;
  /** The complete canonical text. Published documents only. */
  body: readonly PolicySection[] | null;
}

/**
 * The version every document carries until counsel signs off. The prerelease
 * suffix is not decoration: a consent record may only cite a `published`
 * version, and this string exists so a draft can be *identified* — in the
 * register, in Admin, and in the §34 gate — without ever being citable.
 */
const UNPUBLISHED_VERSION = '1.0.0-draft';

function unpublished(
  document: Omit<PolicyDocument, 'version' | 'status' | 'effectiveDate' | 'overview' | 'body'>,
): PolicyDocument {
  return {
    ...document,
    version: UNPUBLISHED_VERSION,
    status: 'draft',
    effectiveDate: null,
    overview: null,
    body: null,
  };
}

/**
 * The eight canonical documents of §31.4, at the eight §18 policy routes.
 *
 * The Creator-facing documents keep the `/affiliate-aup` and `/ip-agreement`
 * routes §18 fixes, but their titles use the customer-facing name: §3.1 makes
 * `Creator` the name a Founder or a distribution partner reads, and `affiliate`
 * an internal one. §3.1 permits exactly this split for the `sample-pre-build`
 * and `sample-pre-launch` URLs, and the same reasoning governs here.
 */
export const POLICY_DOCUMENTS: readonly PolicyDocument[] = [
  unpublished({
    slug: 'terms',
    route: '/terms',
    title: 'Terms of Service',
    specRef: '§31.4',
    coverage: [
      'Proovd’s role as the software platform, and the Founder’s role as the seller and merchant of record on every campaign transaction.',
      'Both campaign models — an Idea Campaign, which charges only if it reaches its order threshold, and a Product Campaign, which charges every active pre-order on its close date.',
      'The Founder listing fee, and when Proovd refunds it.',
      'Proovd’s 5% campaign fee.',
      'Creators: who they are, how they are recruited for one campaign, and how they are compensated.',
      'Saving a card now and the single later charge it authorizes.',
      'How support and disputes are allocated between the Founder and Proovd.',
      'Delaware governing law, limitations of liability, and how to contact us.',
    ],
  }),
  unpublished({
    slug: 'privacy',
    route: '/privacy',
    title: 'Privacy Policy',
    specRef: '§31.4, §28.4',
    coverage: [
      'What each role — Founder, Creator, Backer — gives us, and why.',
      'The limited operational sharing with the Founder that placing a pre-order requires, and what it covers.',
      'The separate, optional, unchecked consent for Founder marketing, research, and survey contact.',
      'That a Creator never receives Backer personal information.',
      'What is shared with Stripe, and what is shared for tax purposes.',
      'Your rights over your data, how long records are kept, and international transfers.',
    ],
  }),
  unpublished({
    slug: 'cookies',
    route: '/cookies',
    title: 'Cookie Policy',
    specRef: '§31.4, §18',
    coverage: [
      'The first-party Creator attribution cookie: what it records, and that it expires when the campaign closes.',
      'Session and security cookies.',
      'Cookies set by our providers.',
      'The choices you have — described to match what this site actually sets, not a generic list.',
    ],
  }),
  unpublished({
    slug: 'refunds',
    route: '/refunds',
    title: 'Refund Policy',
    specRef: '§31.4, §24.8–24.10',
    coverage: [
      'Cancelling a pre-order before the close date, at no cost.',
      'An Idea Campaign that does not reach its order threshold: no charge is made at all.',
      'The defined exceptions that still apply after a valid charge — duplicate, wrong, cancelled, unauthorized, materially misrepresented, applicable non-delivery, serious-violation, legal, Stripe, and card-issuer cases.',
      'A Product Campaign’s Founder refund policy, fixed at the version disclosed when you pre-ordered.',
      'Delays and rewards that are not as described.',
      'Listing-fee refunds: no eligible Creator recruited, no replacement made available, and Founder cancellation.',
      'Which statement descriptor to look for, and how long a refund takes to appear.',
    ],
  }),
  unpublished({
    slug: 'fulfillment',
    route: '/fulfillment',
    title: 'Fulfillment Policy',
    specRef: '§31.4, §22.5',
    coverage: [
      'How digital rewards are delivered — login, invitation, access key, redemption code, subscription access, or download.',
      'Delivery dates and delivery windows, and which campaign model uses which.',
      'The communications you receive from the Founder and from Proovd.',
      'What happens when a delivery date changes, including seeing the prior and revised commitment together.',
      'Late delivery, and how to get support.',
    ],
  }),
  unpublished({
    slug: 'aup',
    route: '/aup',
    title: 'Founder Acceptable Use Policy',
    specRef: '§31.4, §2.3',
    coverage: [
      'The current prohibited and restricted categories, which mirror Stripe’s Prohibited and Restricted Businesses list.',
      'Digital-only rewards, and the sanctions rules that apply.',
      'Truthful claims, and the evidence needed to support them.',
      'Delivery, refund, and communication obligations, and the process for changing a delivery date.',
      'Authorization for reversal and recovery when a charge is reversed.',
      'The W-9 requirement, conflicts of interest, and suspension.',
      'The one-strike ban for abandoning Backers after a campaign is funded.',
      'A guaranty from the people behind an entity Founder where counsel requires one, and how this policy is updated.',
    ],
  }),
  unpublished({
    slug: 'affiliate-aup',
    route: '/affiliate-aup',
    title: 'Creator Acceptable Use Policy',
    specRef: '§31.4, §29',
    coverage: [
      'Your status as an independent marketer, not an employee or agent of Proovd or of the Founder.',
      'Sanctions screening, identity checks, and the audience evidence we ask for.',
      'FTC disclosure rules and the rules of the channels you post on.',
      'Compensation, how it is paid out, and your tax responsibilities.',
      'The ban on pre-ordering the campaign you are promoting.',
      'The cap on how many campaigns you may be active on at once.',
      'The one-month restriction on directly competing campaigns, and conflicts of interest.',
      'How you must handle campaign data.',
      'Termination, appeal, reverification, indemnification, and cause-based remedies.',
    ],
  }),
  unpublished({
    slug: 'ip-agreement',
    route: '/ip-agreement',
    title: 'Creator IP and Confidentiality Agreement',
    specRef: '§31.5',
    coverage: [
      'One agreement for each campaign you agree to promote, accepted by click.',
      'Confidentiality, and non-replication of a substantially similar product, for two years after the campaign ends or the partnership terminates.',
      'What the Founder keeps: the concept and the promotional materials.',
      'What you keep: your pre-existing intellectual property and your own creative contribution.',
      'The limited, non-transferable, revocable licence to use campaign materials while you are actively promoting.',
      'That content you lawfully published may stay live after the campaign ends, and may be referenced in your portfolio or a case study.',
      'The private preparing kit you may preview before signing — which is access, not permission to start work.',
    ],
  }),
] as const;

export const POLICY_SLUGS: readonly string[] = POLICY_DOCUMENTS.map((d) => d.slug);
export const POLICY_ROUTES: readonly string[] = POLICY_DOCUMENTS.map((d) => d.route);

export function findPolicyDocument(slug: string): PolicyDocument | undefined {
  return POLICY_DOCUMENTS.find((d) => d.slug === slug);
}

export function findPolicyDocumentByRoute(route: string): PolicyDocument | undefined {
  return POLICY_DOCUMENTS.find((d) => d.route === route);
}

export function draftPolicyDocuments(): readonly PolicyDocument[] {
  return POLICY_DOCUMENTS.filter((d) => d.status === 'draft');
}

/**
 * §34 condition 4 — "all canonical policy files are complete and consistent".
 * True while any document is still unpublished. The authoritative check runs
 * against the database (`backend/src/policies/policy-gate.ts`); this is the
 * same question answered from the register, for the frontend and for tests.
 */
export function policyGateBlocked(): boolean {
  return draftPolicyDocuments().length > 0;
}

/**
 * A version a consent record may cite. §29.8 compares versions to decide
 * whether reacceptance is required, and an unpublished document has no
 * effective date to compare against — so citing one is a bug, not a state.
 */
export function isCitableVersion(document: PolicyDocument): boolean {
  return document.status === 'published' && document.effectiveDate !== null;
}
