/**
 * The public header — DNA §5.12 wayfinding.
 *
 * "The current location and the way back are readable at every scroll depth."
 * The wordmark is the way back; the current page carries `aria-current` and a
 * weight shift, never colour alone. The full inventory lives in the footer
 * sitemap, so the header stays at four destinations and still wraps cleanly at
 * 320px without a hamburger that hides the way to anywhere behind a state.
 *
 * ── Sign in is separated from the nav, and that is deliberate ──────────────
 * The four links are wayfinding around the public site; `Sign in` is the way
 * into the product, and a returning Founder or Creator should not have to read
 * a marketing nav to find it (DNA §5.12: the way to anywhere is one gesture
 * from everywhere). It sits outside `<nav aria-label="Main">` in its own group
 * so a screen reader browsing by landmark meets the site's sections and the
 * account door as two different things.
 *
 * It is not `.btn`: a brand-filled button here would compete with the hero's
 * one primary action on every page it renders on (DNA §5.6, §5.8).
 */

import { NavLink, useLocation } from 'react-router';
import { HEADER_ROUTES } from './site.js';

/**
 * The campaign nav — brand, two in-page destinations, and the reserve action.
 *
 * Real anchors rather than the reference's scroll buttons: an `<a href="#id">`
 * is keyboard-native, carries its destination as its accessible name, and
 * survives a page rendered before its script (DNA §5.13's one vocabulary — the
 * label names where it goes). `Reserve` scrolls to the reward cards; it does
 * NOT open checkout, which is the reference's own split and is what lets the
 * seller band sit above every control that does (§18).
 */
function CampaignNav() {
  return (
    <div className="site-header__inner">
      <NavLink to="/" className="site-header__brand">
        Proovd
      </NavLink>
      <nav className="site-nav pc-nav" aria-label="This campaign">
        <a className="site-nav__link" href="#campaign-benefits">
          Why it works
        </a>
        <a className="site-nav__link" href="#campaign-rewards">
          Access
        </a>
      </nav>
      <div className="site-header__account">
        <a className="btn btn--primary pc-nav__cta" href="#campaign-rewards">
          Reserve
        </a>
      </div>
    </div>
  );
}

export function SiteHeader() {
  const location = useLocation();
  const campaign = location.pathname.startsWith('/campaign/');

  return (
    <header className={campaign ? 'site-header site-header--campaign' : 'site-header'}>
      {/* First in the tab order, and inside the banner landmark so it is not a
          region-less orphan for a screen reader browsing by landmark. */}
      <a className="skip-link" href="#main">
        Skip to the main content
      </a>
      {campaign ? (
        <CampaignNav />
      ) : (
      <div className="site-header__inner">
        <NavLink to="/" className="site-header__brand">
          Proovd
        </NavLink>
        <nav className="site-nav" aria-label="Main">
          {HEADER_ROUTES.map((route) => (
            <NavLink
              key={route.path}
              to={route.path}
              className={({ isActive }) =>
                isActive ? 'site-nav__link is-current' : 'site-nav__link'
              }
            >
              {route.label}
            </NavLink>
          ))}
        </nav>
        <div className="site-header__account">
          <NavLink
            to="/signin"
            className={({ isActive }) =>
              isActive ? 'site-header__signin is-current' : 'site-header__signin'
            }
          >
            Sign in
          </NavLink>
        </div>
      </div>
      )}
    </header>
  );
}
