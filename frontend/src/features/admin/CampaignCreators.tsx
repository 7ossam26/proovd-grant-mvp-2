/**
 * Admin — the campaign Creator roster, recruitment, and the private invitation.
 * Spec §8, §5.3, §25.4, §26, DNA §5.14.
 *
 * ── Glance → Act → Explore (DNA §5.14) ──────────────────────────────────────
 * Glance is the roster table: who is recruited, what state each is in, whether
 * a link is live. Act is the recruit form and the invitation controls. Explore
 * is the per-Creator detail, behind one control — the §8 record is nineteen
 * facts and dumping all of them into a list is the wall §5.14 forbids.
 *
 * ── The evidence inputs come from the subtype ───────────────────────────────
 * §5.3 gives each of the seven channel subtypes its own required evidence, so
 * the form asks for those and says why each one is needed. The register is
 * imported from `@proovd/shared` rather than fetched: labels and help text live
 * in one place, and this bundle can reach that place directly.
 *
 * ── What this surface will not let an Admin do ──────────────────────────────
 * Set a rate. §8 makes the internal quality tier assessment data and forbids it
 * acting as a commission floor, so the field is a note with no scale and the
 * server refuses a bare number. There is no percentage input on this page,
 * because §12 owns compensation and it arrives in Phase 12.
 *
 * Send a placeholder. §8's gate is the server's answer, read from the preview.
 * The Send control is disabled on it — and the send route re-decides
 * independently, because a disabled button is not authorization (§1.1).
 *
 * See a link. §28.1 puts the raw token in the delivered URL and nowhere else.
 * Admin sees that a live link exists, its version, and when it expires.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import {
  AFFILIATE_SUBTYPE_DEFINITIONS,
  affiliateSubtype,
  type AffiliateSubtype,
} from '@proovd/shared';
import { Button, Card, Input, StatePanel, Tag, Textarea } from '../../components/index.js';
import {
  fetchAffiliateRegistry,
  fetchCampaignAffiliates,
  fetchAffiliateDetail,
  fetchAffiliateInvitationPreview,
  recruitAffiliate,
  composeAffiliateInvitation,
  sendAffiliateInvitation,
  revokeAffiliateInvitation,
  recordAffiliateVerification,
  AdminRequestError,
  type AffiliateRegistry,
  type AffiliateRosterRow,
  type AffiliateDetail,
  type AffiliateInvitationPreview,
} from './api.js';

/* ── Vocabulary (§3) ───────────────────────────────────────────────────────
   `Creator` everywhere a person can read it. The internal word appears in this
   file only inside route paths and API field names, which no one reads. */

const INVITATION_LABEL: Record<string, string> = {
  draft: 'Not invited yet',
  sent: 'Invited',
  revoked: 'Link revoked',
  claimed: 'Account created',
  expired: 'Link expired',
};

const VERIFICATION_LABEL: Record<string, string> = {
  unverified: 'Not verified',
  in_review: 'In review',
  verified: 'Verified',
  rejected: 'Rejected',
};

function when(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return `${date.toLocaleString()} (${date.toISOString().slice(0, 16).replace('T', ' ')} UTC)`;
}

export function CampaignCreators() {
  const [params, setParams] = useSearchParams();
  const campaignId = params.get('campaignId') ?? '';

  const [registry, setRegistry] = useState<AffiliateRegistry | null>(null);
  const [rows, setRows] = useState<AffiliateRosterRow[] | null>(null);
  const [error, setError] = useState<AdminRequestError | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!campaignId) {
      setRows(null);
      return;
    }
    try {
      const [reg, roster] = await Promise.all([
        registry ? Promise.resolve(registry) : fetchAffiliateRegistry(),
        fetchCampaignAffiliates(campaignId),
      ]);
      setRegistry(reg);
      setRows(roster.affiliates);
      setError(null);
    } catch (caught) {
      if (caught instanceof AdminRequestError) setError(caught);
    }
  }, [campaignId, registry]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <section className="admin-page">
        <StatePanel
          state={error.detail.title}
          whatHappened={error.detail.whatHappened ?? 'The roster could not be loaded.'}
          next={error.detail.next ?? 'Reload the page.'}
          owner="Proovd"
          nextUpdate="When you reload"
          action={<Button tier="secondary" onClick={() => void load()}>Try again</Button>}
          reference="Campaign Creators"
          ring
        />
      </section>
    );
  }

  return (
    <section className="admin-page">
      <header className="admin-page__head">
        <h1>Campaign Creators</h1>
        <p className="admin-page__lede">
          Creators are recruited for one campaign at a time and join by private invitation.
          There is no open signup, and recruiting someone starts no clock and commits nobody
          — the formal opportunity opens only after the listing fee is paid.
        </p>
      </header>

      <Card>
        <label className="field">
          <span className="field-label">Campaign</span>
          <Input
            value={campaignId}
            placeholder="Campaign id"
            onChange={(event) =>
              setParams(event.target.value ? { campaignId: event.target.value } : {})
            }
          />
          <span className="field-hint">
            Open a campaign from Founders to see and recruit its Creators.
          </span>
        </label>
      </Card>

      {!campaignId ? (
        <StatePanel
          state="No campaign selected"
          whatHappened="Creator recruitment is always scoped to one campaign."
          next="Paste a campaign id above, or open one from the Founders list."
          owner="You"
          nextUpdate="As soon as you pick one"
          action="No action needed"
          reference="Campaign Creators"
        />
      ) : rows === null ? (
        <StatePanel
          state="Loading the roster"
          whatHappened="Proovd is reading the Creators recruited for this campaign."
          next="The list appears as soon as it comes back."
          owner="Proovd"
          nextUpdate="Within a few seconds"
          action="No action needed"
          reference={campaignId}
        />
      ) : (
        <>
          <Roster rows={rows} openId={openId} onOpen={setOpenId} />
          {openId ? (
            <CreatorDetail associationId={openId} onChanged={() => void load()} />
          ) : null}
          <RecruitForm campaignId={campaignId} onRecruited={() => void load()} />
        </>
      )}
    </section>
  );
}

/* ── Glance: the roster ───────────────────────────────────────────────────── */

function Roster({
  rows,
  openId,
  onOpen,
}: {
  rows: AffiliateRosterRow[];
  openId: string | null;
  onOpen: (id: string | null) => void;
}) {
  if (rows.length === 0) {
    return (
      <StatePanel
        state="No Creators recruited yet"
        whatHappened="Nobody has been recruited for this campaign."
        next="Record the first Creator below. Nothing is sent until you preview and send the invitation."
        owner="You"
        nextUpdate="When you recruit someone"
        action="No action needed"
        reference="Campaign roster"
      />
    );
  }

  return (
    <div className="admin-table-scroll">
      <table className="admin-table">
        <caption className="admin-table__caption">
          Creators recruited for this campaign, newest first.
        </caption>
        <thead>
          <tr>
            <th scope="col">Creator</th>
            <th scope="col">Channel</th>
            <th scope="col">Verification</th>
            <th scope="col">Invitation</th>
            <th scope="col">Last sent</th>
            <th scope="col">Roster</th>
            <th scope="col">
              <span className="pv-sr">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.associationId}>
              <th scope="row">
                {row.publicHandle}
                <span className="admin-table__sub">{row.email}</span>
              </th>
              <td>
                {row.subtype ? affiliateSubtype(row.subtype as AffiliateSubtype).label : '—'}
              </td>
              <td>
                <Tag variant={row.verificationStatus === 'verified' ? 'mint' : 'default'}>
                  {VERIFICATION_LABEL[row.verificationStatus] ?? row.verificationStatus}
                </Tag>
              </td>
              <td>
                <Tag variant={row.invitationStatus === 'sent' ? 'mint' : 'default'}>
                  {INVITATION_LABEL[row.invitationStatus] ?? row.invitationStatus}
                </Tag>
              </td>
              <td>{when(row.lastSentAt)}</td>
              <td>
                {row.rosterMembership === 'initial_roster' ? 'Initial roster' : 'Mid-campaign'}
              </td>
              <td>
                <Button
                  tier="tertiary"
                  small
                  onClick={() => onOpen(openId === row.associationId ? null : row.associationId)}
                >
                  {openId === row.associationId ? 'Close' : 'Open'}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Explore + Act: one Creator ───────────────────────────────────────────── */

function CreatorDetail({
  associationId,
  onChanged,
}: {
  associationId: string;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<AffiliateDetail | null>(null);
  const [preview, setPreview] = useState<AffiliateInvitationPreview | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<AdminRequestError | null>(null);

  const load = useCallback(async () => {
    try {
      const [next, nextPreview] = await Promise.all([
        fetchAffiliateDetail(associationId),
        fetchAffiliateInvitationPreview(associationId),
      ]);
      setDetail(next);
      setPreview(nextPreview);
      setFailure(null);
    } catch (caught) {
      if (caught instanceof AdminRequestError) setFailure(caught);
    }
  }, [associationId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (failure) {
    return (
      <StatePanel
        state={failure.detail.title}
        whatHappened={failure.detail.whatHappened ?? 'This record could not be loaded.'}
        next={failure.detail.next ?? 'Try again.'}
        owner="Proovd"
        nextUpdate="When you retry"
        action={<Button tier="secondary" onClick={() => void load()}>Try again</Button>}
        reference={associationId}
        ring
      />
    );
  }

  if (!detail) return null;

  const subtype = detail.prospect.subtype as AffiliateSubtype | null;
  const definition = subtype ? affiliateSubtype(subtype) : null;

  return (
    <Card>
      <h2 className="admin-group__heading">{detail.prospect.publicHandle}</h2>

      {/* §2.2 — recruiting is legitimate at three, but not unknowingly. */}
      {detail.slots.atLimit ? (
        <div className="admin-alert">
          <p className="admin-alert__head">
            This Creator already holds {detail.slots.used} of {detail.slots.limit} active
            partnerships.
          </p>
          <p>
            They can still be recruited and invited — a slot only starts when their tracking
            link is activated. But they cannot take on a fourth active campaign, so plan the
            roster accordingly.
          </p>
        </div>
      ) : null}

      <dl className="kv">
        <Row label="Legal name">{detail.prospect.legalName}</Row>
        <Row label="Email">{detail.prospect.email}</Row>
        <Row label="Phone">
          {detail.prospect.phone ?? '—'}
          <span className="admin-table__sub">Collected, never verified.</span>
        </Row>
        <Row label="Channel">{definition?.label ?? '—'}</Row>
        <Row label="Channel reference">{detail.prospect.channelReference}</Row>
        <Row label="Audience niche">{detail.prospect.audienceNiche}</Row>
        <Row label="Campaign fit">{detail.prospect.campaignFit}</Row>
        <Row label="Audience size">{detail.prospect.audienceSize ?? '—'}</Row>
        <Row label="Permission basis">{detail.prospect.permissionBasis}</Row>
        <Row label="Admin bio">{detail.prospect.adminBio}</Row>
        <Row label="Internal quality tier">
          {detail.prospect.qualityTier ?? '—'}
          <span className="admin-table__sub">
            Assessment data only. It never sets a rate or a floor.
          </span>
        </Row>
        <Row label="Recruited by">
          {detail.association.recruitingAdmin} · {detail.association.recruitmentSource}
          <span className="admin-table__sub">{when(detail.association.recruitedAt)}</span>
        </Row>
        <Row label="Association state">{detail.association.status}</Row>
        <Row label="Active partnership slots">
          {detail.slots.used} of {detail.slots.limit} used
        </Row>
      </dl>

      <Verification
        detail={detail}
        onRecorded={() => {
          void load();
          onChanged();
        }}
        onNotice={setNotice}
      />

      <InvitationPanel
        detail={detail}
        preview={preview}
        onChanged={() => {
          void load();
          onChanged();
        }}
        onNotice={setNotice}
      />

      {notice ? <p className="admin-note">{notice}</p> : null}
    </Card>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="kv__row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/* ── Verification (§8, §5.3) ──────────────────────────────────────────────── */

function Verification({
  detail,
  onRecorded,
  onNotice,
}: {
  detail: AffiliateDetail;
  onRecorded: () => void;
  onNotice: (message: string | null) => void;
}) {
  const subtype = detail.prospect.subtype as AffiliateSubtype | null;
  const definition = subtype ? affiliateSubtype(subtype) : null;
  const [evidence, setEvidence] = useState<Record<string, string>>(
    () => detail.prospect.verificationEvidence ?? {},
  );
  const [verifiedBy, setVerifiedBy] = useState('');
  const [busy, setBusy] = useState(false);

  if (!definition) return null;

  const record = async (status: string) => {
    setBusy(true);
    onNotice(null);
    try {
      await recordAffiliateVerification(detail.association.id, {
        status,
        verifiedBy,
        evidence,
      });
      onNotice(`Verification recorded as ${VERIFICATION_LABEL[status] ?? status}.`);
      onRecorded();
    } catch (caught) {
      if (caught instanceof AdminRequestError) {
        onNotice(`${caught.detail.whatHappened ?? caught.detail.title} ${caught.detail.next ?? ''}`);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <details className="admin-explore">
      <summary>Verification — what §5.3 asks for a {definition.label.toLowerCase()}</summary>
      <div className="admin-form">
        <p className="admin-form__note">
          Current status: {VERIFICATION_LABEL[detail.prospect.verificationStatus]}
          {detail.prospect.verifiedBy ? ` · recorded by ${detail.prospect.verifiedBy}` : ''}
        </p>

        {definition.evidence.map((input) => (
          <label className="field" key={input.id}>
            <span className="field-label">
              {input.label}
              {input.conditional ? ' (where appropriate)' : ''}
            </span>
            <Input
              value={evidence[input.id] ?? ''}
              onChange={(event) =>
                setEvidence((current) => ({ ...current, [input.id]: event.target.value }))
              }
            />
            <span className="field-hint">{input.basis}</span>
          </label>
        ))}

        <label className="field">
          <span className="field-label">Who carried out the verification</span>
          <Input value={verifiedBy} onChange={(event) => setVerifiedBy(event.target.value)} />
          <span className="field-hint">
            A named person. It is stored with the record and cannot be edited afterwards.
          </span>
        </label>

        {detail.missingEvidence.length > 0 ? (
          <p className="admin-form__note">
            Still missing before this can be recorded as verified:{' '}
            {detail.missingEvidence.join(', ')}.
          </p>
        ) : null}

        <div className="claim__actions">
          <Button tier="secondary" disabled={busy || !verifiedBy} onClick={() => void record('in_review')}>
            Record as in review
          </Button>
          <Button
            tier="primary"
            disabled={busy || !verifiedBy || detail.missingEvidence.length > 0}
            onClick={() => void record('verified')}
          >
            Record as verified
          </Button>
          <Button tier="tertiary" disabled={busy || !verifiedBy} onClick={() => void record('rejected')}>
            Record as rejected
          </Button>
        </div>
      </div>
    </details>
  );
}

/* ── The invitation (§8) ──────────────────────────────────────────────────── */

function InvitationPanel({
  detail,
  preview,
  onChanged,
  onNotice,
}: {
  detail: AffiliateDetail;
  preview: AffiliateInvitationPreview | null;
  onChanged: () => void;
  onNotice: (message: string | null) => void;
}) {
  const invitation = detail.invitation;
  const [form, setForm] = useState({
    whyRecruited: invitation?.whyRecruited ?? '',
    reviewedPresence: invitation?.reviewedPresence ?? '',
    senderName: invitation?.senderName ?? '',
    senderEmail: invitation?.senderEmail ?? '',
  });
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const composed = useRef(false);

  useEffect(() => {
    if (composed.current) return;
    setForm({
      whyRecruited: invitation?.whyRecruited ?? '',
      reviewedPresence: invitation?.reviewedPresence ?? '',
      senderName: invitation?.senderName ?? '',
      senderEmail: invitation?.senderEmail ?? '',
    });
  }, [invitation]);

  const run = async (work: () => Promise<string>) => {
    setBusy(true);
    onNotice(null);
    try {
      onNotice(await work());
      onChanged();
    } catch (caught) {
      if (caught instanceof AdminRequestError) {
        const unresolved = (caught.detail as { unresolved?: string[] }).unresolved;
        onNotice(
          [
            caught.detail.whatHappened ?? caught.detail.title,
            caught.detail.next,
            unresolved?.length ? `Still unwritten: ${unresolved.join(', ')}` : null,
          ]
            .filter(Boolean)
            .join(' '),
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const alreadyClaimed = detail.association.invitationStatus === 'claimed';

  return (
    <details className="admin-explore">
      <summary>The invitation</summary>
      <div className="admin-form">
        {/* §8 item 1 — the email names the Founder and the product. Read-only:
            both come from the Founder record, and re-keying them here would be
            the §33.12.4 failure. */}
        <p className="admin-form__note">
          This invitation names {invitation?.founderName ?? '[no Founder recorded yet]'} and{' '}
          {invitation?.productName ?? '[no product recorded yet]'}, from the campaign record.
        </p>

        <label className="field">
          <span className="field-label">Why this Creator, and this channel</span>
          <Textarea
            rows={3}
            value={form.whyRecruited}
            onChange={(event) => {
              composed.current = true;
              setForm((current) => ({ ...current, whyRecruited: event.target.value }));
            }}
          />
          <span className="field-hint">
            §8 requires the email to say this. Specific beats flattering — it is the
            difference between a recruitment and a mailshot.
          </span>
        </label>

        <label className="field">
          <span className="field-label">Which public presence Proovd reviewed</span>
          <Textarea
            rows={2}
            value={form.reviewedPresence}
            onChange={(event) => {
              composed.current = true;
              setForm((current) => ({ ...current, reviewedPresence: event.target.value }));
            }}
          />
          <span className="field-hint">
            Defaults to the channel reference on the record. Name the posts or episodes if
            it helps them recognise themselves.
          </span>
        </label>

        <label className="field">
          <span className="field-label">Sender name</span>
          <Input
            value={form.senderName}
            onChange={(event) => {
              composed.current = true;
              setForm((current) => ({ ...current, senderName: event.target.value }));
            }}
          />
        </label>

        <label className="field">
          <span className="field-label">Reply-to address</span>
          <Input
            value={form.senderEmail}
            onChange={(event) => {
              composed.current = true;
              setForm((current) => ({ ...current, senderEmail: event.target.value }));
            }}
          />
        </label>

        <Button
          tier="secondary"
          disabled={busy || alreadyClaimed}
          onClick={() =>
            void run(async () => {
              await composeAffiliateInvitation(detail.association.id, form);
              return 'Saved.';
            })
          }
        >
          Save the invitation
        </Button>

        {/* §8's two fixed promises, read-only. There is no route that edits
            them: an editable promise is one that acquires a condition. */}
        <FixedCopy />

        {preview ? (
          <section className="admin-form">
            <h3 className="admin-group__subheading">Preview</h3>
            <p className="admin-form__note">Subject: {preview.subject}</p>
            <pre className="admin-note">{preview.text}</pre>
            {preview.unresolved.length > 0 ? (
              <div className="admin-alert">
                <p className="admin-alert__head">This is not ready to send.</p>
                <ul className="admin-alert__list">
                  {preview.unresolved.map((marker) => (
                    <li key={marker}>{marker}</li>
                  ))}
                </ul>
                <p>A Creator must never receive a placeholder.</p>
              </div>
            ) : null}
            <p className="field-hint">
              The link in the real email is unique and unrecoverable — it exists only in the
              message that was delivered. This preview shows {preview.claimUrlShape}.
            </p>
          </section>
        ) : null}

        <div className="claim__actions">
          <Button
            tier="primary"
            disabled={busy || alreadyClaimed || (preview?.blocked ?? true)}
            onClick={() =>
              void run(async () => {
                const result = await sendAffiliateInvitation(detail.association.id);
                return result.resent
                  ? `Resent. The previous link is now invalid; this is version ${result.tokenVersion}.`
                  : 'Sent.';
              })
            }
          >
            {invitation?.hasLiveToken ? 'Resend the invitation' : 'Send the invitation'}
          </Button>
        </div>

        {invitation?.hasLiveToken ? (
          <div className="admin-form">
            <label className="field">
              <span className="field-label">Reason for revoking</span>
              <Input value={reason} onChange={(event) => setReason(event.target.value)} />
              <span className="field-hint">Stored with the record. Required.</span>
            </label>
            <Button
              tier="tertiary"
              disabled={busy || !reason.trim()}
              onClick={() =>
                void run(async () => {
                  const result = await revokeAffiliateInvitation(detail.association.id, reason);
                  setReason('');
                  return `Revoked ${result.revoked} live link. The recruitment record is unchanged.`;
                })
              }
            >
              Revoke the link
            </Button>
          </div>
        ) : null}

        {invitation && invitation.sends.length > 0 ? (
          <details className="admin-explore">
            <summary>Invitation history ({invitation.sends.length})</summary>
            <div className="admin-table-scroll">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th scope="col">Sent</th>
                    <th scope="col">To</th>
                    <th scope="col">Version</th>
                    <th scope="col">Delivery</th>
                    <th scope="col">By</th>
                  </tr>
                </thead>
                <tbody>
                  {invitation.sends.map((send) => (
                    <tr key={send.id}>
                      <td>{when(send.sentAt)}</td>
                      <td>{send.recipientEmail}</td>
                      <td>v{send.tokenVersion}</td>
                      <td>
                        {/* §1.4: an unconfirmed send is not a delivered one. */}
                        {send.deliveryConfirmed ? 'Confirmed' : 'Recorded, not confirmed'}
                      </td>
                      <td>{send.sentBy}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        ) : null}
      </div>
    </details>
  );
}

function FixedCopy() {
  const [copy, setCopy] = useState<AffiliateRegistry['fixedCopy'] | null>(null);

  useEffect(() => {
    void fetchAffiliateRegistry().then((registry) => setCopy(registry.fixedCopy));
  }, []);

  if (!copy) return null;

  return (
    <details className="admin-explore">
      <summary>What every invitation says, that you cannot change</summary>
      <div className="admin-form">
        <p className="admin-form__note">
          §8 requires these. They are fixed template text — there is no route that edits
          them, because a promise an Admin can soften is not a promise.
        </p>
        <p className="admin-note">{copy.preparingNotice}</p>
        <p className="admin-note">{copy.declineNotice}</p>
        <p className="admin-note">{copy.neverAsksNotice}</p>
      </div>
    </details>
  );
}

/* ── Act: recruiting (§8) ─────────────────────────────────────────────────── */

const EMPTY = {
  legalName: '',
  publicHandle: '',
  email: '',
  phone: '',
  subtype: '' as '' | AffiliateSubtype,
  channelReference: '',
  audienceNiche: '',
  campaignFit: '',
  audienceSize: '',
  audienceDemographics: '',
  permissionBasis: '',
  priorSponsoredContent: '',
  adminBio: '',
  qualityTier: '',
  conflictNotes: '',
  sanctionsNotes: '',
  internalComments: '',
  recruitmentSource: '',
  recruitingAdmin: '',
  rosterIntent: 'initial_roster' as 'initial_roster' | 'mid_campaign',
};

function RecruitForm({
  campaignId,
  onRecruited,
}: {
  campaignId: string;
  onRecruited: () => void;
}) {
  const [form, setForm] = useState(EMPTY);
  const [evidence, setEvidence] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const definition = useMemo(
    () => (form.subtype ? affiliateSubtype(form.subtype) : null),
    [form.subtype],
  );

  const set = (key: keyof typeof EMPTY) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  const submit = async () => {
    setBusy(true);
    setNotice(null);
    try {
      await recruitAffiliate({
        ...form,
        subtype: form.subtype as string,
        campaignId,
        engagementEvidence: evidence,
      });
      setForm(EMPTY);
      setEvidence({});
      setNotice('Recorded. Nothing has been sent — compose and preview the invitation first.');
      onRecruited();
    } catch (caught) {
      if (caught instanceof AdminRequestError) {
        setNotice(`${caught.detail.whatHappened ?? caught.detail.title} ${caught.detail.next ?? ''}`);
      }
    } finally {
      setBusy(false);
    }
  };

  const ready =
    form.legalName &&
    form.publicHandle &&
    form.email &&
    form.subtype &&
    form.channelReference &&
    form.audienceNiche &&
    form.campaignFit &&
    form.permissionBasis &&
    form.adminBio &&
    form.recruitmentSource &&
    form.recruitingAdmin;

  return (
    <Card>
      <h2 className="admin-group__heading">Recruit a Creator</h2>
      <p className="admin-page__lede">
        Recruiting records who Proovd found and why. It sends nothing and starts no clock.
      </p>

      <div className="admin-form admin-form--wide">
        <Text label="Full legal name" value={form.legalName} onChange={set('legalName')}
          hint="The person who must personally claim the account. An agency or manager cannot accept for them." />
        <Text label="Public name or handle" value={form.publicHandle} onChange={set('publicHandle')}
          hint="What their audience knows them as. This is the only name the Founder sees." />
        <Text label="Email" value={form.email} onChange={set('email')} type="email"
          hint="Where the private invitation goes." />
        <Text label="Phone" value={form.phone} onChange={set('phone')}
          hint="Optional. Collected for support, never verified." />

        <label className="field">
          <span className="field-label">Channel subtype</span>
          <select
            className="input"
            value={form.subtype}
            onChange={(event) => {
              setForm((current) => ({
                ...current,
                subtype: event.target.value as AffiliateSubtype,
              }));
              setEvidence({});
            }}
          >
            <option value="">Choose one</option>
            {AFFILIATE_SUBTYPE_DEFINITIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          <span className="field-hint">
            It decides which verification evidence this Creator needs.
          </span>
        </label>

        <Text label="Primary URL or channel reference" value={form.channelReference}
          onChange={set('channelReference')} hint="The public presence Proovd reviewed." />
        <Text label="Audience niche" value={form.audienceNiche} onChange={set('audienceNiche')} />
        <Text label="Why this campaign fits" value={form.campaignFit} onChange={set('campaignFit')}
          hint="The reasoning behind the recruitment. The Founder never sees a matching score." />
        <Text label="Audience size or access metric" value={form.audienceSize}
          onChange={set('audienceSize')} hint="In the unit their channel measures in." />
        <Text label="Audience demographics" value={form.audienceDemographics}
          onChange={set('audienceDemographics')} hint="Where available." />
        <Text label="Permission or ownership basis" value={form.permissionBasis}
          onChange={set('permissionBasis')}
          hint="Whether they are entitled to promote on this channel at all." />
        <Text label="Prior sponsored content" value={form.priorSponsoredContent}
          onChange={set('priorSponsoredContent')} hint="Where relevant, with compliance evidence." />
        <Text label="Admin-written bio" value={form.adminBio} onChange={set('adminBio')}
          hint="Prefills their signup and the Founder-facing card. They can correct it." />

        <Text label="Internal quality tier" value={form.qualityTier} onChange={set('qualityTier')}
          hint="Assessment data only — write what you concluded, not a score. A bare number or percentage is refused, because a tier must never become a commission floor." />

        <Text label="Conflict notes" value={form.conflictNotes} onChange={set('conflictNotes')} />
        <Text label="Sanctions and red-flag notes" value={form.sanctionsNotes}
          onChange={set('sanctionsNotes')} />
        <Text label="Internal comments" value={form.internalComments}
          onChange={set('internalComments')} hint="Never leaves Admin." />
        <Text label="Recruitment source" value={form.recruitmentSource}
          onChange={set('recruitmentSource')} hint="How Proovd found them." />
        <Text label="Recruiting Admin" value={form.recruitingAdmin}
          onChange={set('recruitingAdmin')} hint="The named person accountable for this." />

        <label className="field">
          <span className="field-label">Roster intent</span>
          <select
            className="input"
            value={form.rosterIntent}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                rosterIntent: event.target.value as 'initial_roster' | 'mid_campaign',
              }))
            }
          >
            <option value="initial_roster">Initial roster</option>
            <option value="mid_campaign">Possible mid-campaign addition</option>
          </select>
          <span className="field-hint">Stored separately from their state on the campaign.</span>
        </label>

        {definition ? (
          <fieldset className="admin-form">
            <legend className="admin-group__subheading">
              Evidence for a {definition.label.toLowerCase()}
            </legend>
            {definition.evidence.map((input) => (
              <label className="field" key={input.id}>
                <span className="field-label">
                  {input.label}
                  {input.conditional ? ' (where appropriate)' : ''}
                </span>
                <Input
                  value={evidence[input.id] ?? ''}
                  onChange={(event) =>
                    setEvidence((current) => ({ ...current, [input.id]: event.target.value }))
                  }
                />
                <span className="field-hint">{input.basis}</span>
              </label>
            ))}
          </fieldset>
        ) : null}

        <Button tier="primary" disabled={busy || !ready} onClick={() => void submit()}>
          Record this Creator
        </Button>

        {notice ? <p className="admin-note">{notice}</p> : null}
      </div>
    </Card>
  );
}

function Text({
  label,
  value,
  onChange,
  hint,
  type,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  type?: string;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <Input value={value} type={type} onChange={(event) => onChange(event.target.value)} />
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}
