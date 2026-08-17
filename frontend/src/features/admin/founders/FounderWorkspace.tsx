/**
 * Admin → Founders → one person — Spec §26.1, §26.2, §27.1, DNA §5.2, §5.12,
 * §5.14; rebuilt 2026-08-16 to the supplied reference.
 *
 * The record is eight sections behind one header: Overview, Onboarding,
 * Campaign, Affiliates, Backers & Demand, Money & Fulfillment, Support &
 * Enforcement, History. The section lives in the URL (`?section=…`, DNA
 * §5.12) so a record state can be linked to.
 *
 * ── Session A's honest interim ──────────────────────────────────────────────
 * This rebuild ships in three sessions (the brief's own split). Session A
 * builds the directory, this shell, and the Overview in their final shape.
 * The other sections do not pretend: each renders the surface that currently
 * owns its content — the invitation-and-vetting pane under Onboarding, the
 * campaigns pane under Campaign, the money pane under Money & Fulfillment,
 * the composed history under History — or, where no pane exists yet, a panel
 * that names the workspace that owns the work TODAY with a real link into it
 * (§1.4: an interim that says what it is beats a mock of what it will be).
 * Sessions B and C replace them tab by tab; the section register in
 * `@proovd/shared` already carries the sub-tab shape they will fill.
 *
 * ── This file composes; it decides nothing ──────────────────────────────────
 * Every word — the header chips, the lifecycle, both action cells, the list
 * of permitted menu actions — arrives resolved from `readFounderWorkspace`.
 * The server re-decides on every request regardless (§1.1: a hidden menu item
 * is not authorization).
 *
 * ── Nothing is ever patched locally ─────────────────────────────────────────
 * Every mutation ends in `refresh()`, which re-reads the whole workspace. A
 * merged payload or an optimistic flip is how a surface comes to claim an
 * outcome the server did not record (§1.4).
 */

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { Link as RouterLink, useNavigate, useParams, useSearchParams } from 'react-router';
import {
  FOUNDER_EDITABLE_FIELD_KEYS,
  FOUNDER_RECORD_SECTIONS,
  MEETING_NOTE_FIELDS,
  NO_ATTENTION_LABEL,
  ONBOARDING_TAB_COPY,
  PROFILE_OVERRIDE_KEYS,
  RESEARCH_ENTRY_FIELDS,
  type AttentionAction,
  type FounderEditableFieldKey,
  type FounderRecordSectionKey,
  type OnboardingTabKey,
  type ProfileOverrideKey,
} from '@proovd/shared';
import { Button, Menu, StatePanel, useToast } from '../../../components/index.js';
import { cn } from '../../../components/cn.js';
import { moveTabUnderline } from '../../../components/anim.js';
import { useProovdMotion } from '../../../motion/MotionProvider.js';
import {
  AdminRequestError,
  addMeetingNote,
  addResearchEntry,
  banFounder,
  cancelInvite,
  clearInvitationOverride,
  fetchFounderWorkspace,
  prefillVettingAnswer,
  recordAccessAction,
  recordDeletionReview,
  sendInvite,
  sendNewInvite,
  setFounderCampaignPath,
  setInvitationOverride,
  setNextCampaignReadiness,
  updateFounderField,
  updateProspect,
  type AdminError,
  type FounderMenuAction,
  type FounderWorkspaceDetail,
} from '../api.js';
import {
  ConfirmDialog,
  confirmSpec,
  EditFounderSheet,
  fieldEditSpec,
  InvitationPreviewDialog,
  FIELD_EDIT_EVIDENCE,
  FIELD_EDIT_REASON,
  FIELD_EDIT_VALUE,
  type ConfirmContext,
  type ConfirmKey,
  type DialogValues,
} from './dialogs/index.js';
import {
  NOT_PROVIDED,
  type AnswerEditRequest,
  type FieldEditRequest,
  type WorkspaceActions,
} from './shared.js';
import {
  OverviewSection,
  type DiscoveryEditRequest,
} from './sections/OverviewSection.js';
import { OnboardingSection } from './sections/OnboardingSection.js';
import { Campaigns } from './panes/Campaigns.js';
import { Money } from './panes/Money.js';
import { History } from './panes/History.js';

/* ── Sections ───────────────────────────────────────────────────────────────*/

const SECTION_KEYS = FOUNDER_RECORD_SECTIONS.map((s) => s.key) as readonly string[];

/**
 * Where each attention action lands: the section, and the anchor inside it.
 *
 * `open-campaign` is deliberately absent — it leaves the record entirely, to
 * the Campaigns workspace, and is handled by navigation rather than a jump.
 */
const ATTENTION_TARGETS: Record<
  Exclude<AttentionAction, 'open-campaign'>,
  { section: FounderRecordSectionKey; anchor: string }
> = {
  'jump-access': { section: 'overview', anchor: 'sec-access' },
  'jump-overview': { section: 'onboarding', anchor: 'sec-matches' },
  'jump-money': { section: 'money', anchor: 'sec-paysetup' },
};

/** The `Account actions` menu, in the reference's own wording. */
const MENU_LABELS: Record<FounderMenuAction, string> = {
  edit: 'Edit Founder information',
  sendinvite: 'Send invite',
  newinvite: 'Send a new invite',
  cancelinvite: 'Cancel current invite',
  suspend: 'Suspend Founder access',
  restore: 'Restore Founder access',
  ban: 'Permanently ban Founder',
  deletion: 'Review account deletion request',
};

const CONFIRMED: Record<ConfirmKey, string> = {
  sendinvite: 'Invitation sent',
  newinvite: 'New invitation sent',
  cancelinvite: 'Invitation canceled',
  suspend: 'Founder access suspended',
  restore: 'Founder access restored',
  ban: 'Permanent ban recorded',
  deletion: 'Review recorded on the deletion request',
  campapprove: 'Approved for another campaign',
  campunapprove: 'Next-campaign approval removed',
};

const CONFIRM_REASON = 'm-reason';
const CONFIRM_EVIDENCE = 'm-evidence';
const CONFIRM_NOTE = 'm-note';
const CONFIRM_BAN_TRIGGER = 'm-trigger';
const CONFIRM_BAN_NOTICE = 'm-notice';
const CONFIRM_BAN_RECOVERY = 'm-recovery';
const CONFIRM_BAN_ENFORCEMENT = 'm-enforcement';
const CONFIRM_CRITERIA = 'm-criteria';
const CONFIRM_EXPLANATION = 'm-explanation';

/* ── Client-side refusals ───────────────────────────────────────────────────*/

function refuse(detail: Omit<AdminError, 'status'>): never {
  throw new AdminRequestError({ ...detail, status: 0 });
}

function isEditableFieldKey(key: string): key is FounderEditableFieldKey {
  return (FOUNDER_EDITABLE_FIELD_KEYS as readonly string[]).includes(key);
}

function isOverrideKey(key: string): key is ProfileOverrideKey {
  return (PROFILE_OVERRIDE_KEYS as readonly string[]).includes(key);
}

/* ── What is open over the workspace ────────────────────────────────────────*/

type OpenDialog =
  | { kind: 'confirm'; key: ConfirmKey; trigger: HTMLElement | null }
  | { kind: 'field'; target: FieldEditRequest; trigger: HTMLElement | null }
  | { kind: 'answer'; target: AnswerEditRequest; trigger: HTMLElement | null }
  | { kind: 'discovery'; target: DiscoveryEditRequest; trigger: HTMLElement | null }
  | { kind: 'meetingnote'; trigger: HTMLElement | null }
  | { kind: 'research'; trigger: HTMLElement | null }
  | { kind: 'editfounder'; trigger: HTMLElement | null }
  | { kind: 'preview'; trigger: HTMLElement | null };

/* ── The surface ────────────────────────────────────────────────────────────*/

export function FounderWorkspace() {
  const { prospectId } = useParams<{ prospectId: string }>();
  const navigate = useNavigate();

  const [detail, setDetail] = useState<FounderWorkspaceDetail | null>(null);
  const [loadError, setLoadError] = useState<AdminRequestError | null>(null);
  const [dialog, setDialog] = useState<OpenDialog | null>(null);
  /** A section anchor to reach once the section holding it has committed. */
  const [jump, setJump] = useState<string | null>(null);

  /** The section lives in the URL, so a record state can be linked to. */
  const [params, setParams] = useSearchParams();
  const rawSection = params.get('section') ?? 'overview';
  const section: FounderRecordSectionKey = SECTION_KEYS.includes(rawSection)
    ? (rawSection as FounderRecordSectionKey)
    : 'overview';
  const setSection = useCallback(
    (next: FounderRecordSectionKey) => {
      const updated = new URLSearchParams(params);
      if (next === 'overview') updated.delete('section');
      else updated.set('section', next);
      // A section change is a navigation, so the sub-tab resets with it — a
      // `tab` left behind would reopen a different section on its own tab.
      updated.delete('tab');
      setParams(updated, { replace: true });
    },
    [params, setParams],
  );

  /** The Onboarding sub-tab, in the URL beside the section (DNA §5.12). */
  const rawTab = params.get('tab') ?? 'invite';
  const onboardingTab: OnboardingTabKey =
    rawTab in ONBOARDING_TAB_COPY ? (rawTab as OnboardingTabKey) : 'invite';
  const setOnboardingTab = useCallback(
    (next: OnboardingTabKey) => {
      const updated = new URLSearchParams(params);
      updated.set('section', 'onboarding');
      if (next === 'invite') updated.delete('tab');
      else updated.set('tab', next);
      setParams(updated, { replace: true });
    },
    [params, setParams],
  );

  const toast = useToast();
  const uid = useId();
  const headerRef = useRef<HTMLDivElement>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  const tablistRef = useRef<HTMLElement>(null);
  const underlineRef = useRef<HTMLSpanElement>(null);
  const tabButtons = useRef<Partial<Record<FounderRecordSectionKey, HTMLButtonElement | null>>>(
    {},
  );
  const underlineSettled = useRef(false);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);

  const load = useCallback(() => {
    if (!prospectId) return;
    setLoadError(null);
    fetchFounderWorkspace(prospectId)
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
                  'This Founder’s record could not be read, and the failure carried no explanation.',
                next: 'Try the read again. Nothing was changed by the attempt.',
              }),
        );
      });
  }, [prospectId]);

  useEffect(load, [load]);

  const refresh = useCallback(async () => {
    if (!prospectId) return;
    setDetail(await fetchFounderWorkspace(prospectId));
  }, [prospectId]);

  /* ── Motion ───────────────────────────────────────────────────────────── */

  useProovdMotion(headerRef, [detail]);
  useProovdMotion(paneRef, [detail, section]);

  const parkUnderline = useCallback((animate: boolean) => {
    const list = tablistRef.current;
    const underline = underlineRef.current;
    if (!list || !underline) return;
    moveTabUnderline(underline, list.querySelector<HTMLElement>('.tabbtn.is-active'), animate);
  }, []);

  useLayoutEffect(() => {
    parkUnderline(underlineSettled.current);
    if (detail) underlineSettled.current = true;
  }, [section, detail, parkUnderline]);

  useEffect(() => {
    const onResize = () => parkUnderline(false);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [parkUnderline]);

  /* ── The attention jump ───────────────────────────────────────────────── */

  useEffect(() => {
    if (!jump) return;
    setJump(null);
    const target = document.getElementById(jump);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    target.focus({ preventScroll: true });
  }, [jump]);

  const runAttentionAction = useCallback(
    (act: AttentionAction) => {
      if (act === 'open-campaign') {
        const campaignId = detail?.header.currentCampaign?.campaignId;
        if (campaignId) void navigate(`/admin/campaigns/${campaignId}`);
        return;
      }
      const destination = ATTENTION_TARGETS[act];
      setSection(destination.section);
      setJump(destination.anchor);
    },
    [detail, navigate, setSection],
  );

  /* ── States ───────────────────────────────────────────────────────────── */

  if (!prospectId) {
    return (
      <StatePanel
        state="No Founder was named in this address"
        whatHappened="This page is opened from the Founders directory, and the address it was given carries no Founder."
        next="Go back to the directory and open somebody from there."
        owner="You"
        nextUpdate="No update is pending"
        action={
          <RouterLink className="btn btn--secondary" to="/admin/founders">
            <span className="btn__label">Go to Founders</span>
          </RouterLink>
        }
        reference="Admin · Founders"
        ring
      />
    );
  }

  if (loadError) {
    const missing = loadError.detail.status === 404;
    return (
      <>
        <BackToFounders />
        <StatePanel
          state={loadError.detail.title}
          whatHappened={
            loadError.detail.whatHappened ??
            (missing
              ? 'There is no Founder record at this address. It may have been opened from a stale link.'
              : 'This Founder’s record could not be read, so nothing on this page is current.')
          }
          next={
            loadError.detail.next ??
            (missing
              ? 'Go back to the Founders directory and open the record from there.'
              : 'Try the read again. Nothing was changed by the attempt.')
          }
          owner="Proovd"
          nextUpdate={missing ? 'No update is pending' : 'When you try again'}
          action={
            missing ? (
              <RouterLink className="btn btn--secondary" to="/admin/founders">
                <span className="btn__label">Go to Founders</span>
              </RouterLink>
            ) : (
              <Button tier="secondary" onClick={load}>
                Try the read again
              </Button>
            )
          }
          reference="Admin · Founders"
          ring
        />
      </>
    );
  }

  if (!detail) {
    return (
      <>
        <BackToFounders />
        <StatePanel
          state="Reading this Founder’s record"
          whatHappened="Proovd is reading the invitation, the identity record, the campaigns, the money, and the history."
          next="The record appears as soon as that comes back."
          owner="Proovd"
          nextUpdate="Within a few seconds"
          action="No action needed"
          reference="Admin · Founders"
        />
      </>
    );
  }

  /* ── Everything below has a record ────────────────────────────────────── */

  const { header, details } = detail;

  const productName =
    [...details.personal, ...details.business, ...details.preferences].find(
      (field) => field.key === 'product',
    )?.value ??
    header.businessName ??
    NOT_PROVIDED;

  const confirmContext: ConfirmContext = {
    legalName: header.legalName,
    preferredName: header.preferredName,
    email: header.email,
    productName,
    deletionDetail: details.deletionRequest?.detail ?? null,
  };

  const kicker = `${header.legalName} · ${productName}`;
  const vettingDraftId = detail.overview.vetting.draftId;

  /* ── What a pane may start ────────────────────────────────────────────── */

  const actions: WorkspaceActions = {
    confirm: (key, trigger) => setDialog({ kind: 'confirm', key, trigger }),
    editField: (target, trigger) => setDialog({ kind: 'field', target, trigger }),
    editAnswer: (target, trigger) => setDialog({ kind: 'answer', target, trigger }),
    previewInvitation: (trigger) => setDialog({ kind: 'preview', trigger }),
    setOverride: async (key, value) => {
      if (!isOverrideKey(key)) {
        refuse({
          error: 'unknown_override',
          title: 'That value is not one an invitation can override',
          whatHappened: `“${key}” is not one of the five invitation override fields, so nothing was sent and nothing changed.`,
          next: 'Reload this page. If the field is still offered, it is a defect worth reporting.',
        });
      }
      await setInvitationOverride(prospectId, key, value);
      await refresh();
    },
    clearOverride: async (key) => {
      if (!isOverrideKey(key)) {
        refuse({
          error: 'unknown_override',
          title: 'That value is not one an invitation can override',
          whatHappened: `“${key}” is not one of the five invitation override fields, so nothing was sent and nothing changed.`,
          next: 'Reload this page. If the field is still offered, it is a defect worth reporting.',
        });
      }
      await clearInvitationOverride(prospectId, key);
      await refresh();
    },
    setCampaignPath: async (draftId, path) => {
      await setFounderCampaignPath(draftId, path);
      await refresh();
      toast('Campaign type saved', {
        sub: 'It locks when the Founder submits their answers.',
      });
    },
  };

  /* ── The decisions ────────────────────────────────────────────────────── */

  const runConfirm = async (key: ConfirmKey, values: DialogValues): Promise<void> => {
    const reason = values[CONFIRM_REASON] ?? '';
    const evidence = values[CONFIRM_EVIDENCE] ?? '';

    switch (key) {
      case 'sendinvite':
        await sendInvite(prospectId);
        break;
      case 'newinvite':
        await sendNewInvite(prospectId);
        break;
      case 'cancelinvite':
        await cancelInvite(prospectId, reason);
        break;
      case 'suspend':
        await recordAccessAction(prospectId, {
          action: 'suspend',
          reason,
          ...(evidence ? { evidence } : {}),
        });
        break;
      case 'restore':
        await recordAccessAction(prospectId, { action: 'restore', reason });
        break;
      case 'ban':
        await banFounder(prospectId, {
          trigger: values[CONFIRM_BAN_TRIGGER] ?? '',
          notice: values[CONFIRM_BAN_NOTICE] ?? '',
          reason,
          evidence,
          paymentRecoveryStatus: values[CONFIRM_BAN_RECOVERY] ?? '',
          enforcementDecision: values[CONFIRM_BAN_ENFORCEMENT] ?? '',
        });
        break;
      case 'deletion': {
        const requestId = details.deletionRequest?.id;
        if (!requestId) {
          refuse({
            error: 'no_deletion_request',
            title: 'There is no deletion request to review',
            whatHappened:
              'This Founder has no recorded request to close their account, so there is nothing for a review to attach to. Nothing was recorded.',
            next: 'Reload this page to see the current record.',
          });
        }
        await recordDeletionReview(prospectId, requestId, values[CONFIRM_NOTE] ?? '');
        break;
      }
      case 'campapprove':
        await setNextCampaignReadiness(prospectId, {
          approved: true,
          criteriaNote: values[CONFIRM_CRITERIA] ?? '',
          customerExplanation: values[CONFIRM_EXPLANATION] ?? '',
        });
        break;
      case 'campunapprove':
        await setNextCampaignReadiness(prospectId, {
          approved: false,
          criteriaNote: reason,
          customerExplanation: values[CONFIRM_EXPLANATION] ?? '',
        });
        break;
    }

    await refresh();
    toast(CONFIRMED[key]);
  };

  const runFieldEdit = async (target: FieldEditRequest, values: DialogValues): Promise<void> => {
    if (!isEditableFieldKey(target.key)) {
      refuse({
        error: 'unknown_field',
        title: 'That field cannot be changed here',
        whatHappened: `“${target.label}” is not one of the fields Admin may edit on a Founder record, so nothing was sent and nothing changed.`,
        next: 'Reload this page. If the control is still offered, it is a defect worth reporting.',
      });
    }

    const reason = values[FIELD_EDIT_REASON] ?? '';
    const evidence = values[FIELD_EDIT_EVIDENCE] ?? '';

    await updateFounderField(prospectId, target.key, {
      value: values[FIELD_EDIT_VALUE] ?? '',
      ...(reason ? { reason } : {}),
      ...(evidence ? { evidence } : {}),
    });
    await refresh();
    toast('Saved', { sub: `${target.label} updated.` });
  };

  const runAnswerEdit = async (target: AnswerEditRequest, values: DialogValues) => {
    await prefillVettingAnswer(target.draftId, target.key, values[FIELD_EDIT_VALUE] ?? '');
    await refresh();
    toast('Saved', { sub: `${target.label} updated.` });
  };

  /** §7's discovery fields, written through the intake's own path. */
  const runDiscoveryEdit = async (target: DiscoveryEditRequest, values: DialogValues) => {
    if (!vettingDraftId) {
      refuse({
        error: 'no_draft',
        title: 'This record has no draft to write against',
        whatHappened:
          'The discovery record lives on the invitation draft, and this Founder has none. Nothing was sent and nothing changed.',
        next: 'Reload this page to see the current record.',
      });
    }
    await updateProspect(vettingDraftId, { [target.key]: values[FIELD_EDIT_VALUE] ?? '' });
    await refresh();
    toast('Saved', { sub: `${target.label} updated.` });
  };

  const runMeetingNote = async (values: DialogValues) => {
    await addMeetingNote(prospectId, {
      meetingDate: values['meetingDate'] ?? '',
      participants: values['participants'] ?? '',
      decisions: values['decisions'] ?? '',
      followUp: values['followUp'] ?? '',
      sourceLink: values['sourceLink'] ?? '',
      ...(values['notes'] ? { notes: values['notes'] } : {}),
    });
    await refresh();
    toast('Meeting note recorded');
  };

  const runResearch = async (values: DialogValues) => {
    await addResearchEntry(prospectId, {
      title: values['title'] ?? '',
      sourceLink: values['sourceLink'] ?? '',
      ...(values['findings'] ? { findings: values['findings'] } : {}),
    });
    await refresh();
    toast('Research recorded');
  };

  /* ── The menu ─────────────────────────────────────────────────────────── */

  const menuItems = header.availableActions.map((action) => ({
    label: MENU_LABELS[action],
    onSelect: () => {
      if (action === 'edit') {
        // The Edit Founder sheet — the record's one bulk-edit surface
        // (Session B). The per-row dialogs remain for single-field edits.
        setDialog({ kind: 'editfounder', trigger: menuTriggerRef.current });
        return;
      }
      setDialog({ kind: 'confirm', key: action, trigger: menuTriggerRef.current });
    },
  }));

  /* ── The section nav ──────────────────────────────────────────────────── */

  const tabDomId = (key: FounderRecordSectionKey) => `${uid}-tab-${key}`;
  const paneDomId = (key: FounderRecordSectionKey) => `${uid}-pane-${key}`;

  function onTabKeys(event: KeyboardEvent<HTMLElement>) {
    const current = FOUNDER_RECORD_SECTIONS.findIndex((s) => s.key === section);
    let index = -1;
    if (event.key === 'ArrowRight') index = (current + 1) % FOUNDER_RECORD_SECTIONS.length;
    else if (event.key === 'ArrowLeft')
      index = (current - 1 + FOUNDER_RECORD_SECTIONS.length) % FOUNDER_RECORD_SECTIONS.length;
    else if (event.key === 'Home') index = 0;
    else if (event.key === 'End') index = FOUNDER_RECORD_SECTIONS.length - 1;
    if (index < 0) return;

    const next = FOUNDER_RECORD_SECTIONS[index];
    if (!next) return;
    event.preventDefault();
    setSection(next.key);
    tabButtons.current[next.key]?.focus();
  }

  const attention = header.attention;
  const publicUrl = detail.campaignFacts?.publicUrl ?? null;
  const currentCampaignId = header.currentCampaign?.campaignId ?? null;

  return (
    <div>
      <BackToFounders />

      <div ref={headerRef}>
        <header className="fhead frec-head">
          <div className="fhead__id" data-scroll="rise">
            <span className="fdir-avatar fdir-avatar--lg" aria-hidden="true">
              {initialsOf(header.legalName || header.preferredName)}
            </span>
            <div>
              <p className="kicker">Founder record · {header.recordReference}</p>
              <h1 className="h2" data-reveal="headline">
                {header.legalName || header.preferredName}
              </h1>
              <p className="fhead__line grey">
                {[
                  header.businessName ?? productName,
                  header.email,
                  header.phone ? `${header.phone} · Phone not verified` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              <p className="frec-chips">
                <span className="frec-chip frec-chip--type">{header.typeChip}</span>
                <span className="frec-chip frec-chip--life">{header.lifecycle}</span>
              </p>
            </div>
          </div>

          <div className="frec-actions" data-scroll="rise">
            {publicUrl ? (
              <a className="btn btn--secondary btn--sm" href={publicUrl} target="_blank" rel="noreferrer">
                <span className="btn__label">View live campaign</span>
              </a>
            ) : null}
            {currentCampaignId ? (
              <RouterLink
                className="btn btn--tertiary btn--sm"
                to={`/admin/campaigns/${currentCampaignId}`}
              >
                <span className="btn__label">Open campaign record</span>
              </RouterLink>
            ) : null}
            <RouterLink className="btn btn--tertiary btn--sm" to="/admin/support">
              <span className="btn__label">View support cases</span>
            </RouterLink>
            <Menu
              label="Account actions"
              trigger={
                <button
                  ref={menuTriggerRef}
                  type="button"
                  className="btn btn--tertiary btn--sm"
                >
                  <span className="btn__label">Account actions</span>
                </button>
              }
              items={menuItems}
            />
          </div>

          {/* The reference's Problem / Solution / Business strip. Read-only
              one-liners; the full answers with their provenance and controls
              live on the Overview below. */}
          <dl className="frec-strip" data-scroll="rise">
            <div>
              <dt>Problem</dt>
              <dd>{answerLine(detail, 'problem')}</dd>
            </div>
            <div>
              <dt>Solution</dt>
              <dd>{answerLine(detail, 'solution')}</dd>
            </div>
            <div>
              <dt>Business</dt>
              <dd>{header.businessName ?? productName}</dd>
            </div>
          </dl>

          <p className="frec-where" data-scroll="rise">
            <span className="kicker">Where this Founder is now</span>
            <b>{header.lifecycle}</b>
            {!attention.needed ? <span className="grey"> · {NO_ATTENTION_LABEL}</span> : null}
          </p>
        </header>
      </div>

      <nav
        className="tabs frec-tabs"
        ref={tablistRef}
        role="tablist"
        aria-label="Founder record sections"
        onKeyDown={onTabKeys}
      >
        {FOUNDER_RECORD_SECTIONS.map((s) => (
          <button
            key={s.key}
            ref={(node) => {
              tabButtons.current[s.key] = node;
            }}
            type="button"
            id={tabDomId(s.key)}
            className={cn('tabbtn', section === s.key && 'is-active')}
            role="tab"
            aria-selected={section === s.key}
            {...(section === s.key ? { 'aria-controls': paneDomId(s.key) } : {})}
            tabIndex={section === s.key ? 0 : -1}
            onClick={() => setSection(s.key)}
          >
            {s.label}
          </button>
        ))}
        <span ref={underlineRef} className="tabline" aria-hidden="true" />
      </nav>

      <div
        ref={paneRef}
        className="tabpane is-active"
        id={paneDomId(section)}
        role="tabpanel"
        aria-labelledby={tabDomId(section)}
        tabIndex={0}
      >
        {section === 'overview' ? (
          <OverviewSection
            detail={detail}
            actions={actions}
            onAttentionAction={(act) => runAttentionAction(act)}
            onOpenHistory={() => setSection('history')}
            onAddMeetingNote={(trigger) => setDialog({ kind: 'meetingnote', trigger })}
            onAddResearch={(trigger) => setDialog({ kind: 'research', trigger })}
            onEditDiscovery={(target, trigger) =>
              setDialog({ kind: 'discovery', target, trigger })
            }
          />
        ) : null}
        {section === 'onboarding' ? (
          <OnboardingSection
            detail={detail}
            tab={onboardingTab}
            onTab={setOnboardingTab}
            actions={actions}
            onOpenHistory={() => setSection('history')}
            onEditFounder={(trigger) => setDialog({ kind: 'editfounder', trigger })}
          />
        ) : null}
        {section === 'campaign' ? (
          <>
            <InterimNote owns="campaign details, review, the live campaign, and the page with its updates">
              The campaign record below is complete and live; campaign operations belong to the
              Campaigns workspace.
              {currentCampaignId ? (
                <>
                  {' '}
                  <RouterLink to={`/admin/campaigns/${currentCampaignId}`}>
                    Open this campaign in the Campaigns workspace
                  </RouterLink>
                  .
                </>
              ) : null}
            </InterimNote>
            <Campaigns detail={detail} actions={actions} />
          </>
        ) : null}
        {section === 'affiliates' ? (
          <StatePanel
            state="Creator relationships live in the Creators workspace"
            whatHappened="Every Creator relationship on this Founder’s campaign — terms, versions, readiness, performance, and enforcement — is operated from the Creators workspace, which owns the relationship end to end."
            next="Open the Creators directory pre-searched with this campaign to see everyone on it. This section gains its three tabs (Relationships · Requests · Performance & Completion) in a later build session."
            owner="Proovd"
            nextUpdate="When the next build session lands"
            action={
              <RouterLink
                className="btn btn--secondary"
                to={
                  header.currentCampaign
                    ? `/admin/creators?q=${encodeURIComponent(header.currentCampaign.name)}`
                    : '/admin/creators'
                }
              >
                <span className="btn__label">Open Creators</span>
              </RouterLink>
            }
            reference={`Admin · Founders · ${header.recordReference}`}
          />
        ) : null}
        {section === 'backers' ? (
          <StatePanel
            state="Backer records live in the Backers workspace"
            whatHappened="Every pre-order on this Founder’s campaign — demand, responses, and individual Backer context — is read from the Backers workspace and the pre-order ledger."
            next="Open the Backers workspace filtered to this campaign. This section gains its three tabs (Demand · Responses · Backers) in a later build session."
            owner="Proovd"
            nextUpdate="When the next build session lands"
            action={
              <RouterLink
                className="btn btn--secondary"
                to={
                  currentCampaignId
                    ? `/admin/backers?view=backers&campaignId=${encodeURIComponent(currentCampaignId)}`
                    : '/admin/backers'
                }
              >
                <span className="btn__label">Open Backers</span>
              </RouterLink>
            }
            reference={`Admin · Founders · ${header.recordReference}`}
          />
        ) : null}
        {section === 'money' ? (
          <>
            <InterimNote owns="close, payments, fulfillment, and refunds with recovery">
              The money record below is complete and live; the four-tab shape (Close · Payments ·
              Fulfillment · Refunds &amp; Recovery) arrives in a later build session. Money
              decisions stay with the close-operations queue — this record shows state and
              routes there.
            </InterimNote>
            <Money detail={detail} />
          </>
        ) : null}
        {section === 'support' ? (
          <StatePanel
            state="Support cases live in the Support workspace"
            whatHappened="Every case on this Founder — its owner, its §27.8 response promise, and its thread — is operated from the Support workspace. Account-level standing (suspension, the ban record, any deletion request) is on this record’s Overview under the full-record block."
            next="Open the Support workspace to see the queue. This section gains its three tabs (Support · Cancellation · Enforcement) in a later build session."
            owner="Proovd"
            nextUpdate="When the next build session lands"
            action={
              <RouterLink className="btn btn--secondary" to="/admin/support">
                <span className="btn__label">Open Support</span>
              </RouterLink>
            }
            reference={`Admin · Founders · ${header.recordReference}`}
          />
        ) : null}
        {section === 'history' ? <History detail={detail} /> : null}
      </div>

      {dialog?.kind === 'confirm' ? (
        <ConfirmDialog
          spec={confirmSpec(dialog.key, confirmContext)}
          trigger={dialog.trigger}
          onSubmit={(values) => runConfirm(dialog.key, values)}
          onClose={() => setDialog(null)}
        />
      ) : null}

      {dialog?.kind === 'field' ? (
        <ConfirmDialog
          spec={fieldEditSpec(dialog.target, {
            kicker,
            preferredName: header.preferredName,
            accountClaimed: detail.overview.accountCreatedAt !== null,
            invitationSent: detail.overview.invitation.state !== 'Not sent',
          })}
          trigger={dialog.trigger}
          onSubmit={(values) => runFieldEdit(dialog.target, values)}
          onClose={() => setDialog(null)}
        />
      ) : null}

      {dialog?.kind === 'answer' ? (
        <ConfirmDialog
          spec={{
            kicker,
            title: `Edit — ${dialog.target.label}`,
            body: (
              <p>
                Prepared by Proovd from discovery (§9). It stops moving the moment{' '}
                {header.preferredName} edits the answer themselves, and it locks when they
                submit.
              </p>
            ),
            fields: [
              {
                id: FIELD_EDIT_VALUE,
                label: 'New value',
                required: true,
                textarea: true,
                value: dialog.target.text ?? '',
              },
            ],
            primary: 'Save change',
          }}
          trigger={dialog.trigger}
          onSubmit={(values) => runAnswerEdit(dialog.target, values)}
          onClose={() => setDialog(null)}
        />
      ) : null}

      {dialog?.kind === 'discovery' ? (
        <ConfirmDialog
          spec={{
            kicker,
            title: `Edit — ${dialog.target.label}`,
            body: (
              <p>
                §7’s discovery record — internal to Proovd, never rendered to the Founder, and
                written through the same path the intake form uses.
              </p>
            ),
            fields: [
              {
                id: FIELD_EDIT_VALUE,
                label: dialog.target.label,
                textarea: true,
                value: dialog.target.value ?? '',
                ...(dialog.target.helper ? { hint: dialog.target.helper } : {}),
              },
            ],
            primary: 'Save change',
          }}
          trigger={dialog.trigger}
          onSubmit={(values) => runDiscoveryEdit(dialog.target, values)}
          onClose={() => setDialog(null)}
        />
      ) : null}

      {dialog?.kind === 'meetingnote' ? (
        <ConfirmDialog
          spec={{
            kicker,
            title: 'Add meeting note',
            body: (
              <p>
                Keep the decision, participants, follow-up, and source attached to this Founder.
                A note is a record: a correction later is a new note, never an edit.
              </p>
            ),
            fields: MEETING_NOTE_FIELDS.map((field) => ({
              id: field.key,
              label: field.label,
              required: field.required,
              ...(field.key === 'meetingDate'
                ? { inputType: 'date' as const }
                : field.key === 'notes' || field.key === 'decisions'
                  ? { textarea: true }
                  : {}),
            })),
            primary: 'Record meeting note',
          }}
          trigger={dialog.trigger}
          onSubmit={runMeetingNote}
          onClose={() => setDialog(null)}
        />
      ) : null}

      {dialog?.kind === 'research' ? (
        <ConfirmDialog
          spec={{
            kicker,
            title: 'Add research',
            body: (
              <p>
                One finding, appended to §7’s discovery-evidence list — the same record the
                intake form writes.
              </p>
            ),
            fields: RESEARCH_ENTRY_FIELDS.map((field) => ({
              id: field.key,
              label: field.label,
              required: field.required,
              ...(field.key === 'findings' ? { textarea: true } : {}),
            })),
            primary: 'Record research',
          }}
          trigger={dialog.trigger}
          onSubmit={runResearch}
          onClose={() => setDialog(null)}
        />
      ) : null}

      {dialog?.kind === 'editfounder' ? (
        <EditFounderSheet
          detail={detail}
          trigger={dialog.trigger}
          onSaved={refresh}
          onClose={() => setDialog(null)}
        />
      ) : null}

      {dialog?.kind === 'preview' ? (
        <InvitationPreviewDialog
          prospectId={prospectId}
          kicker={kicker}
          preferredName={header.preferredName}
          trigger={dialog.trigger}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </div>
  );
}

/* ── Pieces ─────────────────────────────────────────────────────────────────*/

function BackToFounders() {
  return (
    <div className="crumb">
      <RouterLink className="btn btn--tertiary" to="/admin/founders">
        <span className="btn__label">← All Founders</span>
      </RouterLink>
    </div>
  );
}

/** Initials for the header avatar. Presentation of a name the server sent. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : (parts[0]?.[1] ?? '');
  return `${first}${last}`.toUpperCase() || '·';
}

/** The first line of a §9 answer for the header strip, or its honest absence. */
function answerLine(detail: FounderWorkspaceDetail, key: 'problem' | 'solution'): string {
  const answer = detail.overview.vetting.answers.find((a) => a.key === key);
  return answer?.text ?? 'Not answered yet';
}

/**
 * The Session A interim banner: what this section will hold, and what the
 * content below it is TODAY. §1.4 — an interim that says what it is.
 */
function InterimNote({ owns, children }: { owns: string; children: React.ReactNode }) {
  return (
    <p className="frec-interim helper">
      <b>This section will hold {owns}.</b> {children}
    </p>
  );
}
