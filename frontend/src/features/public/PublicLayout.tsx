/**
 * The shell every public route renders inside — header, main, footer, chat.
 *
 * The header opens with the skip link — first in the tab order — and `<main>`
 * is its target, because §33.11.1 requires a complete keyboard path and a
 * nav plus a fourteen-link footer sitemap in front of the content is exactly
 * the trap that requirement exists for.
 *
 * Route changes reset scroll and move focus into the new page. A single-page
 * router that leaves focus on a footer link after navigation leaves a screen
 * reader reading the page it just left.
 */

import { useEffect, useRef } from 'react';
import { Outlet, useLocation } from 'react-router';
import { SiteHeader } from './SiteHeader.js';
import { SiteFooter } from './SiteFooter.js';
import { SupportChat } from './SupportChat.js';

export function PublicLayout() {
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    window.scrollTo(0, 0);
    mainRef.current?.focus();
  }, [location.pathname]);

  return (
    <>
      <SiteHeader />
      <main id="main" ref={mainRef} tabIndex={-1}>
        <Outlet />
      </main>
      <SiteFooter />
      <SupportChat />
    </>
  );
}
