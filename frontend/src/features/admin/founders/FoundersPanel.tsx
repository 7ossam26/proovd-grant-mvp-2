/**
 * The Admin Founders panel — Spec §7, §9, §10, §26.1, §26.2.
 *
 * ── The reference is the whole page, so it renders as the whole page ────────
 * `ProovdAdminFounder.html` authors its own `main.admin-shell` with its own
 * `header.topbar`. It is not a screen that sits inside another shell, and
 * mounting it inside `AdminLayout` would put two topbars and two wordmarks on
 * screen and let `AdminLayout`'s `.topbar` rules fight the reference's.
 *
 * So this panel is routed OUTSIDE `AdminLayout`, and the reference stylesheet
 * is loaded verbatim — all 7,775 lines of it, its seven `:root` token blocks
 * included. That is the whole reason it can be byte-for-byte the reference:
 * nothing else is on screen to collide with it.
 *
 * The stylesheet is attached on mount and removed on unmount, so its tokens
 * govern this panel and stop governing the moment you leave it.
 *
 * ── Nothing here is mock data ───────────────────────────────────────────────
 * Every founder, every field and every state comes from `/api/admin/founders/*`
 * — the same routes, guards and freshness gates the server has always had. The
 * reference's own Maya Hassan and Sarah Chen are gone; what renders is whatever
 * is actually in the database.
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Directory } from './Directory.js';
import { Workspace } from './Workspace.js';

/**
 * The reference stylesheet, served verbatim.
 *
 * There is no scale sheet beside it any more. The panel briefly carried
 * `html { font-size: 87.5% }` to stop the bands clipping, which treated a
 * symptom: `--rail-x` was used by the topbar, record bar, glance and workspace
 * but never defined, so `padding-inline: var(--rail-x)` was invalid at computed
 * value time and fell back to `0`. The reference's own v2 defines it as
 * `var(--gutter-x)` — `clamp(1rem, 3.2vw, 4rem)` — which is responsive by
 * construction, so the panel renders at its authored size and gutters that
 * grow and shrink with the viewport.
 */
const PANEL_STYLESHEETS = ['/admin-founders.css'] as const;

function useReferenceStylesheet(): boolean {
  const [ready, setReady] = useState(
    () =>
      typeof document !== 'undefined' &&
      PANEL_STYLESHEETS.every((href) => !!document.querySelector(`link[href="${href}"]`)),
  );

  useEffect(() => {
    const attached: HTMLLinkElement[] = [];
    let settled = 0;

    // Readiness is the REFERENCE sheet's — the scale sheet is one rule, and
    // holding the panel blank on it would trade a correct size for a slower
    // first paint.
    const done = () => {
      settled += 1;
      if (settled >= 1) setReady(true);
    };

    for (const href of PANEL_STYLESHEETS) {
      if (document.querySelector(`link[href="${href}"]`)) {
        done();
        continue;
      }
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      // Painting the panel's markup before its 7,775 lines of rules have
      // arrived shows an unstyled skeleton for a frame; waiting is honest.
      link.addEventListener('load', done);
      // A stylesheet that will not load must not hide the panel forever —
      // render it unstyled rather than a blank screen with no explanation.
      link.addEventListener('error', done);
      document.head.appendChild(link);
      attached.push(link);
    }

    return () => {
      for (const link of attached) link.remove();
    };
  }, []);

  return ready;
}

export function FoundersPanel() {
  const { prospectId } = useParams();
  const navigate = useNavigate();
  const stylesReady = useReferenceStylesheet();

  const openFounder = useCallback(
    (id: string) => navigate(`/admin/founders/${encodeURIComponent(id)}`),
    [navigate],
  );
  const backToDirectory = useCallback(() => navigate('/admin/founders'), [navigate]);

  if (!stylesReady) {
    // Deliberately bare: this is the sub-second gap before the reference's own
    // rules arrive, and any styling here would be styling the reference does
    // not have.
    return <div aria-busy="true" />;
  }

  return (
    <main className="admin-shell">
      <header className="topbar">
        <a className="wordmark u" href="#main">
          PROOVD
        </a>
        <button className="search-trigger" type="button">
          <span>Search anything</span>
          <kbd>⌘ K</kbd>
        </button>
        <span className="admin-label">ADMIN</span>
      </header>

      {prospectId ? (
        <Workspace prospectId={prospectId} onBack={backToDirectory} />
      ) : (
        <Directory onOpenFounder={openFounder} />
      )}
    </main>
  );
}
