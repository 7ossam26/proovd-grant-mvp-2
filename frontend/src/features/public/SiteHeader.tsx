/**
 * The public header — DNA §5.12 wayfinding.
 *
 * "The current location and the way back are readable at every scroll depth."
 * The wordmark is the way back; the current page carries `aria-current` and a
 * weight shift, never colour alone. The full inventory lives in the footer
 * sitemap, so the header stays at four destinations and still wraps cleanly at
 * 320px without a hamburger that hides the way to anywhere behind a state.
 */

import { NavLink } from 'react-router';
import { HEADER_ROUTES } from './site.js';

export function SiteHeader() {
  return (
    <header className="site-header">
      {/* First in the tab order, and inside the banner landmark so it is not a
          region-less orphan for a screen reader browsing by landmark. */}
      <a className="skip-link" href="#main">
        Skip to the main content
      </a>
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
          <NavLink
            to="/campaign/sample-pre-build"
            className={({ isActive }) =>
              isActive ? 'site-nav__link is-current' : 'site-nav__link'
            }
          >
            See a sample campaign
          </NavLink>
        </nav>
      </div>
    </header>
  );
}
