/**
 * Admin → Founders → one person — Spec §26.1, §26.2, §27.1, DNA §5.2, §5.14.
 *
 * The whole of what Proovd knows about one Founder: a header that answers
 * "who is this and does anything need doing", and five panes behind it.
 *
 * ── This file composes; it decides nothing ──────────────────────────────────
 * Every word on the header, every status, every label, and — crucially — the
 * list of actions that are even offered arrives resolved from
 * `readFounderWorkspace`. `header.availableActions` is the server's answer to
 * "what is possible against this record", and the menu is built by walking it.
 * A client that decided for itself which actions to show would be a second
 * answer to that question, and the two would disagree the first time a record
 * moved between the read and the press. The server re-decides on the request
 * regardless (§1.1: a hidden menu item is not authorization).
 *
 * The one thing this file derives is a *lookup*: the product name for a dialog
 * kicker is read out of the Details pane's own field list, because the header
 * payload does not carry it. That is finding a value the server already sent,
 * not computing one.
 *
 * ── Nothing is ever patched locally ─────────────────────────────────────────
 * Every mutation ends in `refresh()`, which re-reads the whole workspace. The
 * cheaper move — merging the payload a mutation returned, or optimistically
 * flipping a status — is how a surface comes to show an outcome the server did
 * not record: a suspend that also closed a case, a field edit that also moved
 * `availableActions`, a send that also advanced the invitation state. Re-reading
 * costs one request and can never claim something that did not happen (§1.4).
 *
 * ── The tabs are hand-built, and that is not a rejection of the primitive ───
 * `components/Tabs.tsx` renders `.tabs > .tablist > .tab` with `.tab-underline`.
 * §26.1's stylesheet section defines `.tabs > .tabbtn` with `.tabline` and
 * `.tabpane`, which is different markup for a wider, denser surface. Rather
 * than widen a shared component for one caller or ship a second look, the ARIA
 * that primitive was carrying — tablist/tab/tabpanel, roving tabindex, arrow
 * keys, Home/End — is reproduced here explicitly, and the underline is moved by
 * the same `moveTabUnderline` tween the primitive uses. There is one motion,
 * two mounts, exactly as the confirm dialog stands beside `Modal`.
 *
 * Only the active pane is rendered. `.tabpane` is `display: none` when it is not
 * active, and a hidden pane is still in the accessibility tree, still runs its
 * effects, and still binds motion to nodes nobody can see. Unmounting is also
 * why `aria-controls` is set on the selected tab alone — pointing it at an id
 * that is not in the document is an ARIA reference to nothing.
 *
 * ── Two contract gaps, stated rather than papered over ──────────────────────
 * `confirmSpec('ban')` collects a reason and evidence; `banFounder` needs
 * §22.7's trigger and the customer notice as well. `confirmSpec('campapprove')`
 * collects nothing; `setNextCampaignReadiness` needs a reason. Neither is
 * invented here: a ban notice or an approval justification written by this file
 * would be words an Admin never typed sitting in an append-only record they may
 * later be asked to stand behind (§25.6, and `confirms.tsx`'s own reasoning for
 * why the deletion review has a required note instead of a fixed sentence). The
 * values are read from the dialog under the ids those fields would carry, so
 * the moment the registry gains them this file already forwards them; until
 * then the server refuses and names what is missing, which is what the Admin
 * reads.
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
import { Link as RouterLink, useParams } from 'react-router';
import {
  ATTENTION_CHIP_LABEL,
  FOUNDER_EDITABLE_FIELD_KEYS,
  NO_ACTIVE_CAMPAIGN_LABEL,
  NO_ATTENTION_LABEL,
  PROFILE_OVERRIDE_KEYS,
  type AttentionAction,
  type FounderEditableFieldKey,
  type ProfileOverrideKey,
} from '@proovd/shared';
import { Button, Menu, StatePanel, Sticker, useToast } from '../../../components/index.js';
import { cn } from '../../../components/cn.js';
import { moveTabUnderline } from '../../../components/anim.js';
import { useProovdMotion } from '../../../motion/MotionProvider.js';
import {
  AdminRequestError,
  banFounder,
  cancelInvite,
  clearInvitationOverride,
  fetchFounderWorkspace,
  recordAccessAction,
  recordDeletionReview,
  sendInvite,
  sendNewInvite,
  setInvitationOverride,
  setNextCampaignReadiness,
  updateFounderField,
  type AdminError,
  type FounderMenuAction,
  type FounderWorkspaceDetail,
} from '../api.js';
import {
  ConfirmDialog,
  confirmSpec,
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
  AttentionBox,
  NOT_PROVIDED,
  ParkedButton,
  useParkedToast,
  type FieldEditRequest,
  type WorkspaceActions,
} from './shared.js';
import { useParkedControl } from './parked.js';
import { Overview } from './panes/Overview.js';
import { Details } from './panes/Details.js';
import { Campaigns } from './panes/Campaigns.js';
import { Money } from './panes/Money.js';
import { History } from './panes/History.js';

/* ── The five panes ─────────────────────────────────────────────────────────*/

const PANES = [
  { key: 'overview', label: 'Overview' },
  { key: 'details', label: 'Details' },
  { key: 'campaigns', label: 'Campaigns' },
  { key: 'money', label: 'Money' },
  { key: 'history', label: 'History' },
] as const;

type PaneKey = (typeof PANES)[number]['key'];

/**
 * Where each attention action lands: the pane, and the section inside it.
 *
 * A register rather than a switch, so the set of destinations is exactly
 * `ATTENTION_ACTIONS` and a sixth cannot be introduced by adding a branch. The
 * ids are the ones the panes anchor with `SecTitle id=…`, which carry
 * `tabIndex={-1}` for precisely this — scrolling moves the viewport and leaves
 * focus behind, which lands a keyboard user on a section they cannot read from.
 */
const ATTENTION_TARGETS: Record<
  Exclude<AttentionAction, 'parked-campaign'>,
  { pane: PaneKey; anchor: string }
> = {
  'jump-access': { pane: 'details', anchor: 'sec-access' },
  'jump-overview': { pane: 'overview', anchor: 'sec-matches' },
  'jump-money': { pane: 'money', anchor: 'sec-paysetup' },
};

/** The `•••` menu, in the reference's own wording. */
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

/**
 * The one-line confirmation each decision earns once the server has recorded it.
 *
 * §27.1 asks for an immediate on-screen confirmation; the durable half is the
 * History pane and the notification the service sent. Every sentence here
 * states what the server answered and nothing more — none of them predicts a
 * consequence the response did not carry.
 */
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

/*
 * The two ids `confirms.tsx` uses today, and the two it does not yet have.
 *
 * See the file header: these are read rather than invented so that adding the
 * controls to the registry is the only change needed, and so that nothing in
 * this file is capable of writing a ban notice on somebody's behalf.
 */
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

/**
 * A refusal raised before a request is made.
 *
 * `AdminRequestError` is the shape the confirm dialog already renders, and the
 * failure it describes is genuinely a failure of the admin request — it just
 * did not get as far as the network. Answering §27.1's questions here matters
 * more than the class name: an Admin meeting this needs to know that nothing
 * changed and what to do instead.
 */
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
  | { kind: 'preview'; trigger: HTMLElement | null };

/* ── The surface ────────────────────────────────────────────────────────────*/

export function FounderWorkspace() {
  const { prospectId } = useParams<{ prospectId: string }>();

  const [detail, setDetail] = useState<FounderWorkspaceDetail | null>(null);
  const [loadError, setLoadError] = useState<AdminRequestError | null>(null);
  const [tab, setTab] = useState<PaneKey>('overview');
  const [dialog, setDialog] = useState<OpenDialog | null>(null);
  /** A section to reach once the pane holding it has committed. */
  const [jump, setJump] = useState<string | null>(null);

  const toast = useToast();
  const parkedToast = useParkedToast();
  const parkedControl = useParkedControl();

  const uid = useId();
  const headerRef = useRef<HTMLDivElement>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  const tablistRef = useRef<HTMLElement>(null);
  const underlineRef = useRef<HTMLSpanElement>(null);
  const tabButtons = useRef<Partial<Record<PaneKey, HTMLButtonElement | null>>>({});
  const underlineSettled = useRef(false);
  /**
   * The `•••` button, so a decision opened from the menu grows from it.
   *
   * Radix closes the menu before the dialog mounts, so the pressed *item* is
   * gone by then; the trigger is still on screen and is what the Admin's eye is
   * on, which is what DNA §6.5 is actually asking for.
   */
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

  /**
   * Re-read after every mutation.
   *
   * It throws on failure rather than swallowing: a decision that was recorded
   * and then could not be re-read leaves the surface showing the state from
   * before it, and telling the Admin that is more useful than a stale page that
   * looks current.
   */
  const refresh = useCallback(async () => {
    if (!prospectId) return;
    setDetail(await fetchFounderWorkspace(prospectId));
  }, [prospectId]);

  /* ── Motion ───────────────────────────────────────────────────────────── */

  // Two scopes on purpose. `data-reveal` has no idempotence guard in the
  // runtime, so a single root re-bound on every tab press would replay the
  // header's name reveal each time somebody looked at Money. The header re-binds
  // when the record changes; the pane re-binds when the pane changes, which is
  // what gives its buttons their hover and press.
  useProovdMotion(headerRef, [detail]);
  useProovdMotion(paneRef, [detail, tab]);

  const parkUnderline = useCallback((animate: boolean) => {
    const list = tablistRef.current;
    const underline = underlineRef.current;
    if (!list || !underline) return;
    moveTabUnderline(underline, list.querySelector<HTMLElement>('.tabbtn.is-active'), animate);
  }, []);

  useLayoutEffect(() => {
    parkUnderline(underlineSettled.current);
    if (detail) underlineSettled.current = true;
  }, [tab, detail, parkUnderline]);

  useEffect(() => {
    const onResize = () => parkUnderline(false);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [parkUnderline]);

  /* ── The attention jump ───────────────────────────────────────────────── */

  // Runs after the pane the anchor lives in has committed: setting the tab and
  // the anchor in one event batches, so by the time this effect fires the
  // section exists. Focus as well as scroll, and `preventScroll` so the two do
  // not fight each other.
  useEffect(() => {
    if (!jump) return;
    setJump(null);
    const target = document.getElementById(jump);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    target.focus({ preventScroll: true });
  }, [jump]);

  /* ── States ───────────────────────────────────────────────────────────── */

  if (!prospectId) {
    return (
      <StatePanel
        state="No Founder was named in this address"
        whatHappened="This page is opened from the Founders list, and the address it was given carries no Founder."
        next="Go back to the Founders list and open somebody from there."
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
              ? 'Go back to the Founders list and open the record from there.'
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
          next="The workspace appears as soon as that comes back."
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

  /* ── What a pane may start ────────────────────────────────────────────── */

  const actions: WorkspaceActions = {
    confirm: (key, trigger) => setDialog({ kind: 'confirm', key, trigger }),
    editField: (target, trigger) => setDialog({ kind: 'field', target, trigger }),
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
  };

  /* ── The decisions ────────────────────────────────────────────────────── */

  // Arrow consts rather than function declarations: a declaration is hoisted,
  // so TypeScript cannot carry the `!prospectId` guard above into it and every
  // call would need a cast that asserts what the guard already proved.
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
        await recordDeletionReview(
          prospectId,
          requestId,
          values[CONFIRM_NOTE] ?? '',
        );
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
        // The removal's internal reason IS the criteria note — it is the
        // judgement that was applied — and the Founder is told separately.
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

  const runFieldEdit = async (
    target: FieldEditRequest,
    values: DialogValues,
  ): Promise<void> => {
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
      // Absent keys write nothing; an empty reason is not the same as no reason
      // being offered, and the server decides which fields require one.
      ...(reason ? { reason } : {}),
      ...(evidence ? { evidence } : {}),
    });
    await refresh();
    toast('Saved', { sub: `${target.label} updated.` });
  };

  /* ── The menu ─────────────────────────────────────────────────────────── */

  const menuItems = header.availableActions.map((action) => ({
    label: MENU_LABELS[action],
    onSelect: () => {
      // `edit` is not a decision — it is a destination. §26.1's editable fields
      // live on Details, so the menu takes the Admin there rather than opening
      // a dialog that would have to ask which field they meant.
      //
      // Focus is deliberately not moved: Radix restores it to the `•••` trigger
      // as the menu closes, which happens after this runs, so a `.focus()` here
      // would be a call that always loses. The trigger sits directly above the
      // tablist, so a keyboard user is one Tab from the pane that just opened.
      if (action === 'edit') {
        setTab('details');
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      setDialog({ kind: 'confirm', key: action, trigger: menuTriggerRef.current });
    },
  }));

  /* ── Tabs ─────────────────────────────────────────────────────────────── */

  const tabDomId = (key: PaneKey) => `${uid}-tab-${key}`;
  const paneDomId = (key: PaneKey) => `${uid}-pane-${key}`;

  function onTabKeys(event: KeyboardEvent<HTMLElement>) {
    const current = PANES.findIndex((pane) => pane.key === tab);
    let index = -1;
    if (event.key === 'ArrowRight') index = (current + 1) % PANES.length;
    else if (event.key === 'ArrowLeft') index = (current - 1 + PANES.length) % PANES.length;
    else if (event.key === 'Home') index = 0;
    else if (event.key === 'End') index = PANES.length - 1;
    if (index < 0) return;

    const next = PANES[index];
    if (!next) return;
    event.preventDefault();
    setTab(next.key);
    tabButtons.current[next.key]?.focus();
  }

  const attention = header.attention;
  const attentionAction = attention.needed ? attention.action : null;

  return (
    <div>
      <BackToFounders />

      <div ref={headerRef}>
        <header className="fhead">
          <div className="fhead__id" data-scroll="rise">
            <Sticker n={header.sticker} />
            <div>
              <h1 className="h2" data-reveal="headline">
                {header.legalName}
              </h1>
              <p className="fhead__line">
                {header.businessName ? (
                  <b>{header.businessName}</b>
                ) : (
                  <span className="grey">No legal business name recorded</span>
                )}
                {header.website ? ` · ${header.website}` : ''}
              </p>
              <p className="fhead__line grey">
                {header.phone
                  ? `${header.email} · ${header.phone} · Phone not verified`
                  : `${header.email} · No phone recorded`}
              </p>
              <p className="fhead__line grey">{placeLine(header.state, header.country)}</p>
            </div>
          </div>

          <dl className="fstatus" data-scroll="rise">
            <div>
              <dt>Account</dt>
              <dd>{header.account}</dd>
            </div>
            <div>
              <dt>Founder setup</dt>
              <dd>
                {header.setup.stage}
                {header.setup.detail ? <p className="helper">{header.setup.detail}</p> : null}
              </dd>
            </div>
            <div>
              <dt>Payment setup</dt>
              <dd>{header.paymentSetup}</dd>
            </div>
            <div>
              <dt>Current campaign</dt>
              <dd>
                {header.currentCampaign ? (
                  <button type="button" className="camp-link" {...parkedControl('campaign')}>
                    {header.currentCampaign.name}
                  </button>
                ) : (
                  <span className="grey">{NO_ACTIVE_CAMPAIGN_LABEL}</span>
                )}
              </dd>
            </div>
            <div>
              <dt>Campaign status</dt>
              <dd>
                {header.currentCampaign ? (
                  header.currentCampaign.status
                ) : (
                  <span className="grey">Not running a campaign</span>
                )}
              </dd>
            </div>
          </dl>

          <div className="fhead__side" data-scroll="rise">
            {attention.needed ? (
              <AttentionBox chip={ATTENTION_CHIP_LABEL}>
                <p>{attention.text}</p>
                {attentionAction ? (
                  <Button
                    tier="tertiary"
                    onClick={() => {
                      if (attentionAction.act === 'parked-campaign') {
                        parkedToast('campaign');
                        return;
                      }
                      const destination = ATTENTION_TARGETS[attentionAction.act];
                      setTab(destination.pane);
                      setJump(destination.anchor);
                    }}
                  >
                    {attentionAction.label}
                  </Button>
                ) : null}
              </AttentionBox>
            ) : (
              <p className="grey">
                <b>{NO_ATTENTION_LABEL}</b>
              </p>
            )}

            <div className="case-actions fhead__actions">
              {/* Offered only when there is one. A primary action named after a
                  destination that does not exist is worse than no action. */}
              {header.currentCampaign ? (
                <ParkedButton parkedKey="campaign" tier="primary" small>
                  Open current campaign
                </ParkedButton>
              ) : null}
              <ParkedButton parkedKey="support">View support cases</ParkedButton>
              <Menu
                label="More Founder actions"
                trigger={
                  <button
                    ref={menuTriggerRef}
                    type="button"
                    className="btn btn--tertiary"
                    aria-label="More actions"
                  >
                    <span className="btn__label">•••</span>
                  </button>
                }
                items={menuItems}
              />
            </div>
          </div>
        </header>
      </div>

      <nav
        className="tabs"
        ref={tablistRef}
        role="tablist"
        aria-label="Founder workspace"
        onKeyDown={onTabKeys}
      >
        {PANES.map((pane) => (
          <button
            key={pane.key}
            ref={(node) => {
              tabButtons.current[pane.key] = node;
            }}
            type="button"
            id={tabDomId(pane.key)}
            className={cn('tabbtn', tab === pane.key && 'is-active')}
            role="tab"
            aria-selected={tab === pane.key}
            {...(tab === pane.key ? { 'aria-controls': paneDomId(pane.key) } : {})}
            tabIndex={tab === pane.key ? 0 : -1}
            onClick={() => setTab(pane.key)}
          >
            {pane.label}
          </button>
        ))}
        <span ref={underlineRef} className="tabline" aria-hidden="true" />
      </nav>

      <div
        ref={paneRef}
        className="tabpane is-active"
        id={paneDomId(tab)}
        role="tabpanel"
        aria-labelledby={tabDomId(tab)}
        tabIndex={0}
      >
        {tab === 'overview' ? <Overview detail={detail} actions={actions} /> : null}
        {tab === 'details' ? <Details detail={detail} actions={actions} /> : null}
        {tab === 'campaigns' ? <Campaigns detail={detail} actions={actions} /> : null}
        {tab === 'money' ? <Money detail={detail} /> : null}
        {tab === 'history' ? <History detail={detail} /> : null}
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

/**
 * The way back, named.
 *
 * A real link rather than a button that navigates: §33.11.4 refuses an
 * objectless label, and a destination that can be opened in a new tab or read
 * from the status bar is the honest form of "where does this go".
 */
function BackToFounders() {
  return (
    <div className="crumb">
      <RouterLink className="btn btn--tertiary" to="/admin/founders">
        <span className="btn__label">← Founders</span>
      </RouterLink>
    </div>
  );
}

/**
 * State and country, with the honest answer when neither is recorded.
 *
 * `null, null` is a real state for a prospect nobody has met twice, and
 * rendering it as a bare comma would read as a defect rather than as a blank
 * somebody can go and fill (§1.4).
 */
function placeLine(state: string | null, country: string | null): string {
  const parts = [state, country].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(', ') : 'Location not recorded yet';
}
