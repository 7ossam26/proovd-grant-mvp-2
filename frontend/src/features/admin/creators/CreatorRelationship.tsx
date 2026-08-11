/**
 * Admin → Creators → one campaign relationship — Spec §14–§18, §22.1, §24.4,
 * §24.7, §26.1, §31.5.
 *
 * ── Four panes of one object, not four pages ────────────────────────────────
 * The reference's sticky rail is Overview / Agreement / Content / Money, and
 * they are four views of the same relationship rather than four documents. One
 * read fills all four, and only the active pane is mounted — the same
 * arrangement the Founder workspace uses, and for the same reason: four
 * simultaneous panes is four sets of headings a screen reader walks through to
 * reach the one being read.
 *
 * ── The tab list is hand-built, and its ARIA is reproduced explicitly ───────
 * `components/Tabs.tsx` exists, but §26.1's stylesheet uses different markup —
 * a rail rather than an underlined row — so the roving tabindex, the
 * Arrow/Home/End keys, and `aria-controls` are written out here. That is the
 * Founder workspace's own precedent, recorded there for the same reason.
 *
 * ── The campaign type leads ─────────────────────────────────────────────────
 * The reference's eyebrow is `{type} · {name} · Campaign relationship`, and the
 * order is deliberate: almost every rule on this screen differs between an Idea
 * and a Product campaign — the upfront fee exists for one and not the other —
 * so the type is read before anything it governs.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Link as RouterLink, useNavigate, useParams, useSearchParams } from 'react-router';
import { Button, StatePanel } from '../../../components/index.js';
import { cn } from '../../../components/cn.js';
import { moveTabUnderline } from '../../../components/anim.js';
import { useProovdMotion } from '../../../motion/MotionProvider.js';
import {
  fetchRelationship,
  AdminRequestError,
  type CreatorRelationshipDetail,
} from './api.js';
import { OwnerPill } from './shared.js';
import { RelOverview } from './panes/RelOverview.js';
import { RelAgreement } from './panes/RelAgreement.js';
import { RelContent } from './panes/RelContent.js';
import { RelMoney } from './panes/RelMoney.js';

const PANES = [
  { key: 'overview', label: 'Overview' },
  { key: 'agreement', label: 'Agreement' },
  { key: 'content', label: 'Content' },
  { key: 'money', label: 'Money' },
] as const;

type PaneKey = (typeof PANES)[number]['key'];

function isPane(value: string): value is PaneKey {
  return PANES.some((pane) => pane.key === value);
}

export function CreatorRelationship() {
  const { prospectId = '', associationId = '' } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [detail, setDetail] = useState<CreatorRelationshipDetail | null>(null);
  const [loadError, setLoadError] = useState<AdminRequestError | null>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const markRef = useRef<HTMLSpanElement>(null);

  const raw = params.get('pane') ?? 'overview';
  const pane: PaneKey = isPane(raw) ? raw : 'overview';

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setDetail(await fetchRelationship(prospectId, associationId));
    } catch (error: unknown) {
      setLoadError(
        error instanceof AdminRequestError
          ? error
          : new AdminRequestError({
              error: 'unreachable',
              status: 0,
              title: 'Proovd could not be reached',
              whatHappened:
                'This campaign relationship could not be read, and the failure carried no explanation.',
              next: 'Try the read again. Nothing was changed by the attempt.',
            }),
      );
    }
  }, [prospectId, associationId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Two scopes, deliberately: one root would replay the band's reveal on every
  // tab press, which is the animation that turns a workspace into a slideshow.
  useProovdMotion(headerRef, [detail]);
  useProovdMotion(paneRef, [detail, pane]);

  /*
   * The mark follows the active tab.
   *
   * `moveTabUnderline` takes the mark and the element it should sit against; it
   * is a no-op without GSAP, which is the documented jump-cut path — the rail's
   * `is-active` weight and `aria-selected` carry the state on their own, so
   * nothing here is colour-only or motion-only (§33.11).
   */
  useEffect(() => {
    const active = railRef.current?.querySelector<HTMLElement>(`[data-tab="${pane}"]`) ?? null;
    if (markRef.current) moveTabUnderline(markRef.current, active, true);
  }, [pane, detail]);

  function choosePane(next: PaneKey) {
    const updated = new URLSearchParams(params);
    if (next === 'overview') updated.delete('pane');
    else updated.set('pane', next);
    setParams(updated, { replace: true });
  }

  /** Arrow/Home/End across the rail, as a tablist owes (§28.5). */
  function onTabKeys(event: KeyboardEvent<HTMLDivElement>) {
    const index = PANES.findIndex((entry) => entry.key === pane);
    let target = index;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') target = index + 1;
    else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') target = index - 1;
    else if (event.key === 'Home') target = 0;
    else if (event.key === 'End') target = PANES.length - 1;
    else return;
    event.preventDefault();
    const next = PANES[(target + PANES.length) % PANES.length]!;
    choosePane(next.key);
    railRef.current?.querySelector<HTMLElement>(`[data-tab="${next.key}"]`)?.focus();
  }

  const tasks = useMemo(() => detail?.overview.tasks ?? [], [detail]);

  if (loadError) {
    return (
      <StatePanel
        state={loadError.detail.title}
        whatHappened={
          loadError.detail.whatHappened ??
          'This campaign relationship could not be read, so nothing on this page is current.'
        }
        next={loadError.detail.next ?? 'Try the read again. Nothing was changed by the attempt.'}
        owner="Proovd"
        nextUpdate="When you try again"
        action={
          <Button tier="secondary" onClick={() => void load()}>
            Try the read again
          </Button>
        }
        reference="Admin · Creators"
        ring
      />
    );
  }

  if (!detail) {
    return (
      <StatePanel
        state="Reading this campaign relationship"
        whatHappened="Proovd is reading the terms, the link, the readiness checklist, the content, and the money."
        next="The relationship appears as soon as that comes back."
        owner="Proovd"
        nextUpdate="Within a few seconds"
        action="No action needed"
        reference="Admin · Creators"
      />
    );
  }

  const { band } = detail;

  return (
    <div>
      <div ref={headerRef}>
        <header className="cr-context">
          <RouterLink className="crumb" to={`/admin/creators/${prospectId}`}>
            ← Back to {detail.creatorName}
          </RouterLink>
          <div>
            {/* The campaign type leads — see the file header. */}
            <p className="kicker">
              {[band.campaignType, detail.creatorName, 'Campaign relationship']
                .filter(Boolean)
                .join(' · ')}
            </p>
            <h1 className="cr-context__title" data-reveal="headline">
              {band.campaignName}
            </h1>
          </div>
        </header>

        <section className="cr-state">
          <div>
            {band.campaignType ? (
              <span className="cr-state__badge">{band.campaignType}</span>
            ) : null}
            <h2>{band.status}</h2>
            <OwnerPill owner={band.owner} prefix />
          </div>
          <dl>
            <div>
              <dt>Activated</dt>
              <dd>{band.activatedAt ?? <span className="grey">Not activated yet</span>}</dd>
            </div>
            <div>
              <dt>Closes</dt>
              <dd>{band.closesAt ?? <span className="grey">Not scheduled yet</span>}</dd>
            </div>
            <div>
              <dt>Designation</dt>
              <dd>{band.designation}</dd>
            </div>
            {band.responseDeadlineAt ? (
              <div>
                <dt>Formal response deadline</dt>
                {/*
                  §14.6's one fixed window, from `listing_paid_at`. Rendered from
                  the stored evaluation rather than computed here — a deadline a
                  surface works out is one that can disagree with the sweep.
                */}
                <dd>{band.responseDeadlineAt}</dd>
              </div>
            ) : null}
          </dl>
        </section>
      </div>

      <div className="cr-shell">
        <div
          className="cr-rail"
          role="tablist"
          aria-orientation="vertical"
          aria-label="Campaign relationship sections"
          ref={railRef}
          onKeyDown={onTabKeys}
        >
          {PANES.map((entry) => {
            const active = entry.key === pane;
            return (
              <button
                key={entry.key}
                type="button"
                role="tab"
                data-tab={entry.key}
                id={`cr-tab-${entry.key}`}
                className={cn('cr-rail__btn', active && 'is-active')}
                aria-selected={active}
                {...(active ? { 'aria-controls': `cr-pane-${entry.key}` } : {})}
                tabIndex={active ? 0 : -1}
                onClick={() => choosePane(entry.key)}
              >
                {entry.label}
                {/*
                  The one count on the rail, and it is a real one: a submitted
                  post is an Admin task with a record behind it. A badge on
                  every tab would be the widget grid §20 refuses.
                */}
                {entry.key === 'content' && detail.content.submission?.status === 'submitted' ? (
                  <span className="cr-rail__count" aria-label="1 item waiting">
                    1
                  </span>
                ) : null}
              </button>
            );
          })}
          <span className="cr-rail__mark" ref={markRef} aria-hidden="true" />
        </div>

        <div
          className="cr-pane"
          id={`cr-pane-${pane}`}
          role="tabpanel"
          aria-labelledby={`cr-tab-${pane}`}
          tabIndex={0}
          ref={paneRef}
        >
          {/* Only the active pane is mounted — see the file header. */}
          {pane === 'overview' ? (
            <RelOverview
              detail={detail}
              tasks={tasks}
              onGo={(to) => {
                if (to === 'profile') {
                  void navigate(`/admin/creators/${prospectId}/profile`);
                  return;
                }
                if (to === 'review') {
                  void navigate(
                    `/admin/creators/${prospectId}/relationships/${associationId}/review`,
                  );
                  return;
                }
                choosePane(to);
              }}
              onChanged={setDetail}
            />
          ) : null}
          {pane === 'agreement' ? <RelAgreement detail={detail} /> : null}
          {pane === 'content' ? (
            <RelContent
              detail={detail}
              onReview={() =>
                void navigate(`/admin/creators/${prospectId}/relationships/${associationId}/review`)
              }
            />
          ) : null}
          {pane === 'money' ? <RelMoney detail={detail} /> : null}
        </div>
      </div>
    </div>
  );
}
