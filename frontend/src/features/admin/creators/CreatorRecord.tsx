/**
 * Admin → Creators → one Affiliate — the eight-tab record shell.
 * Spec §26.1, §8, §11, §2.2, §14.2, DNA §5.12, §5.14. Rebuilt to the supplied
 * reference 2026-08-17 (Session A — docs/phases/admin-affiliate-rebuild.md;
 * docs/phases/admin-affiliate-reconciliation.md is the walk).
 *
 * ── One route, and the view state lives in the URL ──────────────────────────
 * `?tab=` is one of the eight `AFFILIATE_RECORD_TABS`, `?section=` one of the
 * tab's sections, `?rel=` the selected campaign relationship. The bare address
 * is Overview. The Founders workspace established the pattern
 * (`FounderWorkspace.tsx`): defaults are DELETED from the URL so the canonical
 * address stays short, and changing tab drops the section but keeps the
 * relationship — an Admin comparing one relationship across three tabs is the
 * whole reason the selection is shared state.
 *
 * ── The Selected-relationship switcher replaces an address ──────────────────
 * The reference scopes the campaign-facing tabs (Campaigns, Content &
 * Compliance, Performance & Earnings) by a persistent switcher rather than by
 * today's separate `/relationships/:associationId` address. Session A ships
 * the switcher and the selection; the old address stays alive — and is what
 * the interim sections link to — until Session C absorbs its four panes,
 * because the Support workspace and the Tasks panel both point at it and a
 * link that 404s mid-rebuild is a broken promise.
 *
 * ── Interim sections say what they are (§1.4) ───────────────────────────────
 * Only Overview is in its final shape this session. Every other section
 * renders the surface's honest state: its own h1, the facts that already
 * exist (the Selected-relationship strip on campaign-scoped sections), which
 * existing surface owns the content today with a real route to it, and which
 * session replaces it. The Founders rebuild recorded the same posture: an
 * interim that says what it is beats a mock.
 *
 * ── Every action the header offers came from the server ─────────────────────
 * `header.availableActions` is walked, never composed here. The attention
 * object's control is decided by the OWNER and routed by the TYPED attention
 * kind — the reference sniffs substrings of its own label to route, which is
 * exactly the fragility a register exists to prevent.
 */

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link as RouterLink, useNavigate, useParams, useSearchParams } from 'react-router';
import {
  ACCOUNT_AND_CAMPAIGN_STATE_SEPARATE,
  ACTIVE_PARTNERSHIP_LABEL,
  AFFILIATE_RECORD_TABS,
  CREATOR_NO_ATTENTION_LABEL,
  CREATOR_SUSPENSION_IS_NOT_A_BAN,
  SELECTED_RELATIONSHIP_LABEL,
  affiliateRecordTab,
  type AffiliateRecordTabKey,
} from '@proovd/shared';
import { Button, StatePanel } from '../../../components/index.js';
import { cn } from '../../../components/cn.js';
import { useProovdMotion } from '../../../motion/MotionProvider.js';
import {
  fetchCreator,
  AdminRequestError,
  type CreatorRelationshipSummary,
  type CreatorWorkspaceDetail,
} from './api.js';
import {
  AttentionObject,
  Fact,
  FactsStrip,
  Monogram,
  OwnerPill,
  Section,
  StateChip,
  payoutTone,
  verificationTone,
} from './shared.js';
import { useCreatorParked } from './parked.js';
import { AssignCampaignDialog } from './dialogs/AssignCampaignDialog.js';
import { DeletionRequestDialog } from './dialogs/DeletionRequestDialog.js';
import { CreatorSearch } from './CreatorSearch.js';
import { ProfileTabSection } from './sections/ProfileSections.js';
import { AccountTabSection } from './sections/AccountSections.js';

type OpenDialog =
  | { kind: 'assign'; trigger: HTMLElement | null }
  | { kind: 'deletion'; trigger: HTMLElement | null };

type SectionDef = { readonly key: string; readonly label: string };

/* ── The interim map: which surface owns each un-rebuilt section today ──────
 *
 * `session` names the session that replaces the interim; `href` is the real
 * route to the surface that currently owns the content, or null when the
 * content is genuinely new (the 0048 records with no surface yet), in which
 * case `note` says what exists and what is coming. Relationship-scoped hrefs
 * receive the selected association id and return null without one.            */
const INTERIM: Record<
  string,
  {
    session: 'B' | 'C';
    owner: string | null;
    href: (prospectId: string, rel: string | null) => string | null;
    note?: string;
  }
> = {
  'campaigns/relationships': {
    session: 'C',
    owner: 'the campaign relationship surface',
    href: (p, rel) => (rel ? `/admin/creators/${p}/relationships/${rel}` : null),
  },
  'campaigns/negotiations': {
    session: 'C',
    owner: 'the relationship Agreement pane',
    href: (p, rel) => (rel ? `/admin/creators/${p}/relationships/${rel}?pane=agreement` : null),
  },
  'campaigns/readiness': {
    session: 'C',
    owner: 'the relationship Overview pane',
    href: (p, rel) => (rel ? `/admin/creators/${p}/relationships/${rel}?pane=overview` : null),
  },
  'campaigns/completion': {
    session: 'C',
    owner: 'the relationship Money pane',
    href: (p, rel) => (rel ? `/admin/creators/${p}/relationships/${rel}?pane=money` : null),
  },
  'content/posts': {
    session: 'C',
    owner: 'the relationship Content pane',
    href: (p, rel) => (rel ? `/admin/creators/${p}/relationships/${rel}?pane=content` : null),
  },
  'content/deliverables': {
    session: 'C',
    owner: null,
    href: () => null,
    note:
      'The deliverable, evidence, and decision records exist as of migration 0048, ' +
      'insert-only in the §22.4 idiom. The review surface arrives with Session C; ' +
      'nothing writes them yet.',
  },
  'content/disclosures': {
    session: 'C',
    owner: 'the relationship Overview pane',
    href: (p, rel) => (rel ? `/admin/creators/${p}/relationships/${rel}?pane=overview` : null),
  },
  'content/risk': { session: 'C', owner: 'Account controls', href: (p) => `/admin/creators/${p}/controls` },
  'performance/performance': {
    session: 'C',
    owner: 'the relationship Content pane',
    href: (p, rel) => (rel ? `/admin/creators/${p}/relationships/${rel}?pane=content` : null),
  },
  'performance/earnings': {
    session: 'C',
    owner: 'the relationship Money pane',
    href: (p, rel) => (rel ? `/admin/creators/${p}/relationships/${rel}?pane=money` : null),
  },
  'performance/transfers': {
    session: 'C',
    owner: 'the relationship Money pane',
    href: (p, rel) => (rel ? `/admin/creators/${p}/relationships/${rel}?pane=money` : null),
  },
  'performance/adjustments': {
    session: 'C',
    owner: null,
    href: () => null,
    note:
      'Adjustments route into the §24.8 cause-allocation path — recorded causes, ' +
      'preview, then execute — never a second earnings editor. The surface that ' +
      'routes there arrives with Session C.',
  },
  'support/support': { session: 'C', owner: 'Account controls', href: (p) => `/admin/creators/${p}/controls` },
  'support/requests': {
    session: 'C',
    owner: null,
    href: () => null,
    note:
      'The active-termination-request record exists as of migration 0048, with its ' +
      '§24.8 cause and money treatment CHECK-matrixed. The intake surface arrives ' +
      'with Session C; it decides no money.',
  },
  'support/enforcement': { session: 'C', owner: 'Account controls', href: (p) => `/admin/creators/${p}/controls` },
  'support/appeals': { session: 'C', owner: 'Account controls', href: (p) => `/admin/creators/${p}/controls` },
  'history/timeline': { session: 'C', owner: 'the history surface', href: (p) => `/admin/creators/${p}/history` },
  'history/communications': {
    session: 'C',
    owner: null,
    href: () => null,
    note:
      'The record already exists: notification_deliveries holds recipient, template, ' +
      'delivery state, and dedup key for every message. The read arrives with ' +
      'Session C — the reference derives this list by regex over event titles, ' +
      'which is a mock, not a message store.',
  },
};

/* ── The reference's eyebrow per tab ────────────────────────────────────────*/
function tabEyebrow(name: string, tab: AffiliateRecordTabKey): string {
  if (tab === 'campaigns' || tab === 'content' || tab === 'performance') {
    return `${name} · Affiliate×Campaign`;
  }
  if (tab === 'support') return `${name} · Account and relationship controls`;
  if (tab === 'history') return `${name} · Immutable · read only`;
  return `${name} · Affiliate account`;
}

export function CreatorRecord() {
  const { prospectId = '' } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [detail, setDetail] = useState<CreatorWorkspaceDetail | null>(null);
  const [loadError, setLoadError] = useState<AdminRequestError | null>(null);
  const [dialog, setDialog] = useState<OpenDialog | null>(null);
  const surface = useRef<HTMLDivElement>(null);
  const parked = useCreatorParked();

  /* ── View state, all of it in the URL (DNA §5.12) ─────────────────────────*/
  const rawTab = params.get('tab') ?? 'overview';
  const tabDef = affiliateRecordTab(rawTab) ?? AFFILIATE_RECORD_TABS[0];
  const tab = tabDef.key;
  const sections = tabDef.sections as readonly SectionDef[];

  const rawSection = params.get('section');
  const section =
    sections.length === 0
      ? null
      : (sections.find((s) => s.key === rawSection) ?? sections[0]);

  const setView = useCallback(
    (nextTab: AffiliateRecordTabKey, nextSection?: string, nextRel?: string) => {
      const updated = new URLSearchParams(params);
      if (nextTab === 'overview') updated.delete('tab');
      else updated.set('tab', nextTab);
      const def = affiliateRecordTab(nextTab)!;
      const defSections = def.sections as readonly SectionDef[];
      // The first section is the bare address, exactly as Overview is the
      // bare tab — defaults never appear in the URL.
      if (!nextSection || defSections.length === 0 || defSections[0]?.key === nextSection) {
        updated.delete('section');
      } else {
        updated.set('section', nextSection);
      }
      if (nextRel !== undefined) {
        if (nextRel === '') updated.delete('rel');
        else updated.set('rel', nextRel);
      }
      setParams(updated, { replace: true });
    },
    [params, setParams],
  );

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setDetail(await fetchCreator(prospectId));
    } catch (error: unknown) {
      setLoadError(
        error instanceof AdminRequestError
          ? error
          : new AdminRequestError({
              error: 'unreachable',
              status: 0,
              title: 'Proovd could not be reached',
              whatHappened:
                'This Affiliate record could not be read, and the failure carried no explanation.',
              next: 'Try the read again. Nothing was changed by the attempt.',
            }),
      );
    }
  }, [prospectId]);

  useEffect(() => {
    void load();
  }, [load]);

  useProovdMotion(surface, [detail, tab, section?.key]);

  /* ── Roving tabindex for both rails (§28.5) ───────────────────────────────*/
  function railKeys(keys: readonly string[], active: string, choose: (key: string) => void) {
    return (event: KeyboardEvent<HTMLElement>) => {
      const index = keys.indexOf(active);
      let next: number | null = null;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % keys.length;
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp')
        next = (index - 1 + keys.length) % keys.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = keys.length - 1;
      if (next === null) return;
      event.preventDefault();
      choose(keys[next]);
      const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]');
      buttons[next]?.focus();
    };
  }

  if (loadError) {
    return (
      <StatePanel
        state={loadError.detail.title}
        whatHappened={
          loadError.detail.whatHappened ??
          'This Affiliate record could not be read, so nothing on this page is current.'
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
        state="Reading this Affiliate"
        whatHappened="Proovd is reading their profile, evidence, campaign relationships, and history."
        next="The record appears as soon as that comes back."
        owner="Proovd"
        nextUpdate="Within a few seconds"
        action="No action needed"
        reference="Admin · Creators"
      />
    );
  }

  const { header, relationships } = detail;
  const attention = header.attention.needed ? header.attention : null;

  /* The selected relationship: `?rel=`, falling back to the first. A stale id
     (a relationship that stopped existing between visits) falls back too,
     rather than rendering campaign tabs against nothing. */
  const rawRel = params.get('rel');
  const selectedRel =
    relationships.find((r) => r.associationId === rawRel) ?? relationships[0] ?? null;

  const paneId = `cr-pane-${prospectId}`;
  const activeRailKey = section ? section.key : tab;

  return (
    <div ref={surface}>
      {/* The workspace navigation — context strip, the eight tabs, and the
          active tab's sections. Sits above the identity band, as the
          reference draws it. */}
      <div className="cr-wnav">
        <div className="cr-wnav__context">
          <Monogram>{header.initials}</Monogram>
          <span className="cr-wnav__who">
            <strong>{header.name}</strong>
            <small>Affiliate account · {header.prospectId}</small>
          </span>
          {attention ? (
            <b className="cr-wnav__attention">
              {attention.owner} · {attention.label}
            </b>
          ) : null}
          {/* The `/` palette, reachable from the record too — one source, the
              server-composed searchText, so it can never disagree with the
              directory about what matches. */}
          <span className="cr-wnav__tools">
            <CreatorSearch />
          </span>
        </div>

        <nav
          className="cr-wtabs"
          role="tablist"
          aria-label={`${header.name} Affiliate record tabs`}
          onKeyDown={railKeys(
            AFFILIATE_RECORD_TABS.map((t) => t.key),
            tab,
            (key) => setView(key as AffiliateRecordTabKey),
          )}
        >
          {AFFILIATE_RECORD_TABS.map((entry) => (
            <button
              key={entry.key}
              type="button"
              role="tab"
              id={`cr-tab-${entry.key}`}
              aria-selected={entry.key === tab}
              aria-controls={paneId}
              tabIndex={entry.key === tab ? 0 : -1}
              className={cn('cr-wtabs__tab', entry.key === tab && 'is-active')}
              onClick={() => setView(entry.key)}
            >
              {entry.label}
              {entry.key === 'campaigns' && relationships.length > 0 ? (
                <span className="cr-wtabs__count">{relationships.length}</span>
              ) : null}
            </button>
          ))}
        </nav>

        {sections.length > 0 ? (
          <nav
            className="cr-wsecs"
            role="tablist"
            aria-label={`${tabDef.label} sections`}
            onKeyDown={railKeys(
              sections.map((s) => s.key),
              section?.key ?? sections[0].key,
              (key) => setView(tab, key),
            )}
          >
            {sections.map((entry) => (
              <button
                key={entry.key}
                type="button"
                role="tab"
                id={`cr-sec-${entry.key}`}
                aria-selected={entry.key === section?.key}
                aria-controls={paneId}
                tabIndex={entry.key === section?.key ? 0 : -1}
                className={cn('cr-wsecs__sec', entry.key === section?.key && 'is-active')}
                onClick={() => setView(tab, entry.key)}
              >
                {entry.label}
              </button>
            ))}
          </nav>
        ) : null}
      </div>

      {/* The Selected-relationship switcher — persistent across the three
          campaign-scoped tabs, and the sentence is the organising rule. */}
      {tabDef.relationshipScoped ? (
        <div className="cr-switcher">
          <span>
            <strong>{SELECTED_RELATIONSHIP_LABEL}</strong>
            <small>{ACCOUNT_AND_CAMPAIGN_STATE_SEPARATE}</small>
          </span>
          {relationships.length === 0 ? (
            <p className="grey">
              No campaign relationship yet. Assigning one records a prospect-state
              relationship — it sends nothing.
            </p>
          ) : (
            <label className="cr-switcher__pick">
              <span className="sr-only">Select campaign relationship</span>
              <select
                className="input"
                value={selectedRel?.associationId ?? ''}
                onChange={(event) => setView(tab, section?.key, event.target.value)}
              >
                {relationships.map((r) => (
                  <option key={r.associationId} value={r.associationId}>
                    {r.campaignName} · {r.status}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      ) : null}

      <div
        role="tabpanel"
        id={paneId}
        aria-labelledby={section ? `cr-sec-${section.key}` : `cr-tab-${tab}`}
        tabIndex={0}
      >
        {tab === 'overview' ? (
          <OverviewTab
            detail={detail}
            onOpenDialog={setDialog}
            onOpenTab={(t, s) => setView(t, s)}
            onOpenRelationship={(associationId) =>
              setView('campaigns', 'readiness', associationId)
            }
            parked={parked}
            navigate={(to) => void navigate(to)}
            prospectId={header.prospectId}
          />
        ) : tab === 'profile' ? (
          <div className="cr-record">
            {/* Every page owes one h1 (§33.11.2) — the tab's eyebrow pattern,
                exactly as the reference draws each tab's own heading. */}
            <header className="cr-tabhead">
              <p className="kicker">{tabEyebrow(header.name, 'profile')}</p>
              <h1 className="cr-tabhead__title">{section!.label}</h1>
            </header>
            <ProfileTabSection
              sectionKey={section!.key}
              detail={detail}
              onDone={setDetail}
            />
          </div>
        ) : tab === 'account' ? (
          <div className="cr-record">
            <header className="cr-tabhead">
              <p className="kicker">{tabEyebrow(header.name, 'account')}</p>
              <h1 className="cr-tabhead__title">{section!.label}</h1>
            </header>
            <AccountTabSection
              sectionKey={section!.key}
              detail={detail}
              onDone={setDetail}
            />
          </div>
        ) : (
          <InterimSection
            name={header.name}
            tab={tabDef.key}
            tabLabel={tabDef.label}
            section={section!}
            prospectId={header.prospectId}
            relationshipScoped={tabDef.relationshipScoped}
            selectedRel={tabDef.relationshipScoped || tab === 'support' ? selectedRel : null}
            navigate={(to) => void navigate(to)}
          />
        )}
      </div>

      {dialog?.kind === 'assign' ? (
        <AssignCampaignDialog
          prospectId={header.prospectId}
          trigger={dialog.trigger}
          onClose={() => setDialog(null)}
          onDone={(next) => {
            // Never patched locally: the server's re-read is the answer, and a
            // locally-edited copy is a claim about an outcome nobody confirmed.
            setDetail(next);
            setDialog(null);
          }}
        />
      ) : null}

      {dialog?.kind === 'deletion' ? (
        <DeletionRequestDialog
          prospectId={header.prospectId}
          trigger={dialog.trigger}
          onClose={() => setDialog(null)}
          onDone={(next) => {
            setDetail(next);
            setDialog(null);
          }}
        />
      ) : null}
    </div>
  );
}

/* ── The Overview tab — final shape (Session A) ─────────────────────────────*/

function OverviewTab({
  detail,
  onOpenDialog,
  onOpenTab,
  onOpenRelationship,
  parked,
  navigate,
  prospectId,
}: {
  detail: CreatorWorkspaceDetail;
  onOpenDialog: (dialog: OpenDialog) => void;
  onOpenTab: (tab: AffiliateRecordTabKey, section?: string) => void;
  onOpenRelationship: (associationId: string) => void;
  parked: ReturnType<typeof useCreatorParked>;
  navigate: (to: string) => void;
  prospectId: string;
}) {
  const { header, relationships } = detail;
  const attention = header.attention.needed ? header.attention : null;
  const canAssign = header.availableActions.includes('assign');
  const canRecordDeletion = header.availableActions.includes('deletion');

  /*
   * The attention control, decided by the OWNER and routed by the TYPED kind.
   * Admin gets the primary review action; Founder gets the proposal view;
   * Stripe gets the (parked until Session C) payout reminder; an
   * Affiliate-owned item gets no control at all — the next move is theirs,
   * and offering Proovd a button for somebody else's work is §1.4's failure.
   */
  function attentionControl() {
    if (!attention) return null;
    const rel = attention.associationId;
    if (attention.owner === 'Admin') {
      /*
       * Session B: the person-level destinations are the rebuilt tabs, so a
       * verification review opens Profile & Verification → Verification and
       * an unsent invitation opens Account & Payout Setup → Account &
       * Eligibility. The campaign-scoped destinations stay on the old
       * addresses until Session C absorbs them.
       */
      const tabRoute: Record<string, { label: string; tab: AffiliateRecordTabKey; section: string }> = {
        verification_due: { label: 'Review verification evidence', tab: 'profile', section: 'verification' },
        invitation_unsent: { label: 'Review invitation delivery', tab: 'account', section: 'eligibility' },
      };
      const viaTab = tabRoute[attention.kind];
      if (viaTab) {
        return (
          <Button onClick={() => onOpenTab(viaTab.tab, viaTab.section)}>{viaTab.label}</Button>
        );
      }
      const route: Record<string, { label: string; to: string }> = {
        post_review_due: {
          label: 'Review submitted post',
          to: rel
            ? `/admin/creators/${prospectId}/relationships/${rel}/review`
            : `/admin/creators/${prospectId}`,
        },
        earnings_decision_due: {
          label: 'Review successful completion',
          to: rel
            ? `/admin/creators/${prospectId}/relationships/${rel}?pane=money`
            : `/admin/creators/${prospectId}`,
        },
        account_suspended: {
          label: 'Review Admin decision',
          to: `/admin/creators/${prospectId}/controls`,
        },
        transfer_failed: {
          label: 'Review Admin decision',
          to: rel
            ? `/admin/creators/${prospectId}/relationships/${rel}?pane=money`
            : `/admin/creators/${prospectId}/controls`,
        },
      };
      const target = route[attention.kind] ?? {
        label: 'Review Admin decision',
        to: `/admin/creators/${prospectId}/controls`,
      };
      return <Button onClick={() => navigate(target.to)}>{target.label}</Button>;
    }
    if (attention.owner === 'Founder' && rel) {
      return (
        <Button
          tier="secondary"
          onClick={() => navigate(`/admin/creators/${prospectId}/relationships/${rel}?pane=agreement`)}
        >
          View commercial proposal
        </Button>
      );
    }
    if (attention.owner === 'Stripe') {
      return (
        <Button tier="secondary" {...parked('payoutReminder')}>
          Send payout reminder
        </Button>
      );
    }
    return null;
  }

  return (
    <>
      <section className="cr-band">
        <div className="cr-band__top">
          <RouterLink className="crumb" to="/admin/creators">
            ← All Affiliates
          </RouterLink>
          {/*
            The prospect id, quotable on a support call. Rendered as the record
            reference rather than as a decorative code — there is no `AF-1048`
            scheme in this product, and inventing one would be a second identity
            for a row that already has one.
          */}
          <span className="cr-band__ref">{header.prospectId}</span>
        </div>

        <div className="cr-band__identity">
          <Monogram large>{header.initials}</Monogram>
          <div>
            <p className="kicker">
              {[header.subtype, header.niche].filter(Boolean).join(' · ') ||
                'Subtype not recorded'}
            </p>
            <h1 className="cr-band__name">{header.name}</h1>
            {header.channelUrl ? (
              <a
                className="cr-band__channel"
                href={header.channelUrl}
                target="_blank"
                rel="noreferrer"
                data-press
              >
                {[header.handle, header.platform].filter(Boolean).join(' · ')}
              </a>
            ) : (
              <p className="grey">
                {[header.handle, header.platform].filter(Boolean).join(' · ') ||
                  'No channel recorded'}
              </p>
            )}
            {header.location ? <p className="grey">{header.location}</p> : null}
          </div>
          <div className="cr-band__actions">
            <Button tier="secondary" small onClick={() => onOpenTab('profile', 'profile')}>
              View profile &amp; evidence
            </Button>
            {/* The reference's own destination: the controls are the
                enforcement section, not the account tab. */}
            <Button tier="secondary" small onClick={() => onOpenTab('support', 'enforcement')}>
              View account controls
            </Button>
            <Button tier="tertiary" small onClick={() => onOpenTab('history', 'timeline')}>
              View full history
            </Button>
          </div>
        </div>

        <FactsStrip>
          <Fact label="Verification">
            <StateChip tone={verificationTone(header.verification.state)}>
              {header.verification.label}
            </StateChip>
          </Fact>
          <Fact label={ACTIVE_PARTNERSHIP_LABEL}>
            {header.slots.used} of {header.slots.limit}
          </Fact>
          <Fact label="Payout">
            <StateChip tone={payoutTone(header.payout.state)}>{header.payout.label}</StateChip>
          </Fact>
          <Fact label="Account">{header.account}</Fact>
        </FactsStrip>
      </section>

      <div className="cr-record">
        {attention ? (
          <AttentionObject
            owner={attention.owner}
            label={attention.label}
            detail={attention.detail}
            action={attentionControl()}
          />
        ) : (
          <p className="cr-caught-up">{CREATOR_NO_ATTENTION_LABEL}</p>
        )}

        <Section
          eyebrow="Campaign relationships"
          title={`${relationships.length} campaign${relationships.length === 1 ? '' : 's'}`}
          actions={
            canAssign ? (
              <Button
                tier="secondary"
                small
                onClick={(event) =>
                  onOpenDialog({ kind: 'assign', trigger: event.currentTarget })
                }
              >
                Assign to another campaign
              </Button>
            ) : null
          }
        >
          {relationships.length === 0 ? (
            <p className="grey">
              No campaign relationship yet. Assigning one records a prospect-state
              relationship — it sends nothing, and the invitation is a separate act.
            </p>
          ) : (
            <div className="cr-rel-list">
              {relationships.map((relationship) => (
                <article className="cr-rel" key={relationship.associationId}>
                  <span
                    className={
                      relationship.holdsSlot ? 'cr-rel__mark cr-rel__mark--live' : 'cr-rel__mark'
                    }
                    aria-hidden="true"
                  />
                  <span className="cr-rel__main">
                    <strong>{relationship.campaignName}</strong>
                    <small>
                      {[relationship.founderName, relationship.designation]
                        .filter(Boolean)
                        .join(' · ')}
                    </small>
                  </span>
                  <OwnerPill owner={relationship.owner} prefix />
                  <span className="cr-rel__state">
                    <strong>{relationship.status}</strong>
                    <small>
                      {relationship.closesAt
                        ? `Closes ${relationship.closesAt}`
                        : relationship.campaignType ?? 'Campaign type not set'}
                    </small>
                  </span>
                  <Button
                    tier="secondary"
                    small
                    onClick={() => onOpenRelationship(relationship.associationId)}
                  >
                    View campaign relationship
                  </Button>
                </article>
              ))}
            </div>
          )}
        </Section>

        <section className="cr-quiet">
          <div>
            <strong>{header.verification.label}</strong>
            <small>
              {header.verification.missing.length === 0
                ? 'Every §5.3 evidence input for this subtype is recorded'
                : `${header.verification.missing.length} §5.3 evidence ${header.verification.missing.length === 1 ? 'input' : 'inputs'} outstanding`}
            </small>
          </div>
          <div>
            <strong>{header.payout.label}</strong>
            <small>Stripe-owned state</small>
          </div>
          <div className="cr-quiet__actions">
            {canRecordDeletion ? (
              <Button
                tier="tertiary"
                small
                onClick={(event) =>
                  onOpenDialog({ kind: 'deletion', trigger: event.currentTarget })
                }
              >
                Record deletion request
              </Button>
            ) : null}
            <Button tier="tertiary" small onClick={() => onOpenTab('profile', 'profile')}>
              Inspect account details
            </Button>
          </div>
        </section>

        {header.account === 'Access suspended' ? (
          <p className="helper">{CREATOR_SUSPENSION_IS_NOT_A_BAN}</p>
        ) : null}
      </div>
    </>
  );
}

/* ── An un-rebuilt section, honestly labelled (§1.4) ────────────────────────*/

function InterimSection({
  name,
  tab,
  tabLabel,
  section,
  prospectId,
  relationshipScoped,
  selectedRel,
  navigate,
}: {
  name: string;
  tab: AffiliateRecordTabKey;
  tabLabel: string;
  section: SectionDef;
  prospectId: string;
  relationshipScoped: boolean;
  selectedRel: CreatorRelationshipSummary | null;
  navigate: (to: string) => void;
}) {
  const entry = INTERIM[`${tab}/${section.key}`];
  const href = entry?.href(prospectId, selectedRel?.associationId ?? null) ?? null;

  return (
    <section className="cr-interim">
      <p className="kicker">{tabEyebrow(name, tab)}</p>
      <h1 className="cr-interim__title">{section.label}</h1>

      {/* The facts that already exist: the Selected-relationship strip, real
          data on an interim surface rather than only a pointer. */}
      {relationshipScoped && selectedRel ? (
        <dl className="cr-interim__rel">
          <div>
            <dt>Relationship ID</dt>
            <dd className="cr-interim__id">{selectedRel.associationId}</dd>
          </div>
          <div>
            <dt>Designation</dt>
            <dd>{selectedRel.designation}</dd>
          </div>
          <div>
            <dt>Lifecycle state</dt>
            <dd>{selectedRel.status}</dd>
          </div>
          <div>
            <dt>Current owner</dt>
            <dd>{selectedRel.owner}</dd>
          </div>
          <div>
            <dt>Agreement</dt>
            <dd>{selectedRel.agreement}</dd>
          </div>
          <div>
            <dt>Tracking link</dt>
            <dd>{selectedRel.trackingLink}</dd>
          </div>
          <div>
            <dt>Completion state</dt>
            <dd>{selectedRel.completion}</dd>
          </div>
        </dl>
      ) : null}

      {relationshipScoped && !selectedRel ? (
        <p className="grey">
          No campaign relationship yet, so there is nothing campaign-specific to show.
        </p>
      ) : null}

      <p className="cr-interim__note">
        {entry?.note ??
          (href
            ? `This section is rebuilt in Session ${entry?.session ?? 'C'} of the Affiliate workspace. Today its content lives on ${entry?.owner ?? 'its existing surface'}.`
            : `This section is rebuilt in Session ${entry?.session ?? 'C'} of the Affiliate workspace.`)}
      </p>

      {href ? (
        <Button tier="secondary" onClick={() => navigate(href)}>
          Open {entry?.owner ?? 'the current surface'}
        </Button>
      ) : null}
    </section>
  );
}
