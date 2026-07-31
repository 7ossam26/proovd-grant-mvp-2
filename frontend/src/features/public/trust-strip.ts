/**
 * The homepage trust strip — Spec Appendix A.1, and the sentence immediately
 * after it.
 *
 * Appendix A.1 is exact-text mandatory. Its closing instruction is not
 * optional either: "Before production approval, replace the architecture
 * sentence with truthful conditional wording and do not imply approval." §2.1
 * puts it as a hard rule — no UI may claim approval before it exists — and
 * Track A1 (Stripe Connect underwriting) is open, so the conditional wording is
 * what ships today.
 *
 * Rather than keep two hand-maintained copies of the strip, the shipped text is
 * produced by replacing exactly one sentence in the verbatim Appendix A.1 text.
 * Everything else is verbatim by construction, not by proofreading — and
 * `public-site.test.tsx` asserts that the replacement actually took, so a typo
 * in the sentence being searched for fails the suite instead of silently
 * shipping the approval claim.
 *
 * When A1 closes, delete `A1_CONDITIONAL_SENTENCE` and let `TRUST_STRIP_TEXT`
 * be the Appendix text unmodified. Do not edit it for any other reason.
 *
 * The line breaks inside A.1's paragraphs are the Spec code block's hard wrap,
 * not content; paragraphs are joined here and re-wrapped by the browser.
 */

/** Appendix A.1, verbatim. Never edited. */
export const APPENDIX_A1_TEXT = [
  'How Proovd works behind the scenes.',
  'Proovd is a software platform for vetted-founder crowdfunding, operated by Proovd LLC (Delaware, USA). Every founder is vetted before launch. Proovd recruits content creators / affiliates / marketers for each specific campaign, and every campaign is manually reviewed by our team. Every reward package on every campaign discloses a delivery month and year.',
  "Backers' cards are not charged until an Idea Campaign meets its order threshold or a Product Campaign reaches its disclosed close date. Successful campaign charges are processed through Stripe Connect using the production configuration approved for Proovd. The founder remains the merchant of record on every transaction.",
  "Our Acceptable Use Policy mirrors Stripe's Prohibited and Restricted Businesses list.",
].join('\n\n');

/** The one sentence Appendix A.1 says to replace before production approval. */
export const A1_ARCHITECTURE_SENTENCE =
  'Successful campaign charges are processed through Stripe Connect using the production configuration approved for Proovd.';

/**
 * The replacement. Truthful, conditional, and it does not imply approval:
 * it states the future tense, names the approval as outstanding, and says what
 * follows from that being outstanding — that nothing is being collected today.
 */
export const A1_CONDITIONAL_SENTENCE =
  'Successful campaign charges will be processed through Stripe Connect under the production configuration Stripe approves for Proovd; that approval is not in place yet, so Proovd is not collecting card details and no campaign charge has been processed.';

export const TRUST_STRIP_TEXT = APPENDIX_A1_TEXT.replace(
  A1_ARCHITECTURE_SENTENCE,
  A1_CONDITIONAL_SENTENCE,
);

const [heading, ...paragraphs] = TRUST_STRIP_TEXT.split('\n\n');

export const TRUST_STRIP_HEADING = heading as string;
export const TRUST_STRIP_PARAGRAPHS: readonly string[] = paragraphs;

/**
 * A.1's two closing lines. The visible text keeps the `proovd.co/...` form the
 * Appendix fixes; the link resolves same-origin, because `app.proovd.co` owns
 * these routes and `proovd.co/<path>` redirects here (tech-stack §10).
 */
export const TRUST_STRIP_LINKS: readonly { prefix: string; url: string; href: string }[] = [
  {
    prefix: 'Read more about how payments work → ',
    url: 'proovd.co/how-payments-work',
    href: '/how-payments-work',
  },
  {
    prefix: 'Read our full safety controls → ',
    url: 'proovd.co/safety',
    href: '/safety',
  },
];
