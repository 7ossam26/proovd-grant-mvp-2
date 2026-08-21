/**
 * The empty state every Admin section renders while the panel is rebuilt
 * (2026-08-21).
 *
 * The Admin panel's screens were removed so it can be rebuilt one section at a
 * time. The shell survived — the wordmark, the eight nav tabs, the environment
 * chip — because the nav is the map of what the panel IS, and a rebuild that
 * also dismantled the map would leave nothing to rebuild against. What is gone
 * is everything below it.
 *
 * ── Why this is a panel and not a blank page ────────────────────────────────
 * §1.4: a screen that renders nothing is indistinguishable from one that failed
 * to load, and the first thing anybody does with a blank page is reload it. So
 * each section says plainly that it was removed on purpose, and answers §27.1's
 * six questions the way every other waiting state in this product does — what
 * happened, what is next, who owns it, when it changes, what you can do now,
 * and how to get help.
 *
 * §33.11 also sweeps six Admin addresses for accessibility, and a genuinely
 * empty route would fail it on the missing heading rather than on anything
 * real. The `h1` here is the section's own name, so the sweep keeps testing the
 * shell's keyboard path and landmark structure while the sections are away.
 *
 * ── Replacing one ───────────────────────────────────────────────────────────
 * Route the section to its real component in `routes.tsx`. Nothing else refers
 * to this file per-section; when the last section is rebuilt, delete it.
 *
 * The server is untouched: every `/api/admin/*` router is still mounted and
 * still tested, so a rebuilt section has data waiting for it on day one.
 */

import { Measure, Section, StatePanel } from '../../components/index.js';
import { supportMailto } from '../public/states.js';

interface SectionPlaceholderProps {
  /** The section's own name, exactly as the nav tab spells it. */
  name: string;
  /**
   * What this section did before it was removed — one clause, so the sentence
   * reads as a description of the work rather than as a promise about a date.
   * §1.4: naming no delivery date is better than naming one nobody agreed to.
   */
  did: string;
}

export function SectionPlaceholder({ name, did }: SectionPlaceholderProps) {
  return (
    <Section>
      <Measure>
        <h1 className="page-title">{name}</h1>
        <StatePanel
          state={`${name} is being rebuilt`}
          whatHappened={`This section was removed on purpose so it can be rebuilt from scratch. It used to ${did}. Nothing was lost: the records behind it are untouched and every Admin endpoint it used is still running.`}
          next={`${name} comes back when its new screen is built. The sections are being rebuilt one at a time, so the other tabs may return before this one.`}
          owner="Proovd"
          nextUpdate="When this section is rebuilt"
          action="No action needed"
          reference={`Admin · ${name}`}
          getHelp={{ href: supportMailto(`Admin ${name} section`) }}
        />
      </Measure>
    </Section>
  );
}

/**
 * What an address that is no longer part of the panel renders (2026-08-21).
 *
 * Today, Money & Fulfillment and Live mode were removed from the nav by product
 * direction. Without this, `/admin/money` would match the `admin` parent route,
 * find no child, and render the shell wrapped around **nothing** — a blank page,
 * which is the one state §1.4 says is indistinguishable from a broken one.
 *
 * It is a child of `admin` rather than the app's top-level `*`, deliberately:
 * the person is a signed-in Admin who typed or followed an Admin address, and
 * dropping them onto the public not-found surface would lose the shell and the
 * nav that tells them what the panel currently has.
 *
 * The backends behind those three are untouched and still mounted, so this says
 * the SECTION is gone rather than implying the data is.
 */
export function AdminAddressRetired() {
  return (
    <Section>
      <Measure>
        <h1 className="page-title">Not part of the Admin panel</h1>
        <StatePanel
          state="This address is not one of the panel's sections"
          whatHappened="The Admin panel is being rebuilt and currently has five sections: Founders, Affiliates, Backers, Campaigns and Support. Today, Money & Fulfillment and Live mode were removed from it. The records and the endpoints behind them are untouched — only the screens are gone."
          next="Pick a section from the nav above. If you followed a link here from an email or a task, that link was made before the rebuild."
          owner="Proovd"
          nextUpdate="When the panel is rebuilt"
          action="No action needed"
          reference="Admin panel"
          getHelp={{ href: supportMailto('An Admin address that no longer opens') }}
        />
      </Measure>
    </Section>
  );
}
