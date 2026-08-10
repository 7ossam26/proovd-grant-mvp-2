/**
 * Details — who this person is, and where they stand.
 *
 * ── `editable` is the server's answer, not a guess about the field ──────────
 * Every row renders from a `DetailField`, and whether it carries an Edit
 * control is the flag the payload set. That matters most for the one field an
 * Admin will expect to be editable and must not be: §27.7's digest frequency
 * exists only because a person chose it, and §30 forbids the product answering
 * on their behalf. It is shown with the reason it cannot be changed here,
 * rather than being left off the page — an Admin who cannot see the preference
 * asks the Founder to describe it on a support call.
 *
 * ── Access and enforcement is two records, not one status ───────────────────
 * A suspension is a `founder_access_actions` row with a reason, an owner, and
 * a next review; a ban is §22.7's own record and is permanent, which is why
 * there is no lift control anywhere on this page and no route behind one. The
 * account state at the top of the workspace is derived from those rows plus
 * the claim — nothing on this surface writes a status.
 *
 * ── A deletion request is a record of an ask ────────────────────────────────
 * §25.8 keeps campaign, payment, tax, support, and audit records regardless of
 * whether an account closes, so there is no approve control and no "delete
 * everything" action here. What the review records is what an Admin concluded.
 */

import { ATTENTION_CHIP_LABEL, DELETION_RETENTION_NOTE, SUMMARY_IS_NOT_ADMIN_WRITABLE } from '@proovd/shared';
import { Button } from '../../../../components/index.js';
import type { DetailField, FounderWorkspaceDetail } from '../../api.js';
import {
  Actions,
  AttentionBox,
  EditRow,
  Group,
  Headline,
  Missing,
  Note,
  ParkedButton,
  Row,
  SecTitle,
  type WorkspaceActions,
} from '../shared.js';

interface DetailsProps {
  detail: FounderWorkspaceDetail;
  actions: WorkspaceActions;
}

/**
 * The activity summary must always carry its reason.
 *
 * The server sends the helper; this is the belt to its braces, because a
 * read-only control with no explanation reads as a bug an Admin will file
 * rather than a rule the product is keeping (§1.4).
 */
function helperFor(field: DetailField): string | null {
  if (field.helper) return field.helper;
  if (field.key === 'summary') return SUMMARY_IS_NOT_ADMIN_WRITABLE;
  return null;
}

function Fields({
  fields,
  actions,
}: {
  fields: DetailField[];
  actions: WorkspaceActions;
}) {
  return (
    <Group>
      {fields.map((field) => {
        const helper = helperFor(field);

        if (field.editable) {
          return (
            <EditRow
              key={field.key}
              label={field.label}
              value={field.value}
              helper={helper}
              onEdit={(trigger) =>
                actions.editField(
                  {
                    key: field.key,
                    label: field.label,
                    value: field.value,
                    helper,
                  },
                  trigger,
                )
              }
            />
          );
        }

        // The one read-only row that still offers something: §12's upload path
        // is not built, so the control says so rather than doing nothing.
        if (field.key === 'photo' && !field.value) {
          return (
            <Row key={field.key} label={field.label} helper={helper}>
              <Missing>No profile photo added</Missing>
              <ParkedButton parkedKey="photo" small>
                Add profile photo
              </ParkedButton>
            </Row>
          );
        }

        return (
          <Row key={field.key} label={field.label} helper={helper}>
            {field.value ?? <Missing />}
          </Row>
        );
      })}
    </Group>
  );
}

export function Details({ detail, actions }: DetailsProps) {
  const { header, details } = detail;
  const standing = details.standing;
  const canSuspend = header.availableActions.includes('suspend');
  const canRestore = header.availableActions.includes('restore');
  const canBan = header.availableActions.includes('ban');

  return (
    <>
      <SecTitle>Personal information</SecTitle>
      <Fields fields={details.personal} actions={actions} />

      <SecTitle>Business information</SecTitle>
      <Fields fields={details.business} actions={actions} />

      <SecTitle>Account preferences</SecTitle>
      <Fields fields={details.preferences} actions={actions} />

      <hr className="divider" />

      <SecTitle id="sec-access">Access and enforcement</SecTitle>
      <Headline>{standing.value}</Headline>
      {standing.detail ? <p>{standing.detail}</p> : null}
      {standing.owner || standing.startedAt || standing.nextReviewAt ? (
        <Group>
          {standing.owner ? <Row label="Owner">{standing.owner}</Row> : null}
          {standing.startedAt ? <Row label="Review started">{standing.startedAt}</Row> : null}
          {standing.nextReviewAt ? (
            <Row label="Next review">{standing.nextReviewAt}</Row>
          ) : null}
        </Group>
      ) : null}

      {details.ban ? (
        <Group>
          <Row label="Ban trigger">{details.ban.trigger}</Row>
          <Row label="Decided">{details.ban.decidedAt}</Row>
          <Row
            label="What the Founder was told"
            helper="§22.7's ban is permanent. There is no lift, and no control here offers one."
          >
            {details.ban.notice}
          </Row>
        </Group>
      ) : null}

      <Actions>
        {canRestore ? (
          <Button
            tier="primary"
            onClick={(event) => actions.confirm('restore', event.currentTarget)}
          >
            Restore Founder access
          </Button>
        ) : null}
        {canSuspend ? (
          <Button
            tier="secondary"
            onClick={(event) => actions.confirm('suspend', event.currentTarget)}
          >
            Suspend Founder access
          </Button>
        ) : null}
        {canBan ? (
          <Button
            tier="tertiary"
            onClick={(event) => actions.confirm('ban', event.currentTarget)}
          >
            Permanently ban Founder
          </Button>
        ) : null}
      </Actions>

      <SecTitle>Account requests</SecTitle>
      {details.deletionRequest ? (
        <>
          <AttentionBox chip={ATTENTION_CHIP_LABEL}>
            <p>
              <b>Account deletion requested.</b> {details.deletionRequest.detail}
            </p>
            <Button
              tier="secondary"
              onClick={(event) => actions.confirm('deletion', event.currentTarget)}
            >
              Review deletion request
            </Button>
            <Note>{DELETION_RETENTION_NOTE}</Note>
          </AttentionBox>
          <Group>
            <Row label="Asked">{details.deletionRequest.requestedAt}</Row>
            <Row
              label="Reached us through"
              helper="A request with no provenance is one nobody can verify was made."
            >
              {details.deletionRequest.receivedVia}
            </Row>
          </Group>
          {details.deletionRequest.reviews.length > 0 ? (
            <Group>
              {details.deletionRequest.reviews.map((review) => (
                <Row
                  key={`${review.at}-${review.actor}`}
                  label={review.at}
                  helper={`Recorded by ${review.actor}.`}
                >
                  {review.note}
                </Row>
              ))}
            </Group>
          ) : (
            <Note>No review has been recorded against this request yet.</Note>
          )}
        </>
      ) : (
        <p className="grey">
          <b>No deletion request</b>
        </p>
      )}
    </>
  );
}
