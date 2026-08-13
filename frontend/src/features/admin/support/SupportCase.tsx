/**
 * Admin → Support → one case — Spec §26.7, §26.8, §27.8, §33.9.11.
 *
 * The header states where the case stands, and four tabs hold the rest:
 * Conversation, Case & ownership, Evidence & contact, History.
 *
 * ── One read, four tabs ─────────────────────────────────────────────────────
 * An Admin opening "Case & ownership" has already acted on what "Conversation"
 * told them, and a round trip per tab is a second chance for the two to
 * disagree about what state the case is in. So the whole case arrives in one
 * call and only the active tab mounts — the arrangement the Creator
 * relationship read records, for the same reason.
 *
 * ── The tab is in the URL ───────────────────────────────────────────────────
 * A tab is a position (DNA §5.12), and an Admin sending a colleague "look at
 * the evidence on PVD-…" needs the link to open there.
 *
 * ── Every write re-reads ────────────────────────────────────────────────────
 * No panel patches state locally. A locally-applied resolution is a claim about
 * a record nobody confirmed, and the one thing worse than a slow surface is one
 * that shows a decision that did not land.
 *
 * ── The rail is hand-built, not `components/Tabs.tsx` ───────────────────────
 * Same reason the Creator relationship rail is: §26.1's stylesheet uses
 * different markup. Roving `tabindex` with Arrow/Home/End, `role="tab"`, and
 * the panel labelled by its tab — §28.5's keyboard contract, met explicitly.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { Link as RouterLink, useParams, useSearchParams } from 'react-router';
import {
  SUPPORT_CASE_TABS,
  SUPPORT_CASE_TAB_LABELS,
  type SupportCaseTab,
} from '@proovd/shared';
import { Button, StatePanel } from '../../../components/index.js';
import { cn } from '../../../components/cn.js';
import { useProovdMotion } from '../../../motion/MotionProvider.js';
import { supportMailto } from '../../public/states.js';
import { fetchSupportCase, AdminRequestError, type SupportCaseDetail } from './api.js';
import { CaseChip, TriageFlag, Deadline, formatInstant } from './shared.js';
import { Conversation } from './panes/Conversation.js';
import { CaseOwnership } from './panes/CaseOwnership.js';
import { EvidenceContact } from './panes/EvidenceContact.js';
import { CaseHistory } from './panes/CaseHistory.js';

function isTab(value: string): value is SupportCaseTab {
  return (SUPPORT_CASE_TABS as readonly string[]).includes(value);
}

export function SupportCase() {
  const { caseId = '' } = useParams();
  const [detail, setDetail] = useState<SupportCaseDetail | null>(null);
  const [loadError, setLoadError] = useState<AdminRequestError | null>(null);
  const [params, setParams] = useSearchParams();
  const surface = useRef<HTMLDivElement>(null);
  const rail = useRef<HTMLDivElement>(null);

  const raw = params.get('tab') ?? 'conversation';
  const tab: SupportCaseTab = isTab(raw) ? raw : 'conversation';

  const load = useCallback(() => {
    setLoadError(null);
    fetchSupportCase(caseId)
      .then(setDetail)
      .catch((error: unknown) => {
        setLoadError(
          error instanceof AdminRequestError
            ? error
            : new AdminRequestError({
                error: 'unreachable',
                status: 0,
                title: 'Proovd could not be reached',
                whatHappened:
                  'This case could not be read, and the failure carried no explanation.',
                next: 'Try the read again. Nothing was changed by the attempt.',
              }),
        );
      });
  }, [caseId]);

  useEffect(load, [load]);
  useProovdMotion(surface, [detail, tab]);

  function chooseTab(next: SupportCaseTab) {
    const updated = new URLSearchParams(params);
    if (next === 'conversation') updated.delete('tab');
    else updated.set('tab', next);
    setParams(updated, { replace: true });
  }

  /**
   * Arrow keys move between tabs; Home and End jump to the ends.
   *
   * Roving `tabindex` means Tab enters the rail once and leaves it once, which
   * is what a tablist is supposed to do — without it a keyboard user tabs
   * through four controls to reach the panel (§28.5, §33.11.2).
   */
  function onRailKey(event: KeyboardEvent<HTMLDivElement>) {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const index = SUPPORT_CASE_TABS.indexOf(tab);
    const last = SUPPORT_CASE_TABS.length - 1;
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? last
          : event.key === 'ArrowLeft'
            ? (index - 1 + SUPPORT_CASE_TABS.length) % SUPPORT_CASE_TABS.length
            : (index + 1) % SUPPORT_CASE_TABS.length;
    chooseTab(SUPPORT_CASE_TABS[next]!);
    // Focus follows selection, which is the automatic-activation pattern this
    // rail uses — the panel is already rendered, so there is nothing to wait for.
    requestAnimationFrame(() => {
      rail.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
    });
  }

  const counts = useMemo(
    () =>
      detail ? { evidence: detail.evidence.length + detail.contacts.length } : { evidence: 0 },
    [detail],
  );

  if (loadError) {
    return (
      <StatePanel
        state={loadError.detail.title}
        whatHappened={loadError.detail.whatHappened}
        next={loadError.detail.next}
        owner="Proovd"
        nextUpdate="When you try again"
        action={
          <Button tier="primary" onClick={load}>
            Try again
          </Button>
        }
        reference="Support case"
        getHelp={{ href: supportMailto('A support case will not load') }}
        ring
      />
    );
  }

  if (!detail) {
    return (
      <StatePanel
        state="Opening the case"
        whatHappened="Proovd is reading the conversation, the evidence, and everything the case already knows."
        next="The case appears as soon as that comes back."
        owner="Proovd"
        nextUpdate="Within a few seconds"
        action="No action needed"
        reference="Support case"
      />
    );
  }

  const { header } = detail;
  // The band's emphasis is a server-resolved fact, not a guess: it is loud only
  // while the case is open AND Proovd owes the next move.
  const blocked = header.open && header.blockedOnProovd;

  return (
    <div ref={surface}>
      <nav className="sup-crumb" aria-label="Breadcrumb">
        <RouterLink to="/admin/support">← All cases</RouterLink>
      </nav>

      <header
        className={cn(
          'sup-band',
          blocked && 'sup-band--blocked',
          !header.open && 'sup-band--done',
        )}
      >
        <div className="sup-band__main">
          <div className="sup-band__title">
            <h1>{header.subject}</h1>
            <CaseChip chip={header.chip} />
          </div>
          <p className="sup-band__meta">
            <span className="mono">{header.reference}</span> · {header.requesterName} ·{' '}
            {header.requesterKindLabel}
            {header.campaignName ? ` · ${header.campaignName}` : ''} · opened{' '}
            {formatInstant(header.createdAt)}
          </p>

          {header.open ? (
            <p className="sup-band__next">
              <i aria-hidden="true" />
              {header.nextAction}
              {header.nextUpdateDue ? (
                <>
                  {' · customer update '}
                  <Deadline deadline={header.nextUpdateDue} />
                </>
              ) : null}
            </p>
          ) : (
            /*
              A finished case says what happened and offers no next step. §20's
              caught-up rule: there is nothing outstanding, and manufacturing a
              call to action here would be inventing work.
            */
            <p className="sup-band__calm">
              {detail.nextResponse.closedAt
                ? `Closed ${formatInstant(detail.nextResponse.closedAt)}. The whole conversation and the resolution stay on the record.`
                : `Resolved ${detail.nextResponse.resolvedAt ? formatInstant(detail.nextResponse.resolvedAt) : ''}${
                    detail.nextResponse.resolvedBy ? ` by ${detail.nextResponse.resolvedBy}` : ''
                  }.`}
            </p>
          )}
        </div>

        <div className="sup-band__side">
          <TriageFlag level={header.triage} label={`${header.triageLabel} triage`} />
          <span className="grey">{header.topicLabel}</span>
        </div>
      </header>

      <div
        ref={rail}
        className="sup-tabs"
        role="tablist"
        aria-label="Case sections"
        onKeyDown={onRailKey}
      >
        {SUPPORT_CASE_TABS.map((entry) => (
          <button
            key={entry}
            type="button"
            role="tab"
            id={`sup-tab-${entry}`}
            aria-selected={tab === entry}
            aria-controls={`sup-panel-${entry}`}
            tabIndex={tab === entry ? 0 : -1}
            className={cn('sup-tab', tab === entry && 'is-active')}
            onClick={() => chooseTab(entry)}
          >
            {SUPPORT_CASE_TAB_LABELS[entry]}
            {entry === 'evidence' && counts.evidence > 0 ? (
              <span className="sup-tab__count">{counts.evidence}</span>
            ) : null}
          </button>
        ))}
      </div>

      <div
        className="sup-panel"
        role="tabpanel"
        id={`sup-panel-${tab}`}
        aria-labelledby={`sup-tab-${tab}`}
        tabIndex={-1}
      >
        {tab === 'conversation' ? <Conversation detail={detail} onChanged={load} /> : null}
        {tab === 'case' ? <CaseOwnership detail={detail} onChanged={load} /> : null}
        {tab === 'evidence' ? <EvidenceContact detail={detail} onChanged={load} /> : null}
        {tab === 'history' ? <CaseHistory detail={detail} /> : null}
      </div>
    </div>
  );
}

/** The shape every pane takes. Re-read on change, never a local patch. */
export interface PaneProps {
  detail: SupportCaseDetail;
  onChanged: () => void;
}

/** Panes open their panels from the pressed control (DNA §6.5). */
export function useDialogTrigger() {
  const [trigger, setTrigger] = useState<HTMLElement | null>(null);
  const open = useCallback(
    (event: MouseEvent<HTMLElement>) => setTrigger(event.currentTarget),
    [],
  );
  const close = useCallback(() => setTrigger(null), []);
  return { trigger, open, close };
}
