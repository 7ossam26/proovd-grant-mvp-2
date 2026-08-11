/**
 * The one render-error boundary. §1.1, §27.1, §30.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * Before this file the app had no boundary anywhere, so a single throw during
 * render or in a layout effect unmounted the whole tree and left the viewer a
 * blank page. That is the worst failure this product can produce and the one
 * §30 names directly: "no generic errors without money/data status and
 * recovery". A blank page is not even a generic error — it states nothing at
 * all, so an Admin cannot tell a crash from a slow load, and a Founder cannot
 * tell a crash from having been signed out.
 *
 * It is worse than that on a portal surface. A Radix dialog marks `#root`
 * `aria-hidden` while it is open; if the tree crashes with that attribute
 * applied, it is never cleaned up, focus is stranded on the trigger behind the
 * hidden wall, and the browser logs an aria-hidden violation that reads like an
 * accessibility defect rather than the crash it actually is.
 *
 * ── What it says ────────────────────────────────────────────────────────────
 * §27.1's six questions, with the error's own name and message shown as
 * technical detail rather than as the explanation. The message is written by
 * whoever threw, so it is never the sentence a person is given — but hiding it
 * entirely is how a reproducible bug becomes an unreproducible report, so it
 * rides along under its own heading, exactly as the Admin workspace renders a
 * raw lifecycle value under "Technical details".
 *
 * Recovery is a reload, because a boundary that offers "try again" without
 * remounting anything is a button that re-renders the same throw.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from './Button.js';
import { StatePanel } from './StatePanel.js';

interface Props {
  children: ReactNode;
  /** Where this boundary sits, so the panel can name it. */
  area?: string;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    // Server-side reporting is Sentry's (see backend/src/index.ts); in the
    // browser the console is what a developer and a support session both read.
    // eslint-disable-next-line no-console
    console.error('[proovd] a surface failed to render', error, info.componentStack);
  }

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const where = this.props.area ? ` on ${this.props.area}` : '';
    return (
      <div className="wrap" style={{ paddingBlock: 'var(--sp-48)' }}>
        <StatePanel
          state="This screen could not be displayed"
          whatHappened={`Something${where} failed while the page was being built, so it stopped rather than showing you a half-drawn screen. Nothing you had already saved was changed by this.`}
          next="Reload the page. If it fails again in the same place, the detail below is what a developer needs."
          owner="Proovd"
          nextUpdate="No update is pending — this is a fault in the page, not a queue you are waiting in."
          action={
            <Button onClick={() => window.location.reload()}>Reload this page</Button>
          }
          getHelp={{ href: '/support' }}
          reference={`${error.name}: ${error.message}`}
        />
      </div>
    );
  }
}
