/**
 * Links to your socials — Founder Flow v2, the reference's `[data-socials]`.
 *
 * REBUILT FROM SCRATCH 2026-08-20 against the supplied reference
 * (`Proovd Founder Flow v2.dc.html`, `[data-socials]` / `kindWide`) and its
 * screenshot. The surface that stood here was Session D's `AnswerPage` layout —
 * a trail line, the optional tag, the question as the heading, a list of saved
 * profiles, and four labelled `Field`/`Option`/`Button` stacks. None of that is
 * left. What replaced it is the reference's own composition: one headline, four
 * icon-input-button rows on a fixed stage, and one `Next`.
 *
 * ── The layout model is the reference's, not an approximation of it ────────
 * Authored once on a fixed 2496x1542 stage and scaled to the viewport by
 * `fitStages()`:
 *
 *     let s = Math.min(innerWidth/2496, innerHeight/1542) * (pageScale || .78);
 *
 * No branch of that function names this screen — `c` is `vetting` and
 * `vReviewing` is false at `vStep` 7 — so it takes `pageScale` alone. Every
 * child below carries the reference's own pixel value on that stage: a 78px
 * icon, a 64px gap, a 132px input, a 290px button, 66px between rows, 150px
 * above and below the panel, a 165px CTA. Nothing reflows; the stage scales.
 *
 * ── The column's width comes from a sentence that is not on this screen ────
 * The reference's own first child is
 *
 *     <span aria-hidden="true" style="height:0;overflow:hidden;font-size:112px;
 *       font-weight:700;letter-spacing:-.03em;white-space:nowrap;
 *       visibility:hidden;">We want to see your product...</span>
 *
 * — the VISUALS screen's headline, measured and thrown away, so that the two
 * pages share one column width (1491px, at Satoshi's own metrics). It is
 * reproduced verbatim rather than replaced with the number it computes to,
 * because the number is a font measurement: a hardcoded 1491 would be right on
 * this machine and wrong the moment the face is revised. `aria-hidden`,
 * `visibility:hidden` and `height:0` are all three of its own, so it is in no
 * accessibility tree and takes no space.
 *
 * ── Four rows, and they are one record ─────────────────────────────────────
 * Instagram, X, Discord and a website are four PLACEHOLDERS over one
 * `campaign_social_profiles` table; the platform is derived from the URL by the
 * server (`readPlatform` — the hostname), never chosen here. So a saved profile
 * is bound back to whichever row its host matches, and the row's INPUT is the
 * record: the reference persists `st.ans.socials.urls[i]` and shows it in the
 * box, and what persists here is the row it was written from.
 *
 * ── `Added` is a receipt, not a state, and that is the reference's own ─────
 * `addSocial` sets the flag and then `this.later(… delete mm[i] …, 1700)`. The
 * button says `Added` for 1.7 seconds and goes back to `Add`; what is left
 * behind is the URL in the box. That reads correctly here for the same reason:
 * the durable evidence is the address and what the server made of it, and both
 * are on screen.
 *
 * ── §28.4 is why there is something in the reference's empty gap ───────────
 * §12 wants "at least one valid, accessible, public Founder/product social
 * profile CONTROLLED by the Founder", and `evidence.ts` requires
 * `accessible === true && controlsConfirmed` before the item counts. Proovd
 * cannot prove control — there is no OAuth handshake and inventing one would be
 * §1 rule 6 — so it is the Founder's own statement, and §28.4 forbids folding a
 * statement into another control. The reference draws neither the statement nor
 * the check result.
 *
 * Both are added, and they are placed so that not one reference box moves: the
 * row is `position: relative` and the line sits ABSOLUTELY inside the 66px gap
 * the composition already leaves between rows. A checkbox nobody can find is
 * not a consent control, so it is not hidden; a control that pushed the panel
 * down would not be this screen, so it is not in the flow. This is the one
 * place this file departs from the reference, it is required rather than
 * chosen, and it costs the geometry nothing.
 *
 * ── The bell carries a count of reading, never a count of messages ─────────
 * The reference's is `mailCount: 2 + Math.max(0, vStep - 3)` — six at `vStep`
 * 7, which is what the screenshot shows. There is no inbox in this product and
 * an unread count over a message system that does not exist is §1.4's failure
 * with a number on it. The badge carries the number of reading cards the drawer
 * actually holds, derived from `FOUNDER_FLOW_PAGES`, and the control opens that
 * drawer — which is what the reference's does too.
 *
 * It does not shake. The reference loops it every six seconds for as long as
 * the page is open; `FlowPage` has recorded since Session B that an element
 * moving indefinitely to draw attention is the pattern DNA §5.10 and §30 name,
 * whatever it opens. That decision is unchanged here.
 *
 * ── §12's lock ────────────────────────────────────────────────────────────
 * After the listing fee is paid the calculation and its evidence lock, and the
 * server refuses a write. The reference has no such state; the rows say so and
 * offer nothing rather than offering a control the server will refuse (§1.4).
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { EVIDENCE_REJECTIONS, founderFlowIndex, founderFlowPath } from '@proovd/shared';
import { SurfaceLoading } from '../../features/public/states.js';
import { StatePanel, NO_ACTION } from '../../components/index.js';
import { socialAddPop, socialNudge, stageRelayIn } from '../../components/anim.js';
import {
  addSocial,
  confirmSocialControl,
  recheckSocial,
  removeSocial,
  type SocialState,
  type WorkspaceState,
} from '../founder/api.js';
import { FlowPage, HelpDrawer, flowDirection, useFlowNav } from './FlowPage.js';
import { useSetupWorkspace } from './useSetup.js';

/* ── The stage ─────────────────────────────────────────────────────────────
   `fitStages()` for a page it treats as ordinary: the stage's own size as the
   divisors and `pageScale` alone. */

const FIT_W = 2496;
const FIT_H = 1542;
/** The prototype's `pageScale` prop default. */
const PAGE_SCALE = 0.78;

function stageScale(): number {
  return Math.min(window.innerWidth / FIT_W, window.innerHeight / FIT_H) * PAGE_SCALE;
}

/**
 * The reference's own relay order for this screen, out of `verifyIntro`'s fixed
 * list `pill, head, field, boxes, note, fee, sub, hint, panel, art, art2, cta,
 * edit`. Passed to `stageRelayIn` rather than read from the DOM, because the
 * 0.085s stagger follows THAT order and not document order.
 */
const RELAY = ['head', 'panel', 'cta'] as const;

/** `this.later(…, 1700)` — how long the receipt stands. Its own number. */
const ADDED_MS = 1700;

/**
 * The reference's four rows, in its own order, with its own icon files.
 *
 * `hosts` is not the reference's — it has no records to bind — and it is the
 * one thing that maps a stored profile back to a row. The server derives
 * `platform` as the hostname with `www.` stripped (`readPlatform`), so this
 * compares against that and nothing else. A profile matching none of them is a
 * website, which is what the fourth row is for.
 */
const ROWS = [
  {
    id: 'instagram',
    icon: '/assets/social-instagram.svg',
    /* The accessible name the reference's icon does not carry: it is a
       background image on a `<span>`, so a screen reader meets four
       identically-labelled boxes without this. */
    label: 'Instagram',
    hosts: ['instagram.com'],
  },
  { id: 'x', icon: '/assets/social-x.svg', label: 'X', hosts: ['x.com', 'twitter.com'] },
  {
    id: 'discord',
    icon: '/assets/social-discord.svg',
    label: 'Discord',
    hosts: ['discord.gg', 'discord.com'],
  },
  { id: 'website', icon: '/assets/social-website.svg', label: 'Website', hosts: [] },
] as const;

/** The server sends codes; the register owns the sentences (§27.1). */
function rejectionText(code: string): string {
  return (EVIDENCE_REJECTIONS as Record<string, string>)[code] ?? 'This one does not count yet.';
}

/**
 * Which stored profile belongs to which row.
 *
 * Three passes, in this order, and the order is the point:
 *
 *  1. The row it was WRITTEN from, when this page is the one that wrote it.
 *     The record carries no row — the server derives a hostname and nothing
 *     else — so without this a profile whose host matches no row lands in the
 *     first free one, which is not the row the Founder typed it into. Adding a
 *     website to row 4 and watching its answer appear against row 2 is a
 *     surface disagreeing with the person using it.
 *  2. Host, so a profile from an earlier visit lands where somebody would look
 *     for it.
 *  3. The free rows in order, so nothing saved is invisible.
 *
 * Anything past four rows is returned separately rather than dropped — the
 * surface this replaced could write more than four, and a record that exists
 * and is not shown is the worst of the three outcomes.
 */
function bindProfiles(
  profiles: readonly SocialState[],
  writtenFrom: Readonly<Record<string, number>>,
): {
  bound: (SocialState | null)[];
  extra: SocialState[];
} {
  const bound: (SocialState | null)[] = ROWS.map(() => null);
  const left = [...profiles];

  const take = (index: number, at: number) => {
    if (at >= 0) bound[index] = left.splice(at, 1)[0]!;
  };

  ROWS.forEach((_, index) =>
    take(
      index,
      left.findIndex((p) => writtenFrom[p.id] === index),
    ),
  );
  ROWS.forEach((row, index) => {
    if (bound[index] || !row.hosts.length) return;
    take(
      index,
      left.findIndex((p) =>
        (row.hosts as readonly string[]).includes((p.platform ?? '').toLowerCase()),
      ),
    );
  });
  ROWS.forEach((_, index) => {
    if (bound[index] || !left.length) return;
    bound[index] = left.shift()!;
  });

  return { bound, extra: left };
}

export function SocialsStep() {
  const { campaignId = '' } = useParams();
  const setup = useSetupWorkspace(campaignId);

  if (setup.failure) {
    return (
      <FlowPage pageId="socials" param={campaignId}>
        <div className="ff-soc__failure">
          <StatePanel
            state="We could not open your campaign"
            whatHappened={setup.failure}
            next="Reload the page. Nothing you have saved is affected — this is only about reading it back."
            owner="Proovd"
            nextUpdate="As soon as you reload"
            action={NO_ACTION}
            reference={campaignId}
            getHelp={{ href: '/support' }}
            ring
          />
        </div>
      </FlowPage>
    );
  }

  if (!setup.state) {
    return <SurfaceLoading subject="your socials" reference="Your campaign" />;
  }

  return (
    <FlowPage pageId="socials" param={campaignId}>
      <SocialsScreen campaignId={campaignId} state={setup.state} refresh={setup.refresh} />
    </FlowPage>
  );
}

/** Split from the loader so `useFlowNav` — which only exists under `FlowPage` — is available. */
function SocialsScreen({
  campaignId,
  state,
  refresh,
}: {
  campaignId: string;
  state: WorkspaceState;
  refresh: (promise: Promise<{ workspace: WorkspaceState }>) => Promise<void>;
}) {
  const { leave, leaveToPage } = useFlowNav();
  const [params] = useSearchParams();
  const fromReview = params.get('from') === 'review';

  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const rowEls = useRef<(HTMLDivElement | null)[]>([]);

  // Read once, during the first render: `FlowPage` resets the module value in
  // its own layout effect, and a later re-render would read the reset.
  const direction = useRef<1 | -1 | null>(null);
  if (direction.current === null) direction.current = flowDirection();

  /* Which row wrote which profile — see `bindProfiles`. It exists only for as
     long as the page is open; on the next visit the host decides, which is the
     best the record can support. */
  const [writtenFrom, setWrittenFrom] = useState<Record<string, number>>({});
  const { bound, extra } = useMemo(
    () => bindProfiles(state.socials, writtenFrom),
    [state.socials, writtenFrom],
  );

  // The reference's `st.ans.socials.urls`. Seeded from the record and the only
  // copy from then on — a save that raced a keystroke would otherwise reinstate
  // the address the Founder had just deleted (§9).
  const [urls, setUrls] = useState<string[]>(() => ROWS.map((_, i) => bound[i]?.url ?? ''));
  // `st.socAdded` — the receipt, per row, for 1.7 seconds.
  const [added, setAdded] = useState<Record<number, true>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [said, setSaid] = useState('');
  const timers = useRef<number[]>([]);

  useEffect(
    () => () => {
      for (const id of timers.current) window.clearTimeout(id);
    },
    [],
  );

  // `fitStages`, for this screen. First, so the first paint is already at the
  // right scale — and on resize, because the reference refits there too.
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const fit = () => {
      el.style.transform = `translate(-50%, -50%) scale(${stageScale()})`;
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  // The entrance — `verifyIntro`'s `runRelay`, which is all this screen gets:
  // it has no `[data-anim="grow"]`, no cupids, no `[data-flourish]`, and it is
  // neither `[data-lastlook]` nor `[data-paynow]`, so every one of that
  // function's earlier branches is false.
  useLayoutEffect(() => stageRelayIn(root.current, direction.current ?? 1, RELAY), []);

  const locked = state.listingPaid;

  /**
   * `addSocial(i)`.
   *
   * Its empty branch is exactly the reference's — nudge the field, write
   * nothing, say nothing — and its success branch is the reference's receipt
   * around this product's actual write. Which write it is depends on what the
   * row already holds, because the row IS the record: a new address replaces
   * the one that was there, and the same address again is a re-check, which is
   * what pressing Add on an unchanged row means.
   */
  const submit = useCallback(
    async (index: number) => {
      if (locked || busy !== null) return;
      const row = rowEls.current[index];
      const value = (urls[index] ?? '').trim();

      if (!value) {
        socialNudge(row?.querySelector('input') ?? null);
        setSaid('Paste a link into this row first.');
        return;
      }

      const existing = bound[index];
      setBusy(index);
      try {
        if (existing && existing.url === value) {
          await refresh(recheckSocial(campaignId, existing.id));
        } else {
          if (existing) await refresh(removeSocial(campaignId, existing.id));
          // The control claim is never a default: a row nobody has confirmed is
          // written `false`, which is what it is (§28.4).
          const before = new Set(state.socials.map((s) => s.id));
          const result = await addSocial(campaignId, { url: value, controlsConfirmed: false });
          await refresh(Promise.resolve(result));
          // Remember which row wrote it, so the answer appears against the row
          // it was typed into rather than wherever its hostname sorts.
          const created = result.workspace.socials.find((s) => !before.has(s.id));
          if (created) setWrittenFrom((current) => ({ ...current, [created.id]: index }));
        }
        socialAddPop(row?.querySelector('button') ?? null);
        setAdded((current) => ({ ...current, [index]: true }));
        setSaid(`${ROWS[index]!.label} link saved. We are checking it opens.`);
        timers.current.push(
          window.setTimeout(() => {
            setAdded((current) => {
              const next = { ...current };
              delete next[index];
              return next;
            });
          }, ADDED_MS),
        );
      } catch {
        setSaid('We could not save that link. Try again.');
      } finally {
        setBusy(null);
      }
    },
    [locked, busy, urls, bound, state.socials, campaignId, refresh],
  );

  /** `socialsNext:()=>this.step({vReviewing:true,fromReview:false})` — Last look. */
  function next() {
    leave(founderFlowPath('last-look', campaignId), 1);
  }

  const readingCount = founderFlowIndex('socials') + 1;

  return (
    <div className="ff-soc" ref={root}>
      {/* The reference's own control, bottom-left. `back()` at `vStep` 7 goes to
          `vStep` 6, which is Your story — or to Last look when the row was
          opened from there, which is this product's own `?from=review`
          contract. Its label names where it goes only to a screen reader: the
          visible word is the reference's own `Back`. */}
      <button
        type="button"
        className="ff-soc__back"
        aria-label={fromReview ? 'Back to Last look' : 'Back to Your story'}
        onClick={() => leaveToPage(fromReview ? 'last-look' : 'story', -1)}
      >
        <svg
          viewBox="0 0 24 24"
          width="11"
          height="11"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M15 5 8 12l7 7" />
        </svg>
        Back
      </button>

      <div className="ff-soc__top">
        {/* Not a link. A campaign's own half-finished form is not a site, and
            the way out of one should not be the brand. */}
        <img className="ff-soc__logo" src="/assets/proovd-logo.svg" alt="Proovd" />
        <HelpDrawer
          pageId="socials"
          param={campaignId}
          trigger={
            <button type="button" className="ff-soc__help">
              Help
            </button>
          }
        />
      </div>

      {/* The reference's mail bell, bottom-right, opening the same drawer HELP
          does. See the header for what its number is and is not. */}
      <HelpDrawer
        pageId="socials"
        param={campaignId}
        trigger={
          <button
            type="button"
            className="ff-soc__mailbtn"
            aria-label={`Help and reading — ${readingCount} pages`}
          >
            <span className="ff-soc__mail" aria-hidden="true">
              <img src="/assets/mail.webp" alt="" />
              <span className="ff-soc__mailcount">{readingCount}</span>
            </span>
          </button>
        }
      />

      <div className="ff-soc__stage" data-page-stage="1" ref={stage}>
        <div className="ff-soc__col">
          {/* See the header. The visuals headline, measured and discarded, so
              the two screens share one column width. */}
          <span aria-hidden="true" className="ff-soc__measure">
            We want to see your product...
          </span>

          <h1 className="ff-soc__head" data-stage-anim="head">
            Links to your socials?
          </h1>

          <div className="ff-soc__panel" data-stage-anim="panel">
            {ROWS.map((row, index) => {
              const profile = bound[index];
              const value = urls[index] ?? '';
              const on = added[index] === true;
              return (
                <div
                  className="ff-soc__row"
                  /* The reference's own attribute on this element. */
                  data-soc-row="1"
                  key={row.id}
                  ref={(el) => {
                    rowEls.current[index] = el;
                  }}
                >
                  <span
                    className="ff-soc__icon"
                    style={{ backgroundImage: `url(${row.icon})` }}
                    aria-hidden="true"
                  />
                  <input
                    className="ff-soc__input"
                    type="url"
                    placeholder="paste your link"
                    aria-label={`${row.label} link`}
                    value={value}
                    readOnly={locked}
                    onChange={(event) => {
                      const nextValue = event.target.value;
                      setUrls((current) => current.map((v, i) => (i === index ? nextValue : v)));
                    }}
                  />
                  <button
                    type="button"
                    className={on ? 'ff-soc__add is-added' : 'ff-soc__add'}
                    disabled={locked || busy !== null}
                    onClick={() => void submit(index)}
                  >
                    {on ? (
                      <svg
                        viewBox="0 0 24 24"
                        width="42"
                        height="42"
                        fill="none"
                        stroke="#FAFAFA"
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M4 12.5 9.5 18 20 6.5" />
                      </svg>
                    ) : null}
                    {on ? 'Added' : 'Add'}
                  </button>

                  {/* §28.4 and §27.1, in the gap the composition already
                      leaves. Nothing above or beside it moves. */}
                  <span className="ff-soc__meta">
                    {locked ? (
                      <span className="ff-soc__note">
                        Your listing fee is paid, so this is locked as it was checked.
                      </span>
                    ) : profile ? (
                      <>
                        <label className="ff-soc__claim">
                          <input
                            type="checkbox"
                            checked={profile.controlsConfirmed}
                            onChange={(event) =>
                              void refresh(
                                confirmSocialControl(campaignId, profile.id, event.target.checked),
                              )
                            }
                          />
                          I control this profile
                        </label>
                        <span
                          className={
                            profile.accessible === true ? 'ff-soc__note is-ok' : 'ff-soc__note'
                          }
                        >
                          {profile.accessible === true
                            ? 'We opened it.'
                            : profile.rejection
                              ? rejectionText(profile.rejection)
                              : 'We have not been able to look at this one yet.'}
                        </span>
                        {profile.accessible === true ? null : (
                          <button
                            type="button"
                            className="ff-soc__mini"
                            onClick={() => void refresh(recheckSocial(campaignId, profile.id))}
                          >
                            Check it again
                          </button>
                        )}
                        <button
                          type="button"
                          className="ff-soc__mini"
                          onClick={() => {
                            setUrls((current) => current.map((v, i) => (i === index ? '' : v)));
                            void refresh(removeSocial(campaignId, profile.id));
                          }}
                        >
                          Remove
                        </button>
                      </>
                    ) : null}
                  </span>
                </div>
              );
            })}
          </div>

          <button type="button" className="ff-soc__cta" data-stage-anim="cta" onClick={next}>
            Next
          </button>

          {/* Absolutely positioned under the column, so neither can move the
              composition. The first is every state of a row, announced; the
              second is a record the four rows could not hold. */}
          <p className="ff-soc__live sr-only" role="status" aria-live="polite">
            {said}
          </p>
          {extra.length ? (
            <ul className="ff-soc__extra">
              {extra.map((profile) => (
                <li key={profile.id}>
                  {profile.handle ?? profile.url}
                  <button
                    type="button"
                    className="ff-soc__mini"
                    onClick={() => void refresh(removeSocial(campaignId, profile.id))}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </div>
  );
}
