/**
 * Overview — how this Founder arrived, and how far they have got.
 *
 * The invitation, the setup progress, the answers they wrote, the Creator
 * signal they were shown, and the account they created: the pane reads in the
 * order the Founder lived it, so an Admin opening it during a support call
 * lands on the same story the Founder is telling them.
 *
 * ── Which setup answers carry an Edit control, and when ─────────────────────
 * Problem and Solution take §9's Admin prefill — the same write the intake
 * form makes — so they carry an Edit control exactly while that prefill can
 * still move them: before submission, and before the Founder takes the field
 * over. The server decides `editable`; this pane only renders the answer.
 * Views is the Founder's own choice with no prefill path, and Competition may
 * never even be prefilled — the vetting record has no `competition_prefilled_*`
 * column, a CHECK pins its supplier to the Founder, and §33.1.5 tests all of
 * it. Once the Founder owns an answer, correcting it is a support case, not a
 * field edit.
 *
 * ── Zero matches and no matches are different states ────────────────────────
 * §10 records the possible-Creator count as an Admin's assessment, so `null`
 * means nobody has assessed and `0` means somebody did and found none. The
 * first is a waiting state; the second stops the Founder and needs a person.
 * Rendering either as "0 Creators" would turn an unanswered question into an
 * answer (§16a: not yet populated is not zero).
 */

import {
  ATTENTION_CHIP_LABEL,
  CAMPAIGN_PATH_CHOICES,
  CAMPAIGN_TYPE_LOCK_NOTE,
  CREATOR_MATCH_CAVEAT,
  INVITATION_FIXED_CONTENT_HELPER,
} from '@proovd/shared';
import { Button } from '../../../../components/index.js';
import type { FounderWorkspaceDetail } from '../../api.js';
import { OverrideEdit } from '../dialogs/index.js';
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
  Timeline,
  TimelineRow,
  type WorkspaceActions,
} from '../shared.js';

interface OverviewProps {
  detail: FounderWorkspaceDetail;
  actions: WorkspaceActions;
}

/** The empty-answer sentence, which differs for the one the Founder chooses. */
function unansweredText(key: 'problem' | 'solution' | 'views' | 'competition'): string {
  return key === 'views' ? 'Not chosen yet.' : 'Not answered yet.';
}

export function Overview({ detail, actions }: OverviewProps) {
  const { header, overview } = detail;
  const { invitation, vetting } = overview;
  const who = header.preferredName;

  const content = (key: string) => invitation.content.find((entry) => entry.key === key);
  const canSendNow = header.availableActions.includes('sendinvite');
  const canResend = header.availableActions.includes('newinvite');
  const canCancel = header.availableActions.includes('cancelinvite');
  const source = content('invSource');
  const owner = content('invOwner');
  const editableBody = invitation.content.filter(
    (entry) => entry.key !== 'invSource' && entry.key !== 'invOwner',
  );

  return (
    <>
      <SecTitle>Invitation</SecTitle>
      <div className="inv-status">
        <p className="inv-status__v">
          <b>{invitation.state}</b>
          {invitation.stateAt ? <span className="grey"> · {invitation.stateAt}</span> : null}
        </p>
        <Note>{invitation.meaning}</Note>
      </div>

      <Group>
        {invitation.invitedBy ? (
          <Row label="Invited by" helper="The named Proovd Admin who sent the invitation.">
            {invitation.invitedBy}
          </Row>
        ) : null}
        {[source, owner].map((entry) =>
          entry ? (
            <EditRow
              key={entry.key}
              label={entry.label}
              value={entry.value}
              helper={entry.helper}
              onEdit={(trigger) =>
                actions.editField(
                  {
                    key: entry.key,
                    label: entry.label,
                    value: entry.value,
                    helper: entry.helper,
                  },
                  trigger,
                )
              }
            />
          ) : null,
        )}
      </Group>

      <Expandable label="View invitation details">
        <Group>
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

        <p className="kicker">Invitation-specific content</p>
        <Group>
          {editableBody.map((entry) => (
            <EditRow
              key={entry.key}
              label={entry.label}
              value={entry.value}
              helper={entry.helper}
              emptyLabel="Not written yet"
              onEdit={(trigger) =>
                actions.editField(
                  {
                    key: entry.key,
                    label: entry.label,
                    value: entry.value,
                    helper: entry.helper,
                  },
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
      </Expandable>

      {invitation.canSend || !(canSendNow || canResend) ? null : (
        <>
          <Note>
            This cannot be sent yet, and nothing has been sent. Proovd refuses a send
            while any part of the message is still unresolved.
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
      )}

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
        <Button
          tier="secondary"
          onClick={(event) => actions.previewInvitation(event.currentTarget)}
        >
          Preview invite
        </Button>
        {canCancel ? (
          <Button
            tier="tertiary"
            onClick={(event) => actions.confirm('cancelinvite', event.currentTarget)}
          >
            Cancel invite
          </Button>
        ) : null}
      </Actions>

      <SecTitle>Invitation history</SecTitle>
      {invitation.history.length === 0 ? (
        <p className="grey">Nothing has happened to this invitation yet.</p>
      ) : (
        <Timeline>
          {invitation.history.map((entry) => (
            <TimelineRow
              key={`${entry.at}-${entry.title}`}
              at={entry.at}
              title={entry.title}
              body={entry.body}
            />
          ))}
        </Timeline>
      )}
      <Expandable label="Technical details">
        <p className="grey">{invitation.technical}</p>
      </Expandable>

      <SecTitle>Founder setup progress</SecTitle>
      <Checklist>
        {vetting.progress.map((step) => (
          <CheckLine key={step.label} label={step.label} done={step.done} />
        ))}
      </Checklist>
      <p>
        <b>Status: {vetting.progressStatus}</b>
      </p>

      <SecTitle>Campaign type</SecTitle>
      {vetting.campaignType ? (
        <>
          <p>
            <b>{vetting.campaignType}</b>
            {vetting.campaignTypeAt ? (
              <span className="grey"> · {vetting.campaignTypeAt}</span>
            ) : null}
          </p>
          <Note>{CAMPAIGN_TYPE_LOCK_NOTE}</Note>
        </>
      ) : (
        <>
          {/* Simplified flow: Admin chooses the path from discovery; the
              Founder no longer does. It stays changeable until submission,
              which is when it locks — the server refuses after that whatever
              this pane offers (§1.1). */}
          {vetting.campaignTypeSelected ? (
            <p>
              <b>{vetting.campaignTypeSelected}</b>
              <span className="grey">
                {' '}
                · Set by Proovd — locks when {who} submits their answers
              </span>
            </p>
          ) : (
            <p className="grey">
              Not set yet. Choose the path this campaign runs on — {who} cannot submit
              their answers until one is set.
            </p>
          )}
          {vetting.campaignTypeEditable && vetting.draftId ? (
            <Actions>
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
            </Actions>
          ) : null}
        </>
      )}

      <SecTitle>Setup answers</SecTitle>
      <Group>
        {vetting.answers.map((answer) => (
          <Row key={answer.key} label={answer.label} valueClass="fanswer">
            {answer.text ? (
              <p>{answer.text}</p>
            ) : (
              <p className="grey">{unansweredText(answer.key)}</p>
            )}
            {answer.provenance ? <p className="helper">{answer.provenance}</p> : null}
            {/* §9's prefill, while it can still move the answer: before
                submission, and before the Founder takes the field over. The
                server decides `editable`; Views and Competition never carry
                it, because neither has a prefill path (§33.1.5). */}
            {answer.editable &&
            vetting.draftId &&
            (answer.key === 'problem' || answer.key === 'solution') ? (
              <Button
                tier="tertiary"
                small
                aria-label={`Edit ${answer.label}`}
                onClick={(event) =>
                  actions.editAnswer(
                    {
                      draftId: vetting.draftId!,
                      key: answer.key as 'problem' | 'solution',
                      label: answer.label,
                      text: answer.text,
                    },
                    event.currentTarget,
                  )
                }
              >
                Edit
              </Button>
            ) : null}
          </Row>
        ))}
      </Group>
      {vetting.lastSaved ? <Note>{vetting.lastSaved}</Note> : null}

      <SecTitle id="sec-matches">Potential Creator matches</SecTitle>
      {vetting.creatorMatches === null ? (
        <p className="grey">
          Not available yet — shown after the setup questions are answered.
        </p>
      ) : vetting.creatorMatches.count === 0 ? (
        <AttentionBox chip={ATTENTION_CHIP_LABEL}>
          <p>
            <b>No potential Creator matches were found.</b> The campaign fit is worth a
            review before recruitment work begins — this no longer blocks {who}’s
            account setup.
          </p>
          <ParkedButton parkedKey="creatorFit">Review Creator fit</ParkedButton>
        </AttentionBox>
      ) : (
        <>
          <p className="match-line">
            <b className="match-n">{vetting.creatorMatches.count}</b> Creators may be
            relevant
          </p>
          <Note>{CREATOR_MATCH_CAVEAT}</Note>
          {vetting.creatorMatches.recordedAt ? (
            <Note>Recorded {vetting.creatorMatches.recordedAt}.</Note>
          ) : null}
        </>
      )}

      <SecTitle>Account creation</SecTitle>
      <Group>
        <Row label="Account">
          {overview.accountCreatedAt ? (
            <>
              Account created <span className="grey">· {overview.accountCreatedAt}</span>
            </>
          ) : (
            'Not created yet'
          )}
        </Row>
        {overview.signInMethod ? (
          <Row label="Sign-in method">{overview.signInMethod}</Row>
        ) : null}
      </Group>
    </>
  );
}
