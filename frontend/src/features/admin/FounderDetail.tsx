/**
 * One Founder — the record, the campaign, and the invitation.
 * Spec §7, §26.1, §26.2, §33.12.4.
 *
 * ── Preview is the gate, and the gate is visible ────────────────────────────
 * §7: "Preview must show final variables and no unresolved placeholder." Phase
 * 06's trap sharpens it: "an unresolved [VARIABLE] in preview must make Send
 * unavailable." So Send is disabled while the server reports anything
 * unresolved, the unresolved markers are named rather than merely counted, and
 * the reason sits beside the disabled control instead of appearing after a
 * failed attempt. The server re-decides independently — a disabled button is
 * not server-side authorization (§1.1).
 *
 * ── The link is never shown ─────────────────────────────────────────────────
 * §28.1 puts the raw token in the delivered URL and nowhere else, so this
 * surface can say a live link exists, which version it is, and when it
 * expires — never the value. An Admin who needs a working link for a Founder
 * resends one, which rotates and invalidates the old.
 *
 * ── Auto-populated, overrides recorded (§33.12.4) ───────────────────────────
 * Campaign status, the three §21 anchors, the send history, and the retention
 * due date are read from the record and are not re-keyable here. What Admin
 * writes is the invitation content, and every edit records prior and new value,
 * actor, reason, and time server-side.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link as RouterLink, useParams } from 'react-router';
import { Button, Card, Field, Input, StatePanel, Tag, Textarea } from '../../components/index.js';
import {
  fetchFounderDetail,
  fetchInvitationPreview,
  fetchInvitationCopy,
  composeInvitation,
  updateProspect,
  sendInvitation,
  revokeInvitation,
  prefillVetting,
  recordCreatorSignal,
  archiveAndRestart,
  AdminRequestError,
  type FounderDetail as FounderDetailData,
  type InvitationPreview,
  type InvitationCopy,
} from './api.js';
import { When } from './FoundersPage.js';

export function FounderDetail() {
  const { draftId = '' } = useParams();
  const [detail, setDetail] = useState<FounderDetailData | null>(null);
  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [copy, setCopy] = useState<InvitationCopy | null>(null);
  const [loadError, setLoadError] = useState<AdminRequestError | null>(null);

  const load = useCallback(() => {
    Promise.all([
      fetchFounderDetail(draftId),
      fetchInvitationPreview(draftId).catch(() => null),
      fetchInvitationCopy().catch(() => null),
    ])
      .then(([nextDetail, nextPreview, nextCopy]) => {
        setDetail(nextDetail);
        setPreview(nextPreview);
        setCopy(nextCopy);
      })
      .catch((error: unknown) => {
        if (error instanceof AdminRequestError) setLoadError(error);
      });
  }, [draftId]);

  useEffect(load, [load]);

  if (loadError) {
    return (
      <StatePanel
        state={loadError.detail.title}
        whatHappened={loadError.detail.whatHappened ?? 'This Founder could not be read.'}
        next={loadError.detail.next ?? 'Go back to the Founders list.'}
        owner="Proovd"
        nextUpdate="When you go back"
        action={
          <Button tier="secondary" href="/admin/founders">
            Back to Founders
          </Button>
        }
        reference={`Admin · draft ${draftId}`}
        ring
      />
    );
  }

  if (!detail) {
    return (
      <StatePanel
        state="Loading this Founder"
        whatHappened="Proovd is reading the prospect record, the campaign, and the invitation history."
        next="It appears as soon as it arrives. Nothing has been changed."
        owner="Proovd"
        nextUpdate="Within a few seconds"
        action="No action needed"
        reference={`Admin · draft ${draftId}`}
      />
    );
  }

  const anonymised = detail.draft.anonymisedAt !== null;

  return (
    <div className="admin-page">
      <header className="admin-page__head">
        <p className="admin-crumb">
          <RouterLink to="/admin/founders">← Founders</RouterLink>
        </p>
        <h1>{detail.prospect.legalName ?? 'Anonymised prospect'}</h1>
        <p className="admin-page__lede">
          {detail.prospect.productName ?? 'The product record was anonymised.'}
        </p>
      </header>

      {anonymised ? (
        <StatePanel
          state="This draft was anonymised"
          whatHappened={`Nobody claimed it within ${copy?.retentionDays ?? 30} calendar days of the most recent send, so its content was irreversibly removed and the link was revoked.`}
          next="Nothing here can be restored. Create a new prospect if you want to approach them again."
          owner="Proovd"
          nextUpdate="No update is pending"
          action="No action needed"
          reference={detail.draft.campaignId}
        />
      ) : null}

      <InvitationPanel detail={detail} preview={preview} onChanged={load} />

      <VettingPanel detail={detail} onChanged={load} />

      <section className="admin-group" aria-labelledby="prospect-record">
        <h2 className="admin-group__heading" id="prospect-record">
          Prospect record
        </h2>
        <Card>
          <dl className="kv">
            <Row label="Legal name" value={detail.prospect.legalName} />
            <Row label="Preferred name" value={detail.prospect.preferredName} />
            <Row label="Email" value={detail.prospect.email} />
            <Row label="Phone" value={detail.prospect['phone'] as string | null} note="Never verified. Proovd sends no codes to a phone." />
            <Row label="Product" value={detail.prospect.productName} />
            <Row label="Product URL" value={detail.prospect.productUrl} />
            <Row label="Launch frame" value={detail.prospect['launchFrame'] as string | null} />
            <Row label="US and 18+ fit" value={detail.prospect['usAgeFit'] as string | null} />
            <Row label="Delivery feasibility" value={detail.prospect['deliveryFeasibility'] as string | null} />
            <Row label="Compensation expectations" value={detail.prospect['compensationExpectations'] as string | null} />
            <Row label="Creator-sourcing hypothesis" value={detail.prospect['affiliateSourcingHypothesis'] as string | null} />
            <Row label="Invitation source" value={detail.prospect.invitationSource} />
            <Row label="Internal owner" value={detail.prospect.internalOwner} />
            <Row label="Admin notes" value={detail.prospect['adminNotes'] as string | null} />
          </dl>
        </Card>
      </section>

      <CampaignPanel detail={detail} />

      <section className="admin-group" aria-labelledby="send-history">
        <h2 className="admin-group__heading" id="send-history">
          Invitation history
        </h2>
        {detail.sends.length === 0 ? (
          <p>Nothing has been sent yet.</p>
        ) : (
          <div className="admin-table-scroll">
            <table className="admin-table">
              <thead>
                <tr>
                  <th scope="col">Sent</th>
                  <th scope="col">To</th>
                  <th scope="col">By</th>
                  <th scope="col">Link version</th>
                  <th scope="col">Link expires</th>
                  <th scope="col">Delivery</th>
                </tr>
              </thead>
              <tbody>
                {detail.sends.map((send) => (
                  <tr key={send.id}>
                    <th scope="row">
                      <When value={send.sentAt} />
                    </th>
                    <td>{send.recipientEmail ?? 'Anonymised'}</td>
                    <td>{send.sentBy}</td>
                    <td>v{send.tokenVersion}</td>
                    <td>
                      <When value={send.tokenExpiresAt} />
                    </td>
                    <td>
                      {/* The send row is written before the provider is called,
                          so a missing message ID means the attempt was recorded
                          and never confirmed. Saying "—" would let an Admin read
                          it as delivered (§1.4). */}
                      {send.notificationId ? (
                        <>
                          Confirmed
                          <span className="admin-table__sub">{send.notificationId}</span>
                        </>
                      ) : (
                        <>
                          Not confirmed
                          <span className="admin-table__sub">
                            Recorded, but the provider never acknowledged it. Resend.
                          </span>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Row({ label, value, note }: { label: string; value: string | null; note?: string }) {
  return (
    <div className="kv__row">
      <dt>{label}</dt>
      <dd>
        {value ?? <span className="setting__unset">Not recorded</span>}
        {note ? <span className="admin-table__sub">{note}</span> : null}
      </dd>
    </div>
  );
}

/* ── §9 / §10 the vetting record, and the two decisions Admin owns ────────── */

/**
 * §9: "Admin can see the live saved draft, provenance, completeness, last-save
 * time, and errors but does not re-enter Founder data."
 *
 * So the Founder's four answers render read-only, with who supplied each one
 * and when it was last touched. The only writable things here are the two §9
 * and §10 name explicitly: the Problem/Solution *prefill*, and the recorded
 * possible-creator count.
 *
 * ── There is no Competition input, and there is no place to add one ─────────
 * The field renders read-only like the others, and the prefill form beside it
 * has two boxes rather than three. §9 states the rule twice; §33.1.5 tests that
 * no path prefills it. A textarea here would be the first of those paths.
 */
function VettingPanel({
  detail,
  onChanged,
}: {
  detail: FounderDetailData;
  onChanged: () => void;
}) {
  const vetting = detail.vetting;
  const campaign = detail.campaign;

  const [problem, setProblem] = useState(vetting?.provenance.problem.prefilledText ?? '');
  const [solution, setSolution] = useState(vetting?.provenance.solution.prefilledText ?? '');
  const [prefillError, setPrefillError] = useState<string | null>(null);
  const [prefillSaved, setPrefillSaved] = useState<Date | null>(null);

  const [count, setCount] = useState('');
  const [basis, setBasis] = useState('');
  const [signalError, setSignalError] = useState<string | null>(null);

  const [archiveReason, setArchiveReason] = useState('');
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [archiveResult, setArchiveResult] = useState<string | null>(null);

  if (!vetting) return null;

  const submitted = vetting.submittedAt !== null;
  const answered = Object.values(vetting.completeness).filter(Boolean).length;

  async function savePrefill() {
    setPrefillError(null);
    try {
      await prefillVetting(detail.draft.id, { problem, solution });
      setPrefillSaved(new Date());
      onChanged();
    } catch (error) {
      setPrefillError(
        error instanceof AdminRequestError
          ? (error.detail.whatHappened ?? error.detail.title)
          : 'That could not be saved.',
      );
    }
  }

  async function saveSignal() {
    setSignalError(null);
    const parsed = Number(count);
    if (!Number.isInteger(parsed) || parsed < 0) {
      setSignalError('The count must be a whole number of zero or more.');
      return;
    }
    try {
      await recordCreatorSignal(vetting!.campaignId, parsed, basis);
      setCount('');
      setBasis('');
      onChanged();
    } catch (error) {
      setSignalError(
        error instanceof AdminRequestError
          ? (error.detail.whatHappened ?? error.detail.title)
          : 'That was not recorded.',
      );
    }
  }

  async function archive() {
    setArchiveError(null);
    try {
      const result = await archiveAndRestart(vetting!.campaignId, archiveReason);
      setArchiveResult(result.draftId);
      onChanged();
    } catch (error) {
      setArchiveError(
        error instanceof AdminRequestError
          ? (error.detail.whatHappened ?? error.detail.title)
          : 'That record was not archived.',
      );
    }
  }

  return (
    <section className="admin-group" aria-labelledby="vetting-record">
      <h2 className="admin-group__heading" id="vetting-record">
        Vetting
      </h2>

      <Card>
        <dl className="kv">
          <Row
            label="Progress"
            value={`${answered} of 4 answered`}
            note={
              submitted
                ? 'Submitted. The answers and the campaign path are read-only from here.'
                : 'Still being filled in. The Founder can change anything until they submit.'
            }
          />
          <Row
            label="Last saved"
            value={vetting.lastSavedAt ? new Date(vetting.lastSavedAt).toLocaleString() : null}
          />
          <Row
            label="Where they are"
            value={vetting.resumeStep}
            note="The step their link reopens on."
          />
          <Row
            label="Submitted"
            value={vetting.submittedAt ? new Date(vetting.submittedAt).toLocaleString() : null}
          />
        </dl>
      </Card>

      <Card>
        <h3 className="admin-group__subheading">The live saved draft</h3>
        <dl className="kv">
          <div className="kv__row">
            <dt>Campaign path</dt>
            <dd>
              {vetting.selectedType ? (
                <>
                  {/* §3: the customer-facing name, never `pre_build`. */}
                  {vetting.selectedType === 'pre_build' ? 'Idea Campaign' : 'Product Campaign'}
                  {vetting.typeLockedAt ? (
                    <span className="admin-table__sub">
                      Locked {new Date(vetting.typeLockedAt).toLocaleString()}. There is no
                      migration path — a wrong lock is archived and restarted.
                    </span>
                  ) : (
                    <span className="admin-table__sub">Not locked yet.</span>
                  )}
                </>
              ) : (
                <span className="setting__unset">Not chosen</span>
              )}
            </dd>
          </div>
          <Answer label="Problem" text={vetting.problem} provenance={vetting.provenance.problem} />
          <Answer label="Solution" text={vetting.solution} provenance={vetting.provenance.solution} />
          <Answer
            label="Competition"
            text={vetting.competition}
            provenance={vetting.provenance.competition}
            note="Never prefilled by Proovd. This is the Founder's own thinking, which is the whole point of asking (§9)."
          />
        </dl>
      </Card>

      {!submitted ? (
        <Card>
          <h3 className="admin-group__subheading">Prefill from discovery</h3>
          <p className="field-hint">
            §9 has Proovd draft the Problem and the Solution from what we learned; the
            Founder reviews and edits them. Once they have edited a field, this only
            updates our original — their words are never overwritten.
          </p>
          <Field label="Problem" id="prefill-problem">
            <Textarea rows={5} value={problem} onChange={(e) => setProblem(e.target.value)} />
          </Field>
          <Field label="Solution" id="prefill-solution">
            <Textarea rows={5} value={solution} onChange={(e) => setSolution(e.target.value)} />
          </Field>
          {/* No Competition box. §9, §33.1.5. */}
          <p className="field-hint">
            There is no box for Competition here, and there is no route that would accept
            one.
          </p>
          <div className="setting__actions">
            <Button small onClick={() => void savePrefill()}>
              Save prefill
            </Button>
            {prefillSaved ? (
              <span className="setting__status" role="status">
                Saved {prefillSaved.toLocaleTimeString()}
              </span>
            ) : null}
          </div>
          {prefillError ? (
            <p className="field-error" role="alert">
              {prefillError}
            </p>
          ) : null}
        </Card>
      ) : null}

      {submitted ? (
        <Card>
          <h3 className="admin-group__subheading">Possible-creator result (§10)</h3>
          <p className="field-hint">
            The Founder sees this number, and only this number, before they are asked to
            create an account. They never see the basis — that is ours. A zero is a real
            answer and is recorded as one, but it does not render: it holds them at a
            waiting state until someone here looks at the campaign.
          </p>

          {detail.creatorSignal ? (
            <dl className="kv">
              <Row label="Recorded count" value={String(detail.creatorSignal.count)} />
              <Row label="Basis" value={detail.creatorSignal.basis} />
              <Row label="Recorded by" value={detail.creatorSignal.recordedBy} />
              <Row
                label="Recorded at"
                value={new Date(detail.creatorSignal.recordedAt).toLocaleString()}
              />
              <Row
                label="What the Founder sees"
                value={
                  detail.creatorSignal.count > 0
                    ? `The number ${detail.creatorSignal.count}, with §10's disclosures`
                    : 'A waiting state owned by Proovd. The zero is not shown.'
                }
              />
            </dl>
          ) : (
            <p>
              Nothing recorded. The Founder is held at a waiting state and cannot create an
              account until a count is here.
            </p>
          )}

          <Field
            label="Count"
            hint="Creators who may be relevant. A whole number."
            id="signal-count"
          >
            <Input
              type="text"
              inputMode="numeric"
              value={count}
              onChange={(e) => setCount(e.target.value)}
            />
          </Field>
          <Field
            label="What is this based on?"
            hint="Stored with the count and read by whoever audits it. A number with no basis is a guess, and this one reaches a Founder."
            id="signal-basis"
          >
            <Textarea rows={3} value={basis} onChange={(e) => setBasis(e.target.value)} />
          </Field>
          <div className="setting__actions">
            <Button small disabled={count === '' || basis.trim() === ''} onClick={() => void saveSignal()}>
              Record
            </Button>
          </div>
          {signalError ? (
            <p className="field-error" role="alert">
              {signalError}
            </p>
          ) : null}
        </Card>
      ) : null}

      {detail.signupComplete ? (
        <Card>
          <h3 className="admin-group__subheading">Account claim</h3>
          <dl className="kv">
            <Row
              label="Claimed at"
              value={new Date(detail.signupComplete.occurredAt).toLocaleString()}
            />
            <Row label="Founder account" value={detail.signupComplete.founderUserId} />
            <Row
              label="Email ownership"
              value={detail.claimProfile?.emailOwnership ?? null}
              note="How we know the address is theirs. Never a verification claim."
            />
            <Row
              label="Preparing-campaign visibility"
              value="No Creator has been recruited for this campaign yet"
              note="The Affiliate half of §10's handoff arrives with Creator recruitment. Nothing has been revealed to anyone."
            />
          </dl>
        </Card>
      ) : null}

      {/* §9 / §33.1.7 — the wrong-type path. Only reachable once a type is
          actually locked, because before that the Founder can simply change
          their answer and there is nothing to correct. */}
      {campaign?.typeLockedAt && !campaign.listingPaidAt ? (
        <Card>
          <h3 className="admin-group__subheading">Wrong campaign path</h3>
          <p className="field-hint">
            There is no way to convert one kind of campaign into the other, and none may
            be built. Archiving this record starts a fresh vetting record for the same
            person. Nothing carries over — no Creator acceptance, no reward, no payment,
            no consent — and the replacement needs its own invitation sending.
          </p>
          <Field
            label="Why is this being archived?"
            hint="Stored on the record and read by whoever audits it."
            id="archive-reason"
          >
            <Input
              type="text"
              value={archiveReason}
              onChange={(e) => setArchiveReason(e.target.value)}
            />
          </Field>
          <div className="setting__actions">
            <Button
              small
              tier="secondary"
              disabled={archiveReason.trim() === ''}
              onClick={() => void archive()}
            >
              Archive and start a new vetting record
            </Button>
          </div>
          {archiveResult ? (
            <p className="field-hint">
              Archived. The replacement draft is{' '}
              <RouterLink to={`/admin/founders/${archiveResult}`}>{archiveResult}</RouterLink> —
              it has no invitation yet.
            </p>
          ) : null}
          {archiveError ? (
            <p className="field-error" role="alert">
              {archiveError}
            </p>
          ) : null}
        </Card>
      ) : null}

      {detail.vettingEdits.length > 0 ? (
        <details className="admin-explore">
          <summary>Provenance history ({detail.vettingEdits.length})</summary>
          <div className="admin-table-scroll">
            <table className="admin-table">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Field</th>
                  <th scope="col">Supplied by</th>
                  <th scope="col">By</th>
                </tr>
              </thead>
              <tbody>
                {detail.vettingEdits.map((edit, index) => (
                  <tr key={`${edit.occurredAt}-${edit.field}-${index}`}>
                    <th scope="row">
                      <When value={edit.occurredAt} />
                    </th>
                    <td>
                      {edit.record}.{edit.field}
                    </td>
                    <td>
                      <Tag variant={edit.supplier === 'proovd' ? 'mint' : 'moss'}>
                        {edit.supplier === 'proovd' ? 'Proovd' : 'Founder'}
                      </Tag>
                    </td>
                    <td>{edit.editedBy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}
    </section>
  );
}

function Answer({
  label,
  text,
  provenance,
  note,
}: {
  label: string;
  text: string | null;
  provenance: { supplier: 'proovd' | 'founder' | null; lastEditedAt: string | null };
  note?: string;
}) {
  return (
    <div className="kv__row">
      <dt>{label}</dt>
      <dd>
        {text ?? <span className="setting__unset">Nothing written yet</span>}
        <span className="admin-table__sub">
          {provenance.supplier === null
            ? 'No value.'
            : provenance.supplier === 'proovd'
              ? 'Currently our draft — the Founder has not changed it.'
              : 'The Founder wrote this.'}
          {provenance.lastEditedAt
            ? ` Last edited ${new Date(provenance.lastEditedAt).toLocaleString()}.`
            : ''}
          {note ? ` ${note}` : ''}
        </span>
      </dd>
    </div>
  );
}

/* ── §26.2 Campaign detail ────────────────────────────────────────────────── */

function CampaignPanel({ detail }: { detail: FounderDetailData }) {
  const campaign = detail.campaign;
  if (!campaign) return null;

  return (
    <section className="admin-group" aria-labelledby="campaign-detail">
      <h2 className="admin-group__heading" id="campaign-detail">
        Campaign
      </h2>
      <Card>
        <dl className="kv">
          <Row label="Campaign ID" value={campaign.id} />
          <Row
            label="Type"
            value={campaign.type}
            note="Locked at vetting. Guessing it from a discovery call would be a commitment Proovd has not made."
          />
          <Row label="Lifecycle status" value={campaign.status} />
        </dl>

        {/* §23.2: the two tracks are separate columns and are shown separately.
            `review_ready` is derived from them and is never stored as truth. */}
        <h3>Parallel tracks</h3>
        <dl className="kv">
          <Row label="Creator roster" value={campaign.affiliateRosterStatus} />
          <Row label="Campaign build" value={campaign.campaignBuildStatus} />
        </dl>

        {/* §21: the three anchors are dedicated columns and are never inferred
            from created_at or updated_at. Shown as their own block for that
            reason. */}
        <h3>Deadline anchors</h3>
        <dl className="kv">
          <AnchorRow label="Listing paid at" value={campaign.listingPaidAt} />
          <AnchorRow label="Campaign live at" value={campaign.campaignLiveAt} />
          <AnchorRow label="Campaign close at" value={campaign.campaignCloseAt} />
        </dl>
        <p className="admin-note">
          Payment and reconciliation state is not part of the lifecycle status and is
          never shown as one. Those records arrive with the phases that create them.
        </p>
      </Card>
    </section>
  );
}

function AnchorRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="kv__row">
      <dt>{label}</dt>
      <dd>{value ? <When value={value} /> : <span className="setting__unset">Not set yet</span>}</dd>
    </div>
  );
}

/* ── §7's invitation-creation fields ──────────────────────────────────────── */

/**
 * The part of §7's "invitation-creation surface contains" list that describes
 * the prospect rather than the message.
 *
 * It lives here rather than on the create form because §7 separates the two
 * acts: a prospect is written down after a conversation, and the invitation is
 * created later. Two of these are what hold Send closed — the invitation source
 * and the internal campaign owner never reach the Founder, so the marker gate
 * cannot see them and the server checks them by name.
 *
 * A field left blank saves as blank. The gate is at Send, where a missing value
 * actually costs something; refusing the save instead would push an Admin to
 * type a placeholder to get past it, which is a worse record than an honestly
 * incomplete one (§5.3's reasoning, same shape).
 */
function ProspectFieldsPanel({
  detail,
  onChanged,
}: {
  detail: FounderDetailData;
  onChanged: () => void;
}) {
  const prospect = detail.prospect as Record<string, unknown>;
  const text = (key: string) => (typeof prospect[key] === 'string' ? (prospect[key] as string) : '');
  const evidence = Array.isArray(prospect['discoveryEvidence'])
    ? (prospect['discoveryEvidence'] as unknown[]).filter((v): v is string => typeof v === 'string')
    : [];

  const [values, setValues] = useState({
    productName: text('productName'),
    productUrl: text('productUrl'),
    invitationSource: text('invitationSource'),
    internalOwner: text('internalOwner'),
    preferredName: text('preferredName'),
    phone: text('phone'),
    // A date input needs `YYYY-MM-DD`; the record carries a full instant.
    lastContactAt: text('lastContactAt').slice(0, 10),
    launchFrame: text('launchFrame'),
    usAgeFit: text('usAgeFit'),
    deliveryFeasibility: text('deliveryFeasibility'),
    compensationExpectations: text('compensationExpectations'),
    affiliateSourcingHypothesis: text('affiliateSourcingHypothesis'),
    adminNotes: text('adminNotes'),
    discoveryEvidence: evidence.join('\n'),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const set = (key: keyof typeof values) => (event: { target: { value: string } }) =>
    setValues((current) => ({ ...current, [key]: event.target.value }));

  async function save() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await updateProspect(detail.draft.id, {
        ...values,
        lastContactAt: values.lastContactAt || null,
        discoveryEvidence: values.discoveryEvidence
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean),
      });
      setNotice('Saved.');
      onChanged();
    } catch (caught) {
      setError(
        caught instanceof AdminRequestError
          ? [caught.detail.whatHappened, caught.detail.next].filter(Boolean).join(' ')
          : 'That did not save. Nothing has changed.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="admin-form-card">
      <div className="admin-form admin-form--wide">
        <h3>The invitation record</h3>
        <p className="admin-form__note">
          What the invitation is about and where this Founder came from. The product name
          appears in the message itself; the invitation source and the campaign owner do
          not, but Send stays unavailable until both are written down.
        </p>

        <Field label="Product or startup name" hint="Named in the invitation subject and body.">
          <Input value={values.productName} onChange={set('productName')} />
        </Field>
        <Field label="Product URL">
          <Input type="url" value={values.productUrl} onChange={set('productUrl')} />
        </Field>
        <Field label="Invitation source" hint="Where this Founder was found. Stored on the send record.">
          <Input value={values.invitationSource} onChange={set('invitationSource')} />
        </Field>
        <Field label="Internal campaign owner" hint="The named Admin who owns this campaign here.">
          <Input value={values.internalOwner} onChange={set('internalOwner')} />
        </Field>
        <Field label="Preferred name" hint="What the invitation will call them, if not their full name.">
          <Input value={values.preferredName} onChange={set('preferredName')} />
        </Field>
        <Field
          label="Phone, if known"
          hint="Stored so support can call. Proovd never verifies a phone number and never sends codes to one."
        >
          <Input type="tel" value={values.phone} onChange={set('phone')} />
        </Field>
        <Field
          label="Last time we spoke"
          hint="A record of a conversation, not a reminder — nothing follows up on it."
        >
          <Input type="date" value={values.lastContactAt} onChange={set('lastContactAt')} />
        </Field>
        <Field label="Launch frame" hint="Roughly when they are hoping to launch.">
          <Input value={values.launchFrame} onChange={set('launchFrame')} />
        </Field>
        <Field label="US and 18+ fit" hint="What you established, and how.">
          <Input value={values.usAgeFit} onChange={set('usAgeFit')} />
        </Field>
        <Field label="Delivery feasibility">
          <Textarea rows={2} value={values.deliveryFeasibility} onChange={set('deliveryFeasibility')} />
        </Field>
        <Field
          label="Early compensation expectations"
          hint="What they said they expect. Not an agreement, and not a price."
        >
          <Textarea
            rows={2}
            value={values.compensationExpectations}
            onChange={set('compensationExpectations')}
          />
        </Field>
        <Field
          label="Creator-sourcing hypothesis"
          hint="Where you think Creators for this campaign would come from. A hypothesis, never a commitment that a named Creator will take it on."
        >
          <Textarea
            rows={2}
            value={values.affiliateSourcingHypothesis}
            onChange={set('affiliateSourcingHypothesis')}
          />
        </Field>
        <Field label="Admin notes">
          <Textarea rows={3} value={values.adminNotes} onChange={set('adminNotes')} />
        </Field>
        <Field label="Discovery evidence" hint="One link per line.">
          <Textarea rows={2} value={values.discoveryEvidence} onChange={set('discoveryEvidence')} />
        </Field>

        {error ? (
          <p className="field-error" role="alert">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className="admin-note" role="status">
            {notice}
          </p>
        ) : null}

        <Button tier="secondary" disabled={busy} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save invitation record'}
        </Button>
      </div>
    </Card>
  );
}

/* ── §7 the invitation: compose, preview, send, resend, revoke ────────────── */

function InvitationPanel({
  detail,
  preview,
  onChanged,
}: {
  detail: FounderDetailData;
  preview: InvitationPreview | null;
  onChanged: () => void;
}) {
  const [draft, setDraft] = useState({
    whatWeUnderstood: detail.draft.whatWeUnderstood ?? '',
    whyInvited: detail.draft.whyInvited ?? '',
    senderName: detail.draft.senderName ?? '',
    senderEmail: detail.draft.senderEmail ?? '',
    expectedSetupTime: detail.draft.expectedSetupTime ?? '',
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [revokeReason, setRevokeReason] = useState('');
  const [showPreview, setShowPreview] = useState(false);

  const anonymised = detail.draft.anonymisedAt !== null;
  const claimed = detail.draft.status === 'claimed';
  const blocked = preview?.blocked ?? true;
  const disabled = anonymised || claimed;

  const set = (key: keyof typeof draft) => (event: { target: { value: string } }) =>
    setDraft((current) => ({ ...current, [key]: event.target.value }));

  async function run(label: string, action: () => Promise<unknown>, success: string) {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(success);
      onChanged();
    } catch (caught) {
      setError(
        caught instanceof AdminRequestError
          ? [caught.detail.whatHappened, caught.detail.next].filter(Boolean).join(' ')
          : 'That did not go through. Nothing has changed.',
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="admin-group" aria-labelledby="invitation">
      <h2 className="admin-group__heading" id="invitation">
        Invitation
      </h2>

      <Card className="invitation">
        <p className="invitation__state">
          {detail.hasLiveToken ? (
            <Tag variant="live">A link is live</Tag>
          ) : (
            <Tag variant="sage">No live link</Tag>
          )}
          {detail.lastSentAt ? (
            <span>
              Last sent <When value={detail.lastSentAt} />
            </span>
          ) : (
            <span>Never sent</span>
          )}
        </p>
        {detail.retentionDueAt && !anonymised ? (
          <p className="admin-note">
            If nobody claims it, this draft is anonymised on{' '}
            <When value={detail.retentionDueAt} />. Resending restarts that window.
          </p>
        ) : null}
        <p className="admin-note">
          The link itself is never shown here. It exists only in the email that was
          delivered — resend to give the Founder a working one, which replaces the old.
        </p>
      </Card>

      {!disabled ? <ProspectFieldsPanel detail={detail} onChanged={onChanged} /> : null}

      {!disabled ? (
        <Card className="admin-form-card">
          <div className="admin-form admin-form--wide">
            <Field label="What Proovd understood about the product">
              <Textarea rows={3} value={draft.whatWeUnderstood} onChange={set('whatWeUnderstood')} />
            </Field>
            <Field label="Why this Founder was invited">
              <Textarea rows={3} value={draft.whyInvited} onChange={set('whyInvited')} />
            </Field>
            <Field label="Named Proovd sender">
              <Input value={draft.senderName} onChange={set('senderName')} />
            </Field>
            <Field label="Reply address" hint="Replies to the invitation come here.">
              <Input type="email" value={draft.senderEmail} onChange={set('senderEmail')} />
            </Field>
            <Field
              label="Honest setup-time expectation"
              hint="What it actually takes. An optimistic number here is a broken promise later."
            >
              <Input value={draft.expectedSetupTime} onChange={set('expectedSetupTime')} />
            </Field>

            <Button
              tier="secondary"
              disabled={busy !== null}
              onClick={() =>
                void run('compose', () => composeInvitation(detail.draft.id, draft), 'Saved.')
              }
            >
              {busy === 'compose' ? 'Saving…' : 'Save invitation content'}
            </Button>
          </div>
        </Card>
      ) : null}

      {preview ? (
        <Card className="invitation__preview">
          <h3>Preview</h3>
          <p className="admin-note">
            The exact message, with final variables. The link shown is a placeholder — the
            real one-time link is generated when you send.
          </p>

          {blocked ? (
            <div className="invitation__gate">
              <p className="invitation__gate-head">Send is unavailable</p>
              <p>
                {preview.unresolved.length > 0
                  ? 'A Founder must never receive a placeholder. Fill these in:'
                  : preview.missingFields.length > 0
                    ? // Not in the message, so the marker list above cannot
                      // report them — but §7 requires both before an invitation
                      // goes out, and the send row stores the source.
                      'The invitation record is incomplete. Fill these in above:'
                    : 'This prospect has no email address to send to.'}
              </p>
              {preview.unresolved.length > 0 ? (
                <ul className="invitation__unresolved">
                  {preview.unresolved.map((marker) => (
                    <li key={marker}>
                      <code>{marker}</code>
                    </li>
                  ))}
                </ul>
              ) : preview.missingFields.length > 0 ? (
                <ul className="invitation__unresolved">
                  {preview.missingFields.map((field) => (
                    <li key={field}>{field}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          <p className="invitation__subject">
            <strong>Subject:</strong> {preview.subject}
          </p>
          <pre className="invitation__text">{preview.text}</pre>
        </Card>
      ) : null}

      {!disabled ? (
        <div className="invitation__actions">
          <Button
            disabled={blocked || busy !== null}
            onClick={() =>
              void run(
                'send',
                () => sendInvitation(detail.draft.id),
                detail.hasLiveToken
                  ? 'Resent. The previous link no longer works and the 30-day window restarted.'
                  : 'Sent.',
              )
            }
          >
            {busy === 'send'
              ? 'Sending…'
              : detail.hasLiveToken
                ? 'Resend invitation'
                : 'Send invitation'}
          </Button>

          <Button
            tier="tertiary"
            aria-expanded={showPreview}
            onClick={() => setShowPreview((was) => !was)}
          >
            {showPreview ? 'Hide rendered email' : 'View rendered email'}
          </Button>

          {detail.hasLiveToken ? (
            <Button
              tier="tertiary"
              aria-expanded={revoking}
              onClick={() => setRevoking((was) => !was)}
            >
              {revoking ? 'Cancel' : 'Revoke link'}
            </Button>
          ) : null}
        </div>
      ) : null}

      {showPreview && preview ? (
        <Card>
          {/* The rendered HTML, in an iframe with no scripts and no same-origin
              access. It is Proovd's own template, but rendering arbitrary HTML
              inline into the Admin document is a habit worth not forming. */}
          <iframe
            className="invitation__frame"
            title="Rendered invitation email"
            sandbox=""
            srcDoc={preview.html}
          />
        </Card>
      ) : null}

      {revoking ? (
        <Card className="admin-form-card">
          <div className="admin-form">
            <Field
              label="Why is this being revoked?"
              hint="Stored with the revocation. The Founder's link stops working immediately."
            >
              <Input value={revokeReason} onChange={(e) => setRevokeReason(e.target.value)} />
            </Field>
            <Button
              tier="secondary"
              disabled={revokeReason.trim().length === 0 || busy !== null}
              onClick={() =>
                void run(
                  'revoke',
                  () => revokeInvitation(detail.draft.id, revokeReason),
                  'Revoked. The link no longer works.',
                ).then(() => {
                  setRevoking(false);
                  setRevokeReason('');
                })
              }
            >
              {busy === 'revoke' ? 'Revoking…' : 'Revoke the link'}
            </Button>
          </div>
        </Card>
      ) : null}

      {notice ? (
        <p className="invitation__notice" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
