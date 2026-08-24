/**
 * Phase 05 acceptance suite — Spec §33.11.3, §33.11.4, §33.11.6, §33.11.7,
 * with partial credit toward §33.11.5 and §34's sample-campaign condition.
 *
 * These are §33's own words: requirements, not examples. The scans below walk
 * every registered public route, because a banned word on one page
 * is a banned word on the site.
 */

import { describe, it, expect } from 'vitest';
import { render, within } from '@testing-library/react';
import { POLICY_DOCUMENTS, findPolicyDocument } from '@proovd/shared';
import { renderRoute, normalize, anchors } from './test-harness.js';
import { PageLoading } from './states.js';
import {
  LINKABLE_ROUTE_PATHS,
  PUBLIC_ROUTE_PATHS,
  REQUIRED_FOOTER_LINKS,
  SERVICE_SLA_BLOCK,
  STRIPE_CONNECTED_ACCOUNT_AGREEMENT,
} from './site.js';
import {
  A1_ARCHITECTURE_SENTENCE,
  A1_CONDITIONAL_SENTENCE,
  APPENDIX_A1_TEXT,
  TRUST_STRIP_TEXT,
} from './trust-strip.js';
import { SAMPLE_BANNER } from './campaign/consent.js';
import { SAMPLE_IDEA_CAMPAIGN, SAMPLE_PRODUCT_CAMPAIGN } from './campaign/campaign.test-fixtures.js';

/* ══════════════════════════════════════════════════════════ §18 route inventory */

describe('§18 public route inventory', () => {
  it.each(PUBLIC_ROUTE_PATHS)('%s resolves and renders a complete surface', (path) => {
    const { container } = renderRoute(path);
    // A page, not a shell: one h1, a header, and the §31.4 footer.
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    expect(container.querySelector('header.site-header')).not.toBeNull();
    expect(container.querySelector('footer.site-footer')).not.toBeNull();
    expect(normalize(container.textContent).length).toBeGreaterThan(400);
  });

  it('ships only the twelve real static public pages', () => {
    expect(PUBLIC_ROUTE_PATHS).toHaveLength(12);
    expect(PUBLIC_ROUTE_PATHS.some((path) => path.includes('sample'))).toBe(false);
  });

  it('does not advertise or link to example campaigns', () => {
    for (const path of ['/', '/about']) {
      const { container, unmount } = renderRoute(path);
      expect(anchors(container).some((link) => link.href.includes('sample-pre-'))).toBe(false);
      expect(normalize(container.textContent)).not.toMatch(/sample campaign/i);
      unmount();
    }
  });

  it('answers an unknown address with a recovery surface, not a blank page', () => {
    const { container, getByRole } = renderRoute('/no-such-page');
    expect(getByRole('heading', { level: 1 })).toHaveTextContent(
      /how.d you get here/i,
    );
    expect(container.querySelector('header.site-header')).toBeNull();
    expect(container.querySelector('footer.site-footer')).toBeNull();
    expect(container.querySelector('img[src="/assets/404.webp"]')).not.toBeNull();
    expect(normalize(container.textContent)).toContain('nothing has been charged');
    expect(getByRole('link', { name: /go to the Proovd homepage/i })).toBeInTheDocument();
  });
});

/* ══════════════════════════════════════════════ §18 homepage + Appendix A.1 */

describe('homepage trust content (§18, Appendix A.1)', () => {
  it('carries every §18 homepage item', () => {
    const { container } = renderRoute('/');
    const text = normalize(container.textContent);

    expect(text).toMatch(/crowdfunding software for vetted founders/i);
    expect(text).toContain('Idea Campaign');
    expect(text).toContain('Product Campaign');
    expect(text).toMatch(/reviewed by a person/i); // manual Founder/campaign/Creator review
    expect(text).toMatch(/Every Creator/i);
    expect(text).toMatch(/digital only/i);
    expect(text).toMatch(/card is saved|save a card|saves a card/i);
    expect(text).toMatch(/merchant of record/i);
    expect(text).toContain('Stripe Connect');
    // Role-based calls to action for both recruited roles.
    expect(text).toContain('Ask for a Founder invitation');
    expect(text).toContain('Ask about promoting a campaign');
  });

  it('renders Appendix A.1 with only the architecture sentence replaced', () => {
    const { container } = renderRoute('/');
    const text = normalize(container.textContent);

    // Everything except the one replaced sentence is verbatim.
    for (const paragraph of APPENDIX_A1_TEXT.split('\n\n')) {
      if (paragraph.includes(A1_ARCHITECTURE_SENTENCE)) continue;
      expect(text).toContain(normalize(paragraph));
    }
    // The replacement actually took — a typo in the search string would leave
    // the approval claim in place, which is what this guards.
    expect(TRUST_STRIP_TEXT).not.toContain(A1_ARCHITECTURE_SENTENCE);
    expect(TRUST_STRIP_TEXT).toContain(A1_CONDITIONAL_SENTENCE);
    expect(text).toContain(normalize(A1_CONDITIONAL_SENTENCE));
  });

  it('never claims Stripe production approval anywhere on the site (§2.1)', () => {
    for (const path of PUBLIC_ROUTE_PATHS) {
      const { container, unmount } = renderRoute(path);
      const text = normalize(container.textContent);
      expect(text, path).not.toContain('configuration approved for Proovd');
      expect(text, path).not.toMatch(/Proovd is approved by Stripe/i);
      expect(text, path).not.toMatch(/Stripe.approved platform/i);
      unmount();
    }
  });

  it('links the A.1 closing lines to the routes this origin owns', () => {
    const { container } = renderRoute('/');
    const found = anchors(container);
    expect(found).toContainEqual({
      href: '/how-payments-work',
      text: 'proovd.co/how-payments-work',
    });
    expect(found).toContainEqual({ href: '/safety', text: 'proovd.co/safety' });
  });
});

/* ══════════════════════════════════════════════════════ §31.4 / §27.8 footer */

describe('footer (§31.4, §27.8)', () => {
  it('renders the §27.8 contact block as exact text', () => {
    const { container } = renderRoute('/');
    const footer = container.querySelector('footer.site-footer') as HTMLElement;
    const contact = footer.querySelector('.site-footer__contact') as HTMLElement;
    const lines = [
      normalize(contact.querySelector('.site-footer__heading')?.textContent),
      ...[...contact.querySelectorAll('.site-footer__line')].map((el) =>
        normalize(el.textContent),
      ),
    ];
    expect(lines).toEqual(SERVICE_SLA_BLOCK.map(normalize));
  });

  it('carries every §31.4 required link, on every public route', () => {
    for (const path of PUBLIC_ROUTE_PATHS) {
      const { container, unmount } = renderRoute(path);
      const footer = container.querySelector('footer.site-footer') as HTMLElement;
      for (const link of REQUIRED_FOOTER_LINKS) {
        expect(
          within(footer).getByRole('link', { name: new RegExp(link.label, 'i') }),
          `${link.label} on ${path}`,
        ).toHaveAttribute('href', link.href);
      }
      unmount();
    }
  });

  it('sends the Stripe Connected Account Agreement to Stripe, safely', () => {
    const { container } = renderRoute('/');
    const link = within(
      container.querySelector('footer.site-footer') as HTMLElement,
    ).getByRole('link', { name: /Stripe Connected Account Agreement/i });
    expect(link).toHaveAttribute('href', STRIPE_CONNECTED_ACCOUNT_AGREEMENT);
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('names the legal entity and the merchant-of-record split', () => {
    const { container } = renderRoute('/');
    const footer = normalize(
      (container.querySelector('footer.site-footer') as HTMLElement).textContent,
    );
    expect(footer).toContain('Proovd LLC');
    expect(footer).toContain('merchant of record');
  });

  it('links to every public route from the header or the footer', () => {
    const { container } = renderRoute('/');
    const hrefs = new Set(anchors(container).map((a) => a.href));
    for (const path of PUBLIC_ROUTE_PATHS) {
      expect(hrefs.has(path), `no link to ${path}`).toBe(true);
    }
  });
});

/* ════════════════════════════════════════════════════════════════ §33.11.3 */

/**
 * §3.1's never-render list, §3.2's replacement table, and §33.11.3's own
 * additions. Word-boundary matched, because "pre-order" must not trip on
 * "pre-build" and "Creator" must not trip on anything.
 */
const BANNED_TERMS: Array<{ pattern: RegExp; why: string }> = [
  { pattern: /\bpledge[sd]?\b/i, why: '§3.2 — say reserve a pre-order' },
  { pattern: /\bdonat(e|ion|ions)\b/i, why: '§3.2 — say pre-order' },
  { pattern: /\bMBP\b/, why: '§33.11.3 — undefined acronym' },
  { pattern: /\btranche[sd]?\b/i, why: '§3.1 — never rendered' },
  { pattern: /\breservations?\b/i, why: '§3.1 — say pre-order' },
  { pattern: /\bpre[- ]build\b/i, why: '§3.1 — say Idea Campaign' },
  { pattern: /\bpre[- ]launch\b/i, why: '§3.1 — say Product Campaign' },
  { pattern: /\bescrow(ed)?\b/i, why: '§2.1 — never describe money this way' },
  { pattern: /\bcustody\b/i, why: '§2.1' },
  { pattern: /held in trust/i, why: '§2.1' },
  { pattern: /held in a Proovd/i, why: '§2.1' },
  { pattern: /\ball[- ]or[- ]nothing\b/i, why: '§3.2 — conditional charge' },
  { pattern: /\bDay 30\b/, why: 'banned everywhere' },
  { pattern: /campaign goal/i, why: '§3.2 — order threshold' },
  { pattern: /\bwe pay founders\b/i, why: '§3.2' },
  { pattern: /\banyone can launch\b/i, why: '§3.2' },
  { pattern: /\bequity\b/i, why: '§3.2 — reward package' },
  { pattern: /\bROI\b/, why: '§3.2' },
];

describe('§33.11.3 — vocabulary is consistent and nothing internal leaks', () => {
  it.each(PUBLIC_ROUTE_PATHS)('%s uses no banned term', (path) => {
    const { container } = renderRoute(path);
    const text = normalize(container.textContent);
    for (const { pattern, why } of BANNED_TERMS) {
      expect(pattern.test(text), `${path} matched ${pattern} (${why})`).toBe(false);
    }
  });

  it('uses the customer-facing role name outside the Appendix A.1 block', () => {
    const { container } = renderRoute('/');
    expect(normalize(container.textContent)).toContain('Creator');

    // §3.1 makes `Creator` the customer-facing name. The internal one survives
    // in exactly two Spec-mandated places: Appendix A.1's exact copy ("content
    // creators / affiliates / marketers") and the §18 `/affiliate-aup` route.
    // Everywhere else on the homepage it must be absent.
    const strip = container.querySelector('.trust-strip') as HTMLElement;
    expect(normalize(strip.textContent)).toContain('affiliates');
    strip.remove();
    expect(normalize(container.textContent)).not.toMatch(/\baffiliates?\b/i);
  });
});

/* ════════════════════════════════════════════════════════════════ §33.11.4 */

const GENERIC_CTA = /^(submit|ok|okay|yes|no|go|next|continue|click here|here|more|learn more|read more|button)$/i;

describe('§33.11.4 — every call to action names the actual action', () => {
  it.each(PUBLIC_ROUTE_PATHS)('%s has no generic control label', (path) => {
    const { container } = renderRoute(path);
    const controls = [
      ...container.querySelectorAll('button'),
      ...container.querySelectorAll('a.btn'),
    ];
    for (const control of controls) {
      const label = normalize(control.textContent);
      expect(label.length, `empty control on ${path}`).toBeGreaterThan(0);
      expect(GENERIC_CTA.test(label), `"${label}" on ${path}`).toBe(false);
    }
  });
});

/* ════════════════════════════════════════════════════════════════ §33.11.6 */

/** `[FOUNDER LEGAL NAME]`, `{{ handlebars }}`, `${template}` — anything unfilled. */
const UNRESOLVED_VARIABLE = /\[[A-Z][A-Z0-9 _/—-]{2,}\]|\{\{|\$\{/;
const PLACEHOLDER_WORDS = /\b(lorem ipsum|coming soon|TBD|TODO|FIXME|placeholder text)\b/i;

describe('§33.11.6 — no unresolved variables, broken links, or placeholders', () => {
  it.each(PUBLIC_ROUTE_PATHS)('%s resolves every variable', (path) => {
    const { container } = renderRoute(path);
    const text = normalize(container.textContent);
    expect(UNRESOLVED_VARIABLE.test(text), `unresolved variable on ${path}`).toBe(false);
    expect(PLACEHOLDER_WORDS.test(text), `placeholder wording on ${path}`).toBe(false);
  });

  it.each(PUBLIC_ROUTE_PATHS)('%s links only to routes that exist', (path) => {
    const { container } = renderRoute(path);
    for (const { href } of anchors(container)) {
      if (href.startsWith('mailto:') || href.startsWith('https://')) continue;
      // Pure fragments (the skip link) are checked by the in-page test below.
      if (href.startsWith('#')) continue;
      const [pathname] = href.split('#') as [string, ...string[]];
      // §33.11.6 asks that a rendered link resolve to a route that exists.
      // §18's fourteen stood in for that while the public site WAS the whole
      // app; the account doors (§5) are real routes on the same shell, so the
      // check reads the linkable set. A link to something that is in neither
      // list still fails.
      expect(
        LINKABLE_ROUTE_PATHS.includes(pathname),
        `${path} links to ${href}, which is not a route this app serves`,
      ).toBe(true);
    }
  });

  it.each(PUBLIC_ROUTE_PATHS)('%s points every in-page anchor at a real element', (path) => {
    const { container } = renderRoute(path);
    for (const { href } of anchors(container)) {
      if (!href.includes('#')) continue;
      const fragment = href.split('#')[1];
      if (!fragment) continue;
      expect(container.querySelector(`#${fragment}`), `${path} → #${fragment}`).not.toBeNull();
    }
  });

  it('never presents a draft policy as final', () => {
    for (const document of POLICY_DOCUMENTS) {
      const { container, unmount } = renderRoute(document.route);
      const text = normalize(container.textContent);
      if (document.status === 'draft') {
        expect(text, document.slug).toContain('In legal review');
        expect(text, document.slug).toContain('Not yet in effect');
        expect(text, document.slug).toContain(
          'There is no text on this page that is the policy',
        );
      } else {
        expect(text, document.slug).toContain('In effect');
      }
      unmount();
    }
  });
});

/* ════════════════════════════════════════════════════════════════ §33.11.7 */

/** The six §27.1 questions, as the StatePanel renders their labels. */
const SIX_QUESTION_KEYS = ['What happened', 'Next', 'Owner', 'Next update by', 'Reference'];

function expectSixQuestions(panel: HTMLElement, label: string) {
  for (const key of SIX_QUESTION_KEYS) {
    expect(normalize(panel.textContent), `${label} — ${key}`).toContain(key);
  }
  // "What can I do now" and "how do I get help" are the action row.
  expect(panel.querySelector('.state-panel__actions'), label).not.toBeNull();
}

describe('§33.11.7 — loading, empty, waiting, and failure use the six-question pattern', () => {
  it('loading: the route-transition fallback', () => {
    const { container } = render(<PageLoading />);
    const panel = container.querySelector('.state-panel') as HTMLElement;
    expect(panel).not.toBeNull();
    expectSixQuestions(panel, 'loading state');
    // §30: never a bare spinner. It says what is happening to money and data.
    expect(normalize(panel.textContent)).toContain('nothing has been charged');
  });

  it('waiting: a policy in legal review', () => {
    const { container } = renderRoute('/terms');
    const panel = container.querySelector('.state-panel') as HTMLElement;
    expect(panel).not.toBeNull();
    expectSixQuestions(panel, 'policy waiting state');
  });

  it('failure: an address with no page uses the focused exception screen', () => {
    const { container } = renderRoute('/nope');
    expect(container.querySelector('.state-screen')).not.toBeNull();
    expect(container.querySelector('.state-panel')).toBeNull();
  });

  it('empty: campaign updates and comments on a sample', () => {
    const { container } = renderRoute('/campaign/sample-pre-build');
    const updates = container.querySelector('#campaign-updates')?.closest('section');
    const comments = container.querySelector('#campaign-comments')?.closest('section');
    expectSixQuestions(
      updates?.querySelector('.state-panel') as HTMLElement,
      'updates empty state',
    );
    expectSixQuestions(
      comments?.querySelector('.state-panel') as HTMLElement,
      'comments empty state',
    );
  });

  it('every state panel offers a context-preserving way to get help', () => {
    for (const path of ['/terms', '/campaign/sample-pre-build']) {
      const { container, unmount } = renderRoute(path);
      for (const panel of container.querySelectorAll('.state-panel')) {
        const help = panel.querySelector('.state-panel__actions a[href^="mailto:"]');
        const noAction = panel.querySelector('.state-panel__noaction');
        expect(Boolean(help) || Boolean(noAction), path).toBe(true);
      }
      unmount();
    }
  });
});

/* ═══════════════════════════════════════════════ policy routes (§18, §31.4) */

describe('policy routes render a versioned record (§18, §31.4, §29.8)', () => {
  it.each(POLICY_DOCUMENTS.map((d) => d.route))(
    '%s shows title, version, effective date, and status',
    (route) => {
      const document = POLICY_DOCUMENTS.find((d) => d.route === route);
      if (!document) throw new Error(`no register entry for ${route}`);
      const { container, getByRole } = renderRoute(route);
      expect(getByRole('heading', { level: 1 })).toHaveTextContent(document.title);
      const text = normalize(container.textContent);
      expect(text).toContain('Version');
      expect(text).toContain(document.version);
      expect(text).toContain('Effective date');
      expect(text).toContain('Status');
    },
  );

  it('opens each policy with a plain-language Glance, per DNA §5.12', () => {
    const { container } = renderRoute('/privacy');
    const text = normalize(container.textContent);
    // While drafting, the Glance is the honest status plus what the document
    // will cover — never a summary standing in for the policy.
    expect(text).toContain('What this policy will cover');
    expect(text).toContain('This is the required contents of the document, not the document');
    const coverage = findPolicyDocument('privacy')?.coverage ?? [];
    expect(coverage.length).toBeGreaterThan(0);
    for (const item of coverage) {
      expect(text).toContain(normalize(item));
    }
  });
});

/* ════════════════════════════════════════════ sample campaigns (§18, §34) */

const SAMPLES = [
  { path: '/campaign/sample-pre-build', campaign: SAMPLE_IDEA_CAMPAIGN },
  { path: '/campaign/sample-pre-launch', campaign: SAMPLE_PRODUCT_CAMPAIGN },
];

describe('sample campaigns (§18, §34)', () => {
  it.each(SAMPLES)('$path shows the Appendix A.6 banner permanently', ({ path }) => {
    const { container } = renderRoute(path);
    const banner = container.querySelector('.sample-banner') as HTMLElement;
    expect(banner).not.toBeNull();
    expect(normalize(banner.textContent)).toBe(SAMPLE_BANNER);
    // Permanent: nothing dismisses it.
    expect(banner.querySelector('button')).toBeNull();
  });

  it.each(SAMPLES)('$path mounts no payment field of any kind', ({ path }) => {
    const { container } = renderRoute(path);
    // Not "disabled" — absent. No form to submit, no field to type into, no
    // iframe for a provider to mount into, and no provider script anywhere.
    expect(container.querySelectorAll('form')).toHaveLength(0);
    expect(container.querySelectorAll('input, select, textarea')).toHaveLength(0);
    expect(container.querySelectorAll('iframe')).toHaveLength(0);
    expect(container.querySelectorAll('[class*="StripeElement"], [id*="stripe"]')).toHaveLength(0);
    expect(document.querySelectorAll('script[src*="stripe"]')).toHaveLength(0);
    expect(container.innerHTML).not.toMatch(/cardnumber|card-number|cc-number|autocomplete="cc-/i);
  });

  it.each(SAMPLES)('$path names the pre-order action and explains why it is inert', ({ path }) => {
    const { getByRole, container } = renderRoute(path);
    const action = getByRole('button', { name: /Reserve a pre-order/i });
    expect(action).toBeDisabled();
    expect(normalize(container.textContent)).toContain(
      'This is a sample campaign, so there is nothing to reserve',
    );
  });

  /*
    The BAND order — rewritten deliberately for the campaign-page-v2 rebuild,
    not adjusted to match. §18 hands presentation to the DNA document, so the
    order below is the reference's; what §18 keeps is the CONTENT, which the
    next test checks anchor by anchor.

    Two things moved and both are §18 read literally. The `h1` is the hero
    headline with the campaign title as the kicker above it — item 1 asks for
    the title exposed, not for it to be the `h1`. And items 2, 7 and 8 became
    one `.pc-seller` band placed immediately before the reward cards, because
    §18 puts the merchant-of-record disclosure ABOVE the pre-order action and
    that band is the last thing a reader passes before any control that can
    open checkout.
  */
  it('renders the rebuilt band order', () => {
    const { container } = renderRoute('/campaign/sample-pre-build');
    const ids = [...container.querySelectorAll('h1, h2[id]')].map(
      (el) => el.id || 'campaign-title',
    );
    expect(ids).toEqual([
      'campaign-hero', // the hero headline; the title is the kicker above it
      'campaign-benefits',
      'campaign-story', // 10
      'campaign-progress', // 4, 5, 6 live in this panel
      'campaign-mor', // 8 — and 2 and 7 inside the same band
      'campaign-rewards', // 3, and 9 inside the same band
      'campaign-updates', // 12
      'campaign-faq', // 11
      'campaign-comments', // 13
      'campaign-support', // 14
      // 14 continues into the §31.4 site footer below.
      'footer-contact-heading',
      'footer-legal-heading',
      'footer-site-heading',
    ]);
  });

  /*
    …and the CONTENT gate. The band order above is a design decision and may
    change again; §18's fourteen items may not. Each one has a stable anchor,
    whatever heading level the design puts it at, and they appear in document
    order — so an item cannot be satisfied by a stray element at the bottom of
    the page.
  */
  const ITEM_ANCHORS = [
    'campaign-title', // 1
    'campaign-hero',
    'campaign-story', // 10
    'campaign-progress',
    'campaign-threshold', // 6 — Idea only
    'campaign-charge-rule', // 4
    'campaign-dates', // 5
    'campaign-mor', // 8
    'campaign-founder', // 2
    'campaign-refunds', // 7
    'campaign-rewards', // 3
    'campaign-preorder', // 9
    'campaign-updates', // 12
    'campaign-faq', // 11
    'campaign-comments', // 13
    'campaign-support', // 14
  ];

  it('exposes every one of §18’s fourteen items, in document order', () => {
    const { container } = renderRoute('/campaign/sample-pre-build');
    const found = ITEM_ANCHORS.map((id) => container.querySelector(`#${id}`));
    const missing = ITEM_ANCHORS.filter((_, i) => found[i] === null);
    expect(missing).toEqual([]);

    // Document order, compared as positions rather than as a second list.
    const all = [...container.querySelectorAll('[id]')].map((el) => el.id);
    const positions = ITEM_ANCHORS.map((id) => all.indexOf(id));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  /*
    §34 gates live mode on a sample mounting no payment field at all, and the
    rebuilt page has FOUR reserve-shaped controls where the old one had a
    single disabled button. Two scroll (the nav and the hero) and two would
    open checkout on a real campaign (the selected card and the phone dock).
    So this counts every one of them and partitions the set — a test that
    named one control would pass while the other three were live.
  */
  it.each(SAMPLES)('$path offers no way into checkout at all', ({ path }) => {
    const { container } = renderRoute(path);
    const reserveish = [...container.querySelectorAll('a, button')].filter((el) =>
      /reserve|pre-order/i.test(el.textContent ?? ''),
    );
    expect(reserveish.length).toBeGreaterThan(0);
    const live = reserveish.filter((el) =>
      el.tagName === 'A'
        ? !(el.getAttribute('href') ?? '').startsWith('#')
        : !(el as HTMLButtonElement).disabled,
    );
    expect(live.map((el) => el.textContent)).toEqual([]);
  });

  it('hides the threshold on a Product Campaign and shows it on an Idea Campaign', () => {
    const idea = renderRoute('/campaign/sample-pre-build');
    expect(idea.container.querySelector('#campaign-threshold')).not.toBeNull();
    expect(normalize(idea.container.textContent)).toContain('250 unique Backers');
    idea.unmount();

    const product = renderRoute('/campaign/sample-pre-launch');
    expect(product.container.querySelector('#campaign-threshold')).toBeNull();
    expect(normalize(product.container.textContent)).toContain(
      'There is no threshold on a Product Campaign',
    );
  });

  it('states reward prices as pre-tax (§18)', () => {
    const { container } = renderRoute('/campaign/sample-pre-build');
    const text = normalize(container.textContent);
    expect(text).toContain('US$49.00 before sales tax');
    expect(text).toContain(
      'Prices are shown before sales tax. Sales tax is calculated at checkout',
    );
    expect(text).not.toMatch(/tax included|including tax|tax-inclusive/i);
  });

  it('renders the Appendix A.3 consent preview in full, with the sample figures', () => {
    const { container } = renderRoute('/campaign/sample-pre-build');
    const text = normalize(container.textContent);
    expect(text).toContain('Your card will NOT be charged today.');
    expect(text).toContain('Reward subtotal');
    expect(text).toContain('US$49.00');
    expect(text).toContain('Sales tax');
    expect(text).toContain('US$4.04');
    expect(text).toContain('Total authorized');
    expect(text).toContain('US$53.04');
    expect(text).toContain('30 September 2026, 23:00 UTC');
    expect(text).toContain('order threshold of 250 unique Backers');
    expect(text).toContain('PROOVD SAMPLE LABS');
    expect(text).toContain('Authorize pre-order');
  });

  it('renders the Appendix A.4 consent preview on the Product Campaign', () => {
    const { container } = renderRoute('/campaign/sample-pre-launch');
    const text = normalize(container.textContent);
    expect(text).toContain('founding-member pre-order');
    expect(text).toContain('Your card will NOT be charged today.');
    expect(text).toContain('US$39.00');
    expect(text).toContain('US$3.22');
    expect(text).toContain('US$42.22');
    expect(text).toContain('8 September 2026, 23:00 UTC');
    expect(text).toContain('Expected delivery of "Founding member" is October 2026');
    expect(text).toContain('Sample Works LLC Refund Policy / version 1.0 / effective 1 August 2026');
  });

  it('leaves every optional consent unchecked and marked optional (§28.4, §30)', () => {
    const { container } = renderRoute('/campaign/sample-pre-build');
    const checks = [...container.querySelectorAll('.consent__checks > li')];
    expect(checks).toHaveLength(3);
    expect(normalize(checks[0]?.textContent)).toContain('(required; unchecked by default)');
    expect(normalize(checks[1]?.textContent)).toContain('(optional; unchecked by default)');
    expect(normalize(checks[2]?.textContent)).toContain('(optional; unchecked by default)');
    // Nothing here is an input, so nothing here can be prechecked.
    expect(container.querySelectorAll('.consent__checks input')).toHaveLength(0);
  });

  it('renders the always-visible §18 disclosure and the Appendix A.2 expansion', () => {
    const { container } = renderRoute('/campaign/sample-pre-launch');
    const text = normalize(container.textContent);
    expect(text).toContain(
      'Sold by Sample Founder of Sample Works LLC, United States. Proovd is the platform, not the seller.',
    );
    // The expansion is one gesture below, not on the page by default.
    expect(text).not.toContain('does not take title to any digital reward');
  });

  it('puts the compact card-saved summary beside the primary action (§18)', () => {
    const { container } = renderRoute('/campaign/sample-pre-launch');
    const summary = container.querySelector('.compact-summary') as HTMLElement;
    const text = normalize(summary.textContent);
    expect(text).toContain('Card saved today');
    expect(text).toContain('Every active pre-order is charged on the close date');
    expect(text).toContain('October 2026');
  });

  it('shows close time locally with UTC alongside (§27.1)', () => {
    const { container } = renderRoute('/campaign/sample-pre-build');
    const dates = container.querySelector('#campaign-dates')?.closest('section') as HTMLElement;
    expect(normalize(dates.textContent)).toContain('30 September 2026, 23:00 UTC');
    expect(dates.querySelectorAll('time').length).toBe(2);
  });
});

/* ══════════════════════════════════════ §33.11.5 — cross-surface agreement */

describe('§33.11.5 (partial) — surfaces agree on seller, trigger, and descriptor', () => {
  it.each(SAMPLES)('$path states one seller and one descriptor throughout', ({ path, campaign }) => {
    const { container } = renderRoute(path);
    const text = normalize(container.textContent);
    // The MoR disclosure, the consent preview, and the support block all name
    // the same seller and the same descriptor.
    expect(text.match(new RegExp(campaign.founder.legalName, 'g'))?.length ?? 0).toBeGreaterThan(2);
    expect(text).toContain(campaign.statementDescriptor);
  });

  it('states the same SLA on every public route', () => {
    for (const path of PUBLIC_ROUTE_PATHS) {
      const { container, unmount } = renderRoute(path);
      expect(normalize(container.textContent), path).toContain(
        'We respond within one (1) business day, Monday–Friday, excluding U.S. federal holidays.',
      );
      unmount();
    }
  });
});
