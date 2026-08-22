/**
 * The public footer — Spec §31.4 and §27.8.
 *
 * §31.4 fixes what every public footer must contain: the legal entity, the
 * support email, the one-business-day SLA, the postal address, and links to
 * Terms, Privacy, Cookies, Refunds, Fulfillment, the Founder AUP, the Stripe
 * Connected Account Agreement, How payments work, and Safety.
 *
 * §27.8 fixes the contact block as exact text. It is rendered line for line
 * from `SERVICE_SLA_BLOCK` — the only liberty taken is turning the address in
 * the email line into a `mailto:` link, which changes no visible character.
 * `public-site.test.tsx` compares the rendered block against the constant, so
 * an edit here fails the suite rather than quietly rewording a commitment.
 *
 * The rest of the §18 inventory is listed below the required links. §31.4
 * states a floor, and a site that publishes a complete public route inventory and links
 * to nine of them fails DNA §5.12's wayfinding rule.
 */

import { Link as RouterLink } from 'react-router';
import {
  LEGAL_ENTITY,
  PUBLIC_ROUTES,
  REQUIRED_FOOTER_LINKS,
  SERVICE_SLA_BLOCK,
  SUPPORT_EMAIL,
} from './site.js';

const [SLA_HEADING, SLA_EMAIL_LINE, SLA_RESPONSE_LINE, SLA_POSTAL_LINE] = SERVICE_SLA_BLOCK;

/** The §27.8 email line, verbatim, with the address itself made actionable. */
function EmailLine() {
  const prefix = SLA_EMAIL_LINE.slice(0, SLA_EMAIL_LINE.indexOf(SUPPORT_EMAIL));
  return (
    <>
      {prefix}
      <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
    </>
  );
}

export function SiteFooter() {
  const otherRoutes = PUBLIC_ROUTES.filter(
    (route) =>
      route.path !== '/' && !REQUIRED_FOOTER_LINKS.some((link) => link.href === route.path),
  );

  return (
    <footer className="site-footer mode-dark" aria-label="Site footer">
      <div className="wrap site-footer__inner">
        <section className="site-footer__contact" aria-labelledby="footer-contact-heading">
          <h2 className="site-footer__heading" id="footer-contact-heading">
            {SLA_HEADING}
          </h2>
          <p className="site-footer__line">
            <EmailLine />
          </p>
          <p className="site-footer__line">{SLA_RESPONSE_LINE}</p>
          <p className="site-footer__line">{SLA_POSTAL_LINE}</p>
        </section>

        <nav className="site-footer__group" aria-labelledby="footer-legal-heading">
          <h2 className="site-footer__heading" id="footer-legal-heading">
            Policies and payments
          </h2>
          <ul className="site-footer__list">
            {REQUIRED_FOOTER_LINKS.map((link) =>
              link.external ? (
                <li key={link.href}>
                  <a href={link.href} target="_blank" rel="noopener noreferrer">
                    {link.label}
                    <span className="pv-sr"> (opens in a new tab)</span>
                  </a>
                </li>
              ) : (
                <li key={link.href}>
                  <RouterLink to={link.href}>{link.label}</RouterLink>
                </li>
              ),
            )}
          </ul>
        </nav>

        <nav className="site-footer__group" aria-labelledby="footer-site-heading">
          <h2 className="site-footer__heading" id="footer-site-heading">
            Everything else on this site
          </h2>
          <ul className="site-footer__list">
            {otherRoutes.map((route) => (
              <li key={route.path}>
                <RouterLink to={route.path}>{route.label}</RouterLink>
              </li>
            ))}
          </ul>
        </nav>
      </div>

      <div className="wrap site-footer__legal">
        <p className="site-footer__line">
          {LEGAL_ENTITY} is a Delaware software platform. On every campaign, the
          Founder is the seller and the merchant of record; {LEGAL_ENTITY} is the
          merchant of record only for the separate Founder listing fee.
        </p>
      </div>
    </footer>
  );
}
