/**
 * The Onboarding section — Invite & Prefills · Eligibility · Optional Items ·
 * Stripe & Listing Fee. Spec §7, §9, §10, §12, §13, §24.6; built Session B
 * (2026-08-17) to the supplied reference.
 *
 * ── Each tab is a question the record answers ───────────────────────────────
 * The reference leads every tab with an eyebrow question and a hero answer,
 * and the wording is pinned in `ONBOARDING_TAB_COPY` so no surface drifts into
 * a second phrasing. The HERO is always derived from the record — never a
 * sentence this file invents.
 *
 * ── What is editable here, and what never is ────────────────────────────────
 * The invitation's §7 content and the identity prefills edit through the
 * workspace's existing dialogs (reason and evidence where §25.6 requires
 * them — the reference's click-away-to-save inline editing cannot carry
 * either, which is why the mechanism differs while the affordance stays a
 * row-level Edit). The Eligibility tab renders NO edit control at all —
 * `ELIGIBILITY_READ_ONLY_NOTE` is the rule and the suite asserts the absence.
 * The §12 items render the Founder's work read-only: Admin owns the DECISION
 * (invalidate / reinstate / override with evidence), never the content.
 *
 * ── The §12 tabs read the §12 route ─────────────────────────────────────────
 * Optional Items and the unpaid fee preview read
 * `/api/admin/campaigns/:id/workspace` — mounted and §33-tested since Phase
 * 09a, screenless since 2026-08-10. One fetch, shared by both tabs; every
 * decision returns the re-read workspace, so nothing is patched locally.
 */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import {
  CAMPAIGN_PATH_CHOICES,
  CAMPAIGN_TYPE_LOCK_NOTE,
  CREATOR_MATCH_CAVEAT,
  ELIGIBILITY_READ_ONLY_NOTE,
  INVITATION_FIXED_CONTENT_HELPER,
  ONBOARDING_TAB_COPY,
  OPTIONAL_ITEMS,
  OPTIONAL_ITEM_CONTENT_IS_FOUNDERS,
  ATTENTION_CHIP_LABEL,
  formatUsd,
  type OnboardingTabKey,
} from '@proovd/shared';
import { Button, StatePanel, useToast } from '../../../../components/index.js';
import { cn } from '../../../../components/cn.js';
import { useProovdMotion } from '../../../../motion/MotionProvider.js';
import {
  AdminRequestError,
  cancelInterviewBooking,
  confirmInterviewBooking,
  fetchCampaignWorkspace,
  invalidateOptionalItem,
  overrideOptionalItem,
  recheckCampaignWorkspace,
  reinstateOptionalItem,
  type CampaignWorkspaceItem,
  type CampaignWorkspaceResponse,
  type CampaignWorkspaceView,
  type FounderWorkspaceDetail,
} from '../../api.js';
import { ConfirmDialog, DialogShell, OverrideEdit, type DialogSpec, type DialogValues } from '../dialogs/index.js';
import {
  Actions,
  AttentionBox,
  CheckLine,
  Checklist,
  EditRow,
  Expandable,
  Group,
  Note,
  ParkedButton,
  Row,
  SecTitle,
  type WorkspaceActions,
} from '../shared.js';

const TAB_KEYS = Object.keys(ONBOARDING_TAB_COPY) as OnboardingTabKey[];
const TAB_LABELS: Record<OnboardingTabKey, string> = {
  invite: 'Invite & Prefills',
  eligibility: 'Eligibility',
  optional: 'Optional Items',
  stripe: 'Stripe & Listing Fee',
};

interface OnboardingSectionProps {
  detail: FounderWorkspaceDetail;
  tab: OnboardingTabKey;
  onTab: (next: OnboardingTabKey) => void;
  actions: WorkspaceActions;
  onOpenHistory: () => void;
  /** Opens the Edit Founder sheet — the record's one bulk-edit surface. */
  onEditFounder: (trigger: HTMLElement | null) => void;
}

export function OnboardingSection({
  detail,
  tab,
  onTab,
  actions,
  onOpenHistory,
  onEditFounder,
}: OnboardingSectionProps) {
  const uid = useId();
  const bodyRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Partial<Record<OnboardingTabKey, HTMLButtonElement | null>>>({});
  useProovdMotion(bodyRef, [tab, detail]);

  /* One §12 read, shared by Optional Items and the unpaid fee preview. */
  const campaignId = detail.header.currentCampaign?.campaignId ?? null;
  const [workspace, setWorkspace] = useState<CampaignWorkspaceResponse | null>(null);
  const [workspaceError, setWorkspaceError] = useState<AdminRequestError | null>(null);

  const loadWorkspace = useCallback(() => {
    if (!campaignId) return;
    setWorkspaceError(null);
    fetchCampaignWorkspace(campaignId)
      .then(setWorkspace)
      .catch((error: unknown) => {
        setWorkspaceError(
          error instanceof AdminRequestError
            ? error
            : new AdminRequestError({
                error: 'unreachable',
                status: 0,
                title: 'The optional-items record could not be read',
                whatHappened:
                  'The §12 workspace read failed and carried no explanation, so nothing on this tab is current.',
                next: 'Try the read again. Nothing was changed by the attempt.',
              }),
        );
      });
  }, [campaignId]);

  useEffect(() => {
    if (tab === 'optional' || tab === 'stripe') loadWorkspace();
  }, [tab, loadWorkspace]);

  function onTabKeys(event: KeyboardEvent<HTMLElement>) {
    const current = TAB_KEYS.indexOf(tab);
    let index = -1;
    if (event.key === 'ArrowRight') index = (current + 1) % TAB_KEYS.length;
    else if (event.key === 'ArrowLeft') index = (current - 1 + TAB_KEYS.length) % TAB_KEYS.length;
    else if (event.key === 'Home') index = 0;
    else if (event.key === 'End') index = TAB_KEYS.length - 1;
    if (index < 0) return;
    const next = TAB_KEYS[index];
    if (!next) return;
    event.preventDefault();
    onTab(next);
    tabRefs.current[next]?.focus();
  }

  const copy = ONBOARDING_TAB_COPY[tab];

  return (
    <div>
      <nav
        className="fob-tabs"
        role="tablist"
        aria-label="Onboarding record"
        onKeyDown={onTabKeys}
      >
        {TAB_KEYS.map((key) => (
          <button
            key={key}
            ref={(node) => {
              tabRefs.current[key] = node;
            }}
            type="button"
            id={`${uid}-obtab-${key}`}
            className={cn('fob-tab', tab === key && 'is-active')}
            role="tab"
            aria-selected={tab === key}
            tabIndex={tab === key ? 0 : -1}
            onClick={() => onTab(key)}
          >
            {TAB_LABELS[key]}
          </button>
        ))}
      </nav>

      <div ref={bodyRef} role="tabpanel" aria-labelledby={`${uid}-obtab-${tab}`}>
        {/* An h2 — the record's h1 is the page heading, and a level skipped
            here fails axe's heading-order on every tab (§33.11.2). The class
            sizes it; the element carries the structure. */}
        <header className="fob-hero" data-scroll="rise">
          <p className="kicker">{copy.question}</p>
          <h2 className="h3">{heroFor(tab, detail, workspace)}</h2>
          <Note>{copy.subtitle}</Note>
        </header>

        {tab === 'invite' ? (
          <InviteTab detail={detail} actions={actions} onOpenHistory={onOpenHistory} onEditFounder={onEditFounder} />
        ) : null}
        {tab === 'eligibility' ? (
          <EligibilityTab detail={detail} onOpenHistory={onOpenHistory} />
        ) : null}
        {tab === 'optional' ? (
          <OptionalItemsTab
            detail={detail}
            campaignId={campaignId}
            response={workspace}
            error={workspaceError}
            onRetry={loadWorkspace}
            onWorkspace={setWorkspace}
            onOpenHistory={onOpenHistory}
          />
        ) : null}
        {tab === 'stripe' ? (
          <StripeTab
            detail={detail}
            response={workspace}
            onOpenHistory={onOpenHistory}
          />
        ) : null}
      </div>
    </div>
  );
}

/* ── The hero answers ───────────────────────────────────────────────────────*/

function heroFor(
  tab: OnboardingTabKey,
  detail: FounderWorkspaceDetail,
  workspace: CampaignWorkspaceResponse | null,
): string {
  switch (tab) {
    case 'invite':
      return detail.overview.invitation.state;
    case 'eligibility': {
      const completion = detail.eligibility.claim.completion;
      if (completion === 'Complete') return 'Eligible — recorded at the account claim';
      if (completion === 'In progress') return 'Account claim in progress';
      return 'Not claimed yet';
    }
    case 'optional': {
      const fee = workspace?.workspace?.fee ?? null;
      if (!fee) return 'Not started yet';
      return `${fee.completedItems} of ${OPTIONAL_ITEMS.length} qualify`;
    }
    case 'stripe': {
      // The backend emits `Paid` / `Refunded`; startsWith keeps a dated
      // variant honest rather than reading as unpaid.
      const listing = detail.money.listings[0] ?? null;
      if (listing?.status.startsWith('Refunded')) return 'The fee was refunded';
      if (listing?.status.startsWith('Paid')) return 'The fee is paid';
      return 'The fee is not paid yet';
    }
  }
}

/* ══ Invite & Prefills ══════════════════════════════════════════════════════*/

function InviteTab({
  detail,
  actions,
  onOpenHistory,
  onEditFounder,
}: {
  detail: FounderWorkspaceDetail;
  actions: WorkspaceActions;
  onOpenHistory: () => void;
  onEditFounder: (trigger: HTMLElement | null) => void;
}) {
  const { header, overview } = detail;
  const { invitation, vetting } = overview;
  const who = header.preferredName;

  const content = (key: string) => invitation.content.find((entry) => entry.key === key);
  const canSendNow = header.availableActions.includes('sendinvite');
  const canResend = header.availableActions.includes('newinvite');
  const canCancel = header.availableActions.includes('cancelinvite');
  const gateFields = [content('invSource'), content('invOwner')];
  const messageFields = invitation.content.filter(
    (entry) => entry.key !== 'invSource' && entry.key !== 'invOwner',
  );

  const answer = (key: 'problem' | 'solution' | 'views' | 'competition') =>
    vetting.answers.find((a) => a.key === key) ?? null;
  const competition = answer('competition');

  return (
    <>
      {/* ── The invitation ─────────────────────────────────────────────── */}
      <section className="fob-panel" data-scroll="rise">
        <SecTitle>Invitation</SecTitle>
        <p className="inv-status__v">
          <b>{invitation.state}</b>
          {invitation.stateAt ? <span className="grey"> · {invitation.stateAt}</span> : null}
        </p>
        <Note>{invitation.meaning}</Note>

        <Group>
          {invitation.invitedBy ? (
            <Row label="Sender" helper="The named Proovd Admin who sent the invitation.">
              {invitation.invitedBy}
            </Row>
          ) : (
            <Row label="Sender">
              <span className="grey">Recorded from the Admin who presses Send.</span>
            </Row>
          )}
          {invitation.overrides.map((field) => (
            <OverrideEdit
              key={field.key}
              field={field}
              preferredName={who}
              onSave={(value) => actions.setOverride(field.key, value)}
              onClear={() => actions.clearOverride(field.key)}
            />
          ))}
        </Group>

        <p className="kicker">Invitation content</p>
        <Group>
          {messageFields.map((entry) => (
            <EditRow
              key={entry.key}
              label={entry.label}
              value={entry.value}
              helper={entry.helper}
              emptyLabel="Not written yet"
              onEdit={(trigger) =>
                actions.editField(
                  { key: entry.key, label: entry.label, value: entry.value, helper: entry.helper },
                  trigger,
                )
              }
            />
          ))}
        </Group>

        {invitation.fixedContent.length > 0 ? (
          <>
            <p className="kicker">Fixed wording</p>
            <Group>
              {invitation.fixedContent.map((entry) => (
                <Row key={entry.key} label={entry.label}>
                  {entry.value}
                </Row>
              ))}
            </Group>
            <Note>{INVITATION_FIXED_CONTENT_HELPER}</Note>
          </>
        ) : null}

        <p className="kicker">Record</p>
        <Group>
          <Row label="Sends">{invitation.facts.sendCount}</Row>
          <Row label="Version">
            {invitation.facts.tokenVersion !== null ? (
              `Invite v${invitation.facts.tokenVersion}`
            ) : (
              <span className="grey">No link issued yet</span>
            )}
          </Row>
          <Row label="Link">{invitation.facts.expiration}</Row>
          <Row label="Claimed">
            {invitation.facts.claimed ?? <span className="grey">Not yet</span>}
          </Row>
          <Row label="Revoked">{invitation.facts.revoked ? 'Yes' : 'No'}</Row>
        </Group>

        {/* §7's send gate, and the two fields the marker scan cannot see. */}
        {!invitation.canSend && (canSendNow || canResend) ? (
          <>
            <Note>
              This cannot be sent yet. Proovd refuses a send while any part of the message is
              still unresolved.
            </Note>
            <ul className="plain-list">
              {invitation.unresolvedMarkers.map((marker) => (
                <li key={`marker-${marker}`}>{marker} is still a placeholder in the message.</li>
              ))}
              {invitation.missingBeforeSend.map((field) => (
                <li key={`missing-${field}`}>{field} has not been recorded.</li>
              ))}
            </ul>
          </>
        ) : null}
        <Group>
          {gateFields.map((entry) =>
            entry ? (
              <EditRow
                key={entry.key}
                label={entry.label}
                value={entry.value}
                helper={entry.helper}
                onEdit={(trigger) =>
                  actions.editField(
                    { key: entry.key, label: entry.label, value: entry.value, helper: entry.helper },
                    trigger,
                  )
                }
              />
            ) : null,
          )}
        </Group>

        <Actions>
          {canSendNow ? (
            <Button
              tier="primary"
              disabled={!invitation.canSend}
              onClick={(event) => actions.confirm('sendinvite', event.currentTarget)}
            >
              Send invite
            </Button>
          ) : null}
          {canResend ? (
            <Button
              tier="primary"
              disabled={!invitation.canSend}
              onClick={(event) => actions.confirm('newinvite', event.currentTarget)}
            >
              Send a new invite
            </Button>
          ) : null}
          <Button tier="secondary" onClick={(event) => actions.previewInvitation(event.currentTarget)}>
            Preview invite
          </Button>
          {canCancel ? (
            <Button tier="tertiary" onClick={(event) => actions.confirm('cancelinvite', event.currentTarget)}>
              Cancel invite
            </Button>
          ) : null}
          <Button tier="tertiary" onClick={onOpenHistory}>
            History
          </Button>
        </Actions>

        <Expandable label="Invitation history">
          {invitation.history.length === 0 ? (
            <p className="grey">Nothing has happened to this invitation yet.</p>
          ) : (
            <div className="tl">
              {invitation.history.map((entry) => (
                <div key={`${entry.at}-${entry.title}`} className="tl-row">
                  <time>{entry.at}</time>
                  <div>
                    <p>
                      <b>{entry.title}</b>
                      <br />
                      <span className="grey">{entry.body}</span>
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="grey">{invitation.technical}</p>
        </Expandable>
      </section>

      {/* ── The prefills ───────────────────────────────────────────────── */}
      <section className="fob-panel" data-scroll="rise">
        <SecTitle>Prefilled Founder information</SecTitle>
        <Note>Every value shows its source, and whether the Founder changed it.</Note>

        <Group>
          {(
            [
              { key: 'legal', label: 'Founder name', value: header.legalName },
              { key: 'bizLegal', label: 'Business name', value: header.businessName },
              { key: 'email', label: 'Account email', value: header.email },
              { key: 'phone', label: 'Phone', value: header.phone },
            ] as const
          ).map((field) => (
            <EditRow
              key={field.key}
              label={field.label}
              value={field.value}
              onEdit={(trigger) =>
                actions.editField(
                  { key: field.key, label: field.label, value: field.value },
                  trigger,
                )
              }
            />
          ))}

          <Row label="Campaign type">
            {vetting.campaignType ? (
              <>
                <b>{vetting.campaignType}</b>
                {vetting.campaignTypeAt ? <span className="grey"> · {vetting.campaignTypeAt}</span> : null}
                <p className="helper">{CAMPAIGN_TYPE_LOCK_NOTE}</p>
              </>
            ) : vetting.campaignTypeSelected ? (
              <>
                {vetting.campaignTypeSelected}
                <span className="grey"> · Set by Proovd — locks when {who} submits</span>
              </>
            ) : (
              <span className="grey">Not decided yet</span>
            )}
            {!vetting.campaignType && vetting.campaignTypeEditable && vetting.draftId ? (
              <span className="fob-pathset">
                {CAMPAIGN_PATH_CHOICES.map((choice) => {
                  const selected = vetting.campaignTypeSelectedRaw === choice.type;
                  const draftId = vetting.draftId!;
                  return (
                    <Button
                      key={choice.type}
                      tier={selected ? 'secondary' : 'tertiary'}
                      small
                      disabled={selected}
                      onClick={() => void actions.setCampaignPath(draftId, choice.type)}
                    >
                      {selected ? `${choice.name} (set)` : `Set ${choice.name}`}
                    </Button>
                  );
                })}
              </span>
            ) : null}
          </Row>

          {(['problem', 'solution'] as const).map((key) => {
            const row = answer(key);
            if (!row) return null;
            return (
              <Row key={key} label={row.label} valueClass="fanswer">
                {row.text ? <p>{row.text}</p> : <p className="grey">Not answered yet.</p>}
                {row.provenance ? <p className="helper">{row.provenance}</p> : null}
                {row.editable && vetting.draftId ? (
                  <Button
                    tier="tertiary"
                    small
                    aria-label={`Edit ${row.label}`}
                    onClick={(event) =>
                      actions.editAnswer(
                        { draftId: vetting.draftId!, key, label: row.label, text: row.text },
                        event.currentTarget,
                      )
                    }
                  >
                    Edit
                  </Button>
                ) : null}
              </Row>
            );
          })}

          {(() => {
            const views = answer('views');
            if (!views) return null;
            return (
              <Row label={views.label} valueClass="fanswer">
                {views.text ? <p>{views.text}</p> : <p className="grey">Not chosen yet.</p>}
                <p className="helper">{CREATOR_MATCH_CAVEAT}</p>
              </Row>
            );
          })()}
        </Group>

        <Actions>
          <Button tier="secondary" onClick={(event) => onEditFounder(event.currentTarget)}>
            Edit Founder record
          </Button>
          <Button tier="tertiary" onClick={onOpenHistory}>
            History
          </Button>
        </Actions>

        <SecTitle>Founder setup progress</SecTitle>
        <Checklist>
          {vetting.progress.map((step) => (
            <CheckLine key={step.label} label={step.label} done={step.done} />
          ))}
        </Checklist>
        <p>
          <b>Status: {vetting.progressStatus}</b>
        </p>
        {vetting.lastSaved ? <Note>{vetting.lastSaved}</Note> : null}

        <SecTitle id="sec-matches">Potential Creator matches</SecTitle>
        {vetting.creatorMatches === null ? (
          <p className="grey">Not available yet — shown after the setup questions are answered.</p>
        ) : vetting.creatorMatches.count === 0 ? (
          <AttentionBox chip={ATTENTION_CHIP_LABEL}>
            <p>
              <b>No potential Creator matches were found.</b> The campaign fit is worth a review
              before recruitment work begins — this no longer blocks {who}’s account setup.
            </p>
            <ParkedButton parkedKey="creatorFit">Review Creator fit</ParkedButton>
          </AttentionBox>
        ) : (
          <>
            <p className="match-line">
              <b className="match-n">{vetting.creatorMatches.count}</b> Creators may be relevant
            </p>
            <Note>{CREATOR_MATCH_CAVEAT}</Note>
            {vetting.creatorMatches.recordedAt ? (
              <Note>Recorded {vetting.creatorMatches.recordedAt}.</Note>
            ) : null}
          </>
        )}
      </section>

      {/* ── Competition — legacy answers only (0042) ───────────────────── */}
      {competition?.text ? (
        <section className="fob-panel" data-scroll="rise">
          <SecTitle>Competition</SecTitle>
          <Note>
            A legacy answer — the question left the product on 2026-08-10 (migration 0042).
            §9 makes it the Founder’s own thinking: it is never prefilled, and there is no
            edit or correction path.
          </Note>
          <Group>
            <Row label="Current text" valueClass="fanswer">
              <p>{competition.text}</p>
              {competition.provenance ? <p className="helper">{competition.provenance}</p> : null}
            </Row>
            <Row label="Ownership">Founder-written (§9)</Row>
          </Group>
        </section>
      ) : null}
    </>
  );
}

/* ══ Eligibility ════════════════════════════════════════════════════════════*/

/**
 * Read-only, structurally: this component renders no Edit control, no input,
 * and no action that writes — `ELIGIBILITY_READ_ONLY_NOTE` is the rule and
 * the suite asserts the absence of controls, not just the sentence.
 */
function EligibilityTab({
  detail,
  onOpenHistory,
}: {
  detail: FounderWorkspaceDetail;
  onOpenHistory: () => void;
}) {
  const { eligibility, overview } = detail;

  const fact = (value: boolean | null, yes: string, no: string): ReactNode =>
    value === null ? (
      <span className="grey">No claim record yet</span>
    ) : value ? (
      yes
    ) : (
      <span className="grey">{no}</span>
    );

  return (
    <>
      <section className="fob-panel" data-scroll="rise">
        <SecTitle>Account claim</SecTitle>
        <Note>How the invitation became an account.</Note>
        <Group>
          <Row label="Invite claimed">{eligibility.claim.inviteClaimed ? 'Yes' : 'Not yet'}</Row>
          <Row label="Claimed at">
            {eligibility.claim.claimedAt ?? <span className="grey">Not yet</span>}
          </Row>
          <Row label="Account created">
            {eligibility.claim.accountCreatedAt ?? <span className="grey">Not yet</span>}
          </Row>
          {overview.signInMethod ? <Row label="Sign-in method">{overview.signInMethod}</Row> : null}
          <Row label="Claim completion">{eligibility.claim.completion}</Row>
          <Row label="Connected record">{eligibility.claim.connectedRecord}</Row>
        </Group>
        <Actions>
          <Button tier="tertiary" onClick={onOpenHistory}>
            Read-only history
          </Button>
        </Actions>
      </section>

      <section className="fob-panel" data-scroll="rise">
        <SecTitle>Eligibility &amp; acknowledgements</SecTitle>
        <Note>Provider and system truth.</Note>
        <Group>
          <Row
            label="Date of birth"
            helper="Supplied at the claim. The value is not shown on this screen."
          >
            {eligibility.facts.dobSupplied === null ? (
              <span className="grey">No claim record yet</span>
            ) : eligibility.facts.dobSupplied ? (
              'Supplied'
            ) : (
              <span className="grey">Not supplied yet</span>
            )}
          </Row>
          <Row
            label="18 or older"
            helper="The Founder’s recorded representation at the claim — Proovd derives no age and verifies none."
          >
            {fact(eligibility.facts.age18Plus, 'Represented — 18+', 'Not represented yet')}
          </Row>
          <Row
            label="US eligibility"
            helper="The Founder’s recorded representation, with the location they supplied."
          >
            {eligibility.facts.usPerson === null ? (
              <span className="grey">No claim record yet</span>
            ) : (
              <>
                {eligibility.facts.usPerson ? 'Represented — US person' : (
                  <span className="grey">Not represented yet</span>
                )}
                {eligibility.facts.location ? ` · ${eligibility.facts.location}` : null}
              </>
            )}
          </Row>
          <Row label="Sanctions representation">
            {fact(eligibility.facts.sanctionsClear, 'Represented — clear', 'Not represented yet')}
          </Row>
          {eligibility.acknowledgements.map((ack, index) => (
            <Row key={`${ack.label}-${ack.version}`} label={`Acknowledgement ${index + 1}`}>
              {ack.label} {ack.version} · accepted {ack.acceptedAt}
            </Row>
          ))}
          {eligibility.acknowledgementsAbsent ? (
            <Row label="Acknowledgements">
              <span className="grey">{eligibility.acknowledgementsAbsent}</span>
            </Row>
          ) : null}
        </Group>
        <Note>
          <b>Read only.</b> {ELIGIBILITY_READ_ONLY_NOTE}
        </Note>
      </section>
    </>
  );
}

/* ══ Optional Items (§12) ═══════════════════════════════════════════════════*/

type ItemDecision =
  | { kind: 'invalidate'; item: string; label: string; trigger: HTMLElement | null }
  | { kind: 'reinstate'; item: string; label: string; trigger: HTMLElement | null }
  | { kind: 'override'; item: string; label: string; trigger: HTMLElement | null }
  | { kind: 'interview-confirm'; bookingId: string; trigger: HTMLElement | null }
  | { kind: 'interview-cancel'; bookingId: string; trigger: HTMLElement | null };

function OptionalItemsTab({
  detail,
  campaignId,
  response,
  error,
  onRetry,
  onWorkspace,
  onOpenHistory,
}: {
  detail: FounderWorkspaceDetail;
  campaignId: string | null;
  response: CampaignWorkspaceResponse | null;
  error: AdminRequestError | null;
  onRetry: () => void;
  onWorkspace: (next: CampaignWorkspaceResponse) => void;
  onOpenHistory: () => void;
}) {
  const toast = useToast();
  const [decision, setDecision] = useState<ItemDecision | null>(null);
  const reference = `Admin · Founders · ${detail.header.recordReference}`;

  if (!campaignId) {
    return (
      <StatePanel
        state="No campaign to evaluate yet"
        whatHappened="The §12 optional items live on a campaign’s workspace, and this Founder has no current campaign."
        next="The tab fills in when a campaign exists."
        owner="Proovd"
        nextUpdate="When a campaign is created"
        action="No action needed"
        reference={reference}
      />
    );
  }

  if (error) {
    return (
      <StatePanel
        state={error.detail.title}
        whatHappened={error.detail.whatHappened ?? 'The optional-items record could not be read.'}
        next={error.detail.next ?? 'Try the read again. Nothing was changed by the attempt.'}
        owner="Proovd"
        nextUpdate="When you try again"
        action={
          <Button tier="secondary" onClick={onRetry}>
            Try the read again
          </Button>
        }
        reference={reference}
        ring
      />
    );
  }

  if (!response) {
    return (
      <StatePanel
        state="Reading the optional items"
        whatHappened="Proovd is reading the §12 items, their evidence, and the fee preview."
        next="The record appears as soon as that comes back."
        owner="Proovd"
        nextUpdate="Within a few seconds"
        action="No action needed"
        reference={reference}
      />
    );
  }

  const view = response.workspace;
  if (!view) {
    return (
      <StatePanel
        state="The Founder has not opened their campaign workspace yet"
        whatHappened={
          response.whatHappened ??
          'The §12 items exist once the Founder opens their campaign workspace, and this Founder has not yet.'
        }
        next="The five items and the fee preview appear as soon as they do."
        owner="Founder"
        nextUpdate="When the Founder starts their campaign workspace"
        action="No action needed"
        reference={reference}
      />
    );
  }

  const fee = view.fee;
  const locked = fee?.locked ?? false;
  const discountFor = (item: string): string => {
    const line = fee?.discountLines.find((l) => l.item === item);
    return line ? `−${formatUsd(BigInt(line.discountCents))} · qualified` : formatUsd(0n);
  };

  const itemOf = (key: string): CampaignWorkspaceItem | null =>
    view.items.find((i) => i.item === key) ?? null;

  const applyDecision = async (values: DialogValues) => {
    if (!decision) return;
    let next: CampaignWorkspaceResponse;
    switch (decision.kind) {
      case 'invalidate':
        next = await invalidateOptionalItem(campaignId, decision.item, {
          reason: values['reason'] ?? '',
          explanation: values['explanation'] ?? '',
        });
        break;
      case 'reinstate':
        next = await reinstateOptionalItem(campaignId, decision.item, values['reason'] ?? '');
        break;
      case 'override':
        next = await overrideOptionalItem(campaignId, decision.item, {
          complete: values['complete'] === 'Mark complete',
          reason: values['reason'] ?? '',
          explanation: values['explanation'] ?? '',
          evidence: values['evidence'] ?? '',
        });
        break;
      case 'interview-confirm':
        next = await confirmInterviewBooking(campaignId, decision.bookingId, {
          ...(values['meetingLink'] ? { meetingLink: values['meetingLink'] } : {}),
          ...(values['interviewer'] ? { interviewer: values['interviewer'] } : {}),
        });
        break;
      case 'interview-cancel':
        next = await cancelInterviewBooking(campaignId, decision.bookingId, values['reason'] ?? '');
        break;
    }
    onWorkspace(next);
    toast('Recorded', { sub: 'The §12 record has been re-read.' });
  };

  const recheck = async () => {
    const next = await recheckCampaignWorkspace(campaignId);
    onWorkspace(next);
    toast('Re-evaluated', { sub: 'Every §12 rule was re-run against the stored content.' });
  };

  const booking = view.interview.booking;

  return (
    <>
      {fee ? (
        <div className="fob-stats" data-scroll="rise">
          <div>
            <b>{fee.completedItems}</b>
            <span>Valid items</span>
          </div>
          <div>
            <b>{formatUsd(BigInt(fee.discountCents))}</b>
            <span>Earned discount</span>
          </div>
          <div>
            <b>{OPTIONAL_ITEMS.length - fee.completedItems}</b>
            <span>Open or invalid</span>
          </div>
        </div>
      ) : null}

      <section className="fob-panel" data-scroll="rise">
        <SecTitle>Overall onboarding</SecTitle>
        <Note>Completion is system-owned; optional items remain non-blocking.</Note>
        <Group>
          <Row label="Decided by">
            The server, against the stored content — an item completes only when its §12 rule
            holds.
          </Row>
          <Row label="Fee state">
            {locked
              ? 'Locked — the listing fee has been paid, and §12 locks the calculation and every item.'
              : 'Open — items and the fee preview move until payment.'}
          </Row>
          {fee?.calculatedAt ? <Row label="Last calculated">{fee.calculatedAt}</Row> : null}
        </Group>
        <Note>{OPTIONAL_ITEM_CONTENT_IS_FOUNDERS}</Note>
        <Actions>
          <Button tier="secondary" onClick={() => void recheck()}>
            Re-run the checks
          </Button>
          <Button tier="tertiary" onClick={onOpenHistory}>
            History
          </Button>
        </Actions>
      </section>

      {OPTIONAL_ITEMS.map((meta) => {
        const item = itemOf(meta.key);
        return (
          <section key={meta.key} className="fob-panel" data-scroll="rise">
            <SecTitle>{meta.label}</SecTitle>
            <Note>{meta.completesWhen}</Note>
            <Group>
              <Row label="Status">
                {item === null ? (
                  <span className="grey">Not started</span>
                ) : item.invalidated.at ? (
                  'Invalid'
                ) : item.complete ? (
                  'Valid'
                ) : (
                  <span className="grey">Not complete</span>
                )}
              </Row>
              {item?.decisionSource === 'admin_override' ? (
                <Row label="Decision source">Admin override — recorded with its evidence</Row>
              ) : null}
              {item?.completedAt ? <Row label="Completed">{item.completedAt}</Row> : null}
              {item && item.rejections.length > 0 ? (
                <Row label="Why not yet">
                  <ul className="plain-list">
                    {item.rejections.map((rejection) => (
                      <li key={rejection}>{rejection}</li>
                    ))}
                  </ul>
                </Row>
              ) : null}
              {item?.invalidated.at ? (
                <>
                  <Row label="Invalidated">{item.invalidated.at}</Row>
                  <Row label="Founder-facing explanation">
                    {item.invalidated.explanation ?? <span className="grey">None recorded</span>}
                  </Row>
                  {item.invalidatedReason ? (
                    <Row label="Internal reason" helper="Never shown to the Founder (§25.6).">
                      {item.invalidatedReason}
                    </Row>
                  ) : null}
                </>
              ) : null}
              {meta.key === 'visuals' || meta.key === 'branding' ? (
                <Row label={meta.key === 'visuals' ? 'Files' : 'Logo files'}>
                  {(() => {
                    const files = view.assets.filter(
                      (a) => a.purpose === (meta.key === 'visuals' ? 'visual' : 'logo') && !a.removed,
                    );
                    return files.length > 0 ? (
                      files.map((f) => f.filename ?? f.contentType).join(' · ')
                    ) : (
                      <span className="grey">None uploaded</span>
                    );
                  })()}
                </Row>
              ) : null}
              {meta.key === 'socials' ? (
                <Row label="Profiles">
                  {view.socials.filter((s) => !s.removed).length > 0 ? (
                    view.socials
                      .filter((s) => !s.removed)
                      .map((s) => s.url)
                      .join(' · ')
                  ) : (
                    <span className="grey">None supplied</span>
                  )}
                </Row>
              ) : null}
              {meta.key === 'interview' && booking ? (
                <>
                  <Row label="Booking status">{booking.status}</Row>
                  {booking.scheduledAt ? <Row label="Scheduled">{booking.scheduledAt}</Row> : null}
                  {booking.founderTimezone ? (
                    <Row label="Timezone">{booking.founderTimezone}</Row>
                  ) : null}
                  {booking.meetingProvider ? (
                    <Row label="Provider">{booking.meetingProvider}</Row>
                  ) : null}
                  {booking.interviewer ? (
                    <Row label="Interviewer">{booking.interviewer}</Row>
                  ) : null}
                </>
              ) : null}
              {meta.key === 'interview' && !booking ? (
                <Row label="Booking">
                  <span className="grey">
                    No booking exists. The Founder books through their own workspace; Admin’s
                    reconciliation path operates an existing booking.
                  </span>
                </Row>
              ) : null}
              <Row label="Discount">{discountFor(meta.key)}</Row>
            </Group>

            {locked ? (
              <Note>Locked at payment — §12 locks the evidence snapshot and the calculation.</Note>
            ) : (
              <Actions>
                {item?.complete && !item.invalidated.at ? (
                  <Button
                    tier="tertiary"
                    onClick={(event) =>
                      setDecision({
                        kind: 'invalidate',
                        item: meta.key,
                        label: meta.label,
                        trigger: event.currentTarget,
                      })
                    }
                  >
                    Mark invalid
                  </Button>
                ) : null}
                {item?.invalidated.at ? (
                  <Button
                    tier="tertiary"
                    onClick={(event) =>
                      setDecision({
                        kind: 'reinstate',
                        item: meta.key,
                        label: meta.label,
                        trigger: event.currentTarget,
                      })
                    }
                  >
                    Reinstate
                  </Button>
                ) : null}
                <Button
                  tier="tertiary"
                  onClick={(event) =>
                    setDecision({
                      kind: 'override',
                      item: meta.key,
                      label: meta.label,
                      trigger: event.currentTarget,
                    })
                  }
                >
                  Record override
                </Button>
                {meta.key === 'interview' && booking ? (
                  <>
                    <Button
                      tier="tertiary"
                      onClick={(event) =>
                        setDecision({
                          kind: 'interview-confirm',
                          bookingId: booking.id,
                          trigger: event.currentTarget,
                        })
                      }
                    >
                      Mark confirmed
                    </Button>
                    <Button
                      tier="tertiary"
                      onClick={(event) =>
                        setDecision({
                          kind: 'interview-cancel',
                          bookingId: booking.id,
                          trigger: event.currentTarget,
                        })
                      }
                    >
                      Cancel interview
                    </Button>
                  </>
                ) : null}
              </Actions>
            )}
          </section>
        );
      })}

      {decision ? (
        <ConfirmDialog
          spec={decisionSpec(decision, detail.header.preferredName)}
          trigger={decision.trigger}
          onSubmit={applyDecision}
          onClose={() => setDecision(null)}
        />
      ) : null}
    </>
  );
}

/** The §12 decision dialogs. Every required field is the route's own rule. */
function decisionSpec(decision: ItemDecision, who: string): DialogSpec {
  const kicker = 'Optional items · §12';
  switch (decision.kind) {
    case 'invalidate':
      return {
        kicker,
        title: `Mark ${decision.label} invalid`,
        body: (
          <p>
            §12 requires an internal reason AND an explanation {who} can read and correct
            from. The item stops counting toward the fee discount immediately.
          </p>
        ),
        fields: [
          { id: 'reason', label: 'Internal reason', required: true, textarea: true },
          {
            id: 'explanation',
            label: `Explanation ${who} will read`,
            required: true,
            textarea: true,
          },
        ],
        primary: 'Mark invalid',
      };
    case 'reinstate':
      return {
        kicker,
        title: `Reinstate ${decision.label}`,
        body: (
          <p>
            Lifts the invalidation and lets the evidence decide again — this does not hand out
            a completion.
          </p>
        ),
        fields: [{ id: 'reason', label: 'Why the invalidation is being lifted', required: true, textarea: true }],
        primary: 'Reinstate',
      };
    case 'override':
      return {
        kicker,
        title: `Record an override — ${decision.label}`,
        body: (
          <p>
            §12’s manual override: prior value, new value, reason, actor, time, and evidence
            are all recorded, and the item carries “admin_override” for the rest of the
            campaign’s life.
          </p>
        ),
        fields: [
          {
            id: 'complete',
            label: 'Decision',
            select: true,
            options: ['Mark complete', 'Mark not complete'],
            value: 'Mark complete',
          },
          { id: 'reason', label: 'Internal reason', required: true, textarea: true },
          {
            id: 'explanation',
            label: `Explanation ${who} will read`,
            required: true,
            textarea: true,
          },
          {
            id: 'evidence',
            label: 'Evidence',
            required: true,
            textarea: true,
            hint: 'What this decision rests on — a ticket, a call, a file received out of band.',
          },
        ],
        primary: 'Record override',
      };
    case 'interview-confirm':
      return {
        kicker,
        title: 'Confirm the interview booking',
        body: (
          <p>
            Phase 09’s reconciliation path: a confirmation that came from a person is recorded
            as one, never mistaken for the provider’s.
          </p>
        ),
        fields: [
          { id: 'meetingLink', label: 'Meeting link', inputType: 'url' },
          { id: 'interviewer', label: 'Interviewer' },
        ],
        primary: 'Confirm booking',
      };
    case 'interview-cancel':
      return {
        kicker,
        title: 'Cancel the interview booking',
        body: (
          <p>
            Cancelling moves the §12 interview item and, before payment, the fee preview. Say
            why — the reason lands in the booking’s append-only history.
          </p>
        ),
        fields: [{ id: 'reason', label: 'Cancellation reason', required: true, textarea: true }],
        primary: 'Cancel booking',
      };
  }
}

/* ══ Stripe & Listing Fee ═══════════════════════════════════════════════════*/

function StripeTab({
  detail,
  response,
  onOpenHistory,
}: {
  detail: FounderWorkspaceDetail;
  response: CampaignWorkspaceResponse | null;
  onOpenHistory: () => void;
}) {
  const { money } = detail;
  const [secureStatus, setSecureStatus] = useState<HTMLElement | null | false>(false);

  const fee = response?.workspace?.fee ?? null;

  return (
    <>
      <section className="fob-panel fob-panel--dark" data-scroll="rise">
        <SecTitle>Stripe</SecTitle>
        <Note>{money.setup.body}</Note>
        <Group>
          <Row label="Connected account">
            {money.stripe ? money.stripe.accountId : <span className="grey">{money.setup.value}</span>}
          </Row>
          <Row label="State">{money.setup.value}</Row>
          <Row label="Identity check" helper={money.identity.helper}>
            {money.identity.value}
          </Row>
          {money.stripe?.lastUpdated ? (
            <Row label="Provider update">{money.stripe.lastUpdated}</Row>
          ) : null}
        </Group>
        <Actions>
          {money.stripe ? (
            <Button tier="secondary" onClick={(event) => setSecureStatus(event.currentTarget)}>
              Open secure status
            </Button>
          ) : null}
          <Button tier="tertiary" onClick={onOpenHistory}>
            History
          </Button>
        </Actions>
      </section>

      <section className="fob-panel" data-scroll="rise">
        <SecTitle>Listing fee</SecTitle>
        {money.listings.length > 0 ? (
          money.listings.map((listing) => (
            <div key={listing.campaignId} className="camp-block">
              <p>
                <b>{listing.campaignName}</b> · {listing.status}
              </p>
              <Group>
                {listing.lines.map((line) => (
                  <Row key={line.label} label={line.label} valueClass={line.sub ? 'grey' : undefined}>
                    {line.amount}
                  </Row>
                ))}
              </Group>
            </div>
          ))
        ) : fee ? (
          <>
            <Note>
              Not paid yet — this is the live preview, and it moves with the §12 items until
              payment. Sales tax is calculated at payment from a real billing address, so no
              tax line is shown here.
            </Note>
            <Group>
              <Row label="Starting listing fee">{formatUsd(BigInt(fee.baseCents))}</Row>
              {fee.discountLines.map((line) => {
                const meta = OPTIONAL_ITEMS.find((i) => i.key === line.item);
                return (
                  <Row key={line.item} label={`${meta?.label ?? line.item} completed`} valueClass="grey">
                    −{formatUsd(BigInt(line.discountCents))}
                  </Row>
                );
              })}
              <Row label="Subtotal before tax">{formatUsd(BigInt(fee.subtotalCents))}</Row>
            </Group>
            <Note>{fee.separateStreamNote}</Note>
          </>
        ) : (
          <Note>
            No fee calculation exists yet — it appears once the Founder opens their campaign
            workspace.
          </Note>
        )}
        <Actions>
          <Button tier="tertiary" onClick={onOpenHistory}>
            History
          </Button>
        </Actions>
      </section>

      {secureStatus !== false ? (
        <DialogShell
          kicker="Stripe · provider-owned status"
          title="Stripe requirements"
          description={
            <p>
              What Stripe last reported for this account. Proovd stores the status and the
              identifiers — never the documents behind them (§13).
            </p>
          }
          trigger={secureStatus}
          onClose={() => setSecureStatus(false)}
        >
          {(close) => (
            <>
              <Group>
                <Row label="Connected account">{money.stripe?.accountId ?? '—'}</Row>
                <Row label="State">{money.setup.value}</Row>
                <Row label="Missing requirements">{money.stripe?.requirements ?? 'None'}</Row>
                <Row label="Capability">{money.stripe?.capability ?? '—'}</Row>
                <Row label="Last provider update">{money.stripe?.lastUpdated ?? '—'}</Row>
              </Group>
              <Actions>
                <Button tier="secondary" onClick={close}>
                  Done
                </Button>
              </Actions>
            </>
          )}
        </DialogShell>
      ) : null}
    </>
  );
}
