/**
 * The public site's inventory and its fixed facts — Spec §18, §27.8, §31.4.
 *
 * One list, read by the router, the header, the footer, and the content-QA
 * suite. §33.11.6 tests for broken links; a second copy of this list is how a
 * footer link outlives the route it points at, so there is exactly one.
 *
 * ── Canonical origin (tech-stack §10) ──────────────────────────────────────
 * `proovd.co` is the marketing home and stays on its own repository.
 * `app.proovd.co` — this repository — owns every route below, including the
 * ones that read like marketing. That is not a preference: §18's attribution
 * contract sets a first-party cookie on Creator-link arrival and reads it at
 * pre-order, so the campaign page, the checkout, the policy routes, and the
 * magic-link surface must share one origin or Safari and Chrome will drop it
 * and Creator compensation will be computed from nothing.
 *
 * The recorded decision: `proovd.co/<path>` 301-redirects to
 * `app.proovd.co/<path>` for every path in this inventory except `/`, which
 * stays the marketing home. It is written down in README.md as well as here,
 * because it is a DNS-level decision that outlives any one file.
 */

export const APP_ORIGIN = 'https://app.proovd.co';
export const MARKETING_ORIGIN = 'https://proovd.co';

export const LEGAL_ENTITY = 'Proovd LLC';
export const SUPPORT_EMAIL = 'support@proovd.co';

/**
 * Spec §27.8, exact text. Every line is rendered verbatim; the email line's
 * address becomes a `mailto:` link whose visible text is unchanged.
 * `public-site.test.tsx` compares the rendered footer against this constant.
 */
export const SERVICE_SLA_BLOCK = [
  'Contact Proovd',
  'Email: support@proovd.co',
  'We respond within one (1) business day, Monday–Friday, excluding U.S. federal holidays.',
  'Postal: Proovd LLC, 254 Chapman Rd, Ste 208 #27541, Newark, DE 19702, USA.',
] as const;

/**
 * §31.4 requires the footer to link to the Stripe Connected Account Agreement.
 * It is Stripe's document at Stripe's URL — not something Proovd republishes.
 */
export const STRIPE_CONNECTED_ACCOUNT_AGREEMENT =
  'https://stripe.com/connect-account/legal';

export type PublicRouteKind = 'site' | 'policy' | 'sample';

export interface PublicRoute {
  path: string;
  /** The link text used in navigation. §33.11.4: names the actual destination. */
  label: string;
  kind: PublicRouteKind;
}

/**
 * §18's public route inventory. All fourteen. The route shape for approved live
 * campaigns — `/campaign/:slug` — is deliberately absent: Phase 14 fills it,
 * and a route that resolves to nothing is a broken link today.
 */
export const PUBLIC_ROUTES: readonly PublicRoute[] = [
  { path: '/', label: 'Home', kind: 'site' },
  { path: '/about', label: 'About Proovd', kind: 'site' },
  { path: '/how-payments-work', label: 'How payments work', kind: 'site' },
  { path: '/safety', label: 'Safety', kind: 'site' },
  { path: '/terms', label: 'Terms of Service', kind: 'policy' },
  { path: '/privacy', label: 'Privacy Policy', kind: 'policy' },
  { path: '/cookies', label: 'Cookie Policy', kind: 'policy' },
  { path: '/refunds', label: 'Refund Policy', kind: 'policy' },
  { path: '/fulfillment', label: 'Fulfillment Policy', kind: 'policy' },
  { path: '/aup', label: 'Founder Acceptable Use Policy', kind: 'policy' },
  { path: '/affiliate-aup', label: 'Creator Acceptable Use Policy', kind: 'policy' },
  { path: '/ip-agreement', label: 'Creator IP and Confidentiality Agreement', kind: 'policy' },
  { path: '/campaign/sample-pre-build', label: 'Sample Idea Campaign', kind: 'sample' },
  { path: '/campaign/sample-pre-launch', label: 'Sample Product Campaign', kind: 'sample' },
] as const;

export const PUBLIC_ROUTE_PATHS: readonly string[] = PUBLIC_ROUTES.map((r) => r.path);

/**
 * The account doors — §5.1, §5.2, §5.3, §5.5.
 *
 * Deliberately NOT in `PUBLIC_ROUTES`. That list is §18's own inventory of the
 * public *site*, its length is fixed at fourteen, and the acceptance suite
 * sweeps every entry for banned vocabulary, heading structure, landmarks, and
 * axe violations as a public marketing page. A sign-in form is none of those
 * things: it has no §18 content requirement, and adding it would change a
 * count the Spec fixes.
 *
 * It still has to be *linkable*, which is what `LINKABLE_ROUTE_PATHS` below is
 * for — §33.11.6 asks that every rendered link resolve to a route that exists,
 * and §18's inventory only stood in for "every route that exists" while the
 * site was the whole app.
 *
 * `/campaigns` and `/creator/campaigns` are not here: they are session-scoped
 * destinations reached by signing in, never linked from a public page.
 */
export const ACCOUNT_ROUTES: readonly PublicRoute[] = [
  { path: '/signin', label: 'Sign in', kind: 'site' },
  { path: '/reset-password', label: 'Reset your password', kind: 'site' },
] as const;

export const ACCOUNT_ROUTE_PATHS: readonly string[] = ACCOUNT_ROUTES.map((r) => r.path);

/**
 * Every in-app path a rendered link may legitimately point at. The §33.11.6
 * broken-link scan reads this rather than `PUBLIC_ROUTE_PATHS`, so a link to a
 * real route is not reported as broken and a link to a route that does not
 * exist still is.
 */
export const LINKABLE_ROUTE_PATHS: readonly string[] = [
  ...PUBLIC_ROUTE_PATHS,
  ...ACCOUNT_ROUTE_PATHS,
];

/** The primary wayfinding row in the header — the rest lives in the footer. */
export const HEADER_ROUTES: readonly PublicRoute[] = PUBLIC_ROUTES.filter((r) =>
  ['/how-payments-work', '/safety', '/about'].includes(r.path),
);

/**
 * §31.4's required footer links, in the order that section lists them. The
 * footer renders these plus the rest of the inventory as a sitemap — §31.4
 * states a floor, and a public site that hides half its own routes fails
 * DNA §5.12's "the way to anywhere is one gesture from everywhere".
 */
export const REQUIRED_FOOTER_LINKS: readonly { label: string; href: string; external?: boolean }[] =
  [
    { label: 'Terms of Service', href: '/terms' },
    { label: 'Privacy Policy', href: '/privacy' },
    { label: 'Cookie Policy', href: '/cookies' },
    { label: 'Refund Policy', href: '/refunds' },
    { label: 'Fulfillment Policy', href: '/fulfillment' },
    { label: 'Founder Acceptable Use Policy', href: '/aup' },
    {
      label: 'Stripe Connected Account Agreement',
      href: STRIPE_CONNECTED_ACCOUNT_AGREEMENT,
      external: true,
    },
    { label: 'How payments work', href: '/how-payments-work' },
    { label: 'Safety', href: '/safety' },
  ];
