/**
 * Create Founder — §7's two acts on one page. Built Session B (2026-08-17) to
 * the supplied reference's five-step compose.
 *
 * ── What the five steps write, record by record ─────────────────────────────
 * 01 Account & business  → the prospect (POST /api/admin/founders) plus the
 *                          0043 `state` identity field and the campaign path.
 * 02 Onboarding prefills → §9's two named prefills, Problem and Solution,
 *                          through the intake's own path. The reference's
 *                          other four boxes are refused with their reasons —
 *                          `CREATE_FOUNDER_ABSENCES` is the register, and the
 *                          step renders the refusals rather than dead inputs.
 * 03 Research & internal → §7's discovery record: source, owner, last spoke,
 *                          Creator-fit hypothesis, internal notes, and the
 *                          research boxes composed into discovery evidence.
 * 04 Optional preparation→ three named absences and no input (§1.4): uploads
 *                          are Track A4, branding is the Founder's §12 work,
 *                          and the interview booking is created by the
 *                          Founder's own flow.
 * 05 Invitation          → §7's real message fields (what we understood, why
 *                          invited, expected setup time), written through the
 *                          same editable-field path the record uses.
 *
 * ── Nothing saves until the Admin says so ───────────────────────────────────
 * The reference autosaves keystrokes into localStorage; a real record created
 * on a keystroke is a prospect row for every typo. The page is local state
 * until `Create prospect` / `Create & send invitation`, and the footer says
 * exactly that. `Save draft` in the top bar is the same act as
 * `Create prospect` wearing the reference's label — creating the prospect IS
 * saving the draft.
 *
 * ── The checklist is a courtesy ─────────────────────────────────────────────
 * The rail's five lines are computed from form state so an Admin is not made
 * to round-trip to be told a box is empty. The send route re-decides every
 * one server-side (§1.1) — a refusal navigates to the record's Invite tab,
 * where the server's own list of what is missing renders.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router';
import {
  CAMPAIGN_PATH_CHOICES,
  CREATE_FOUNDER_ABSENCES,
  CREATE_FOUNDER_CHECKLIST,
} from '@proovd/shared';
import { Button, Field, Input, Textarea, useToast } from '../../../components/index.js';
import { useProovdMotion } from '../../../motion/MotionProvider.js';
import type { AdminError } from '../api.js';
import {
  AdminRequestError,
  createProspect,
  fetchFounders,
  sendInvite,
  setFounderCampaignPath,
  updateFounderField,
  updateProspect,
} from '../api.js';

/** The reference's four discovery-source suggestions. §7 names no closed list. */
const SOURCE_SUGGESTIONS = ['Founder research', 'Referral', 'Community scouting', 'Inbound'];

interface FormState {
  legalName: string;
  preferredName: string;
  businessName: string;
  email: string;
  phone: string;
  website: string;
  cityState: string;
  campaignPath: '' | 'pre_build' | 'pre_launch';
  problem: string;
  solution: string;
  invitationSource: string;
  internalOwner: string;
  lastContactAt: string;
  whereFound: string;
  researchSource: string;
  affiliateFit: string;
  adminNotes: string;
  whatWeUnderstood: string;
  whyInvited: string;
  expectedSetupTime: string;
}

const EMPTY: FormState = {
  legalName: '',
  preferredName: '',
  businessName: '',
  email: '',
  phone: '',
  website: '',
  cityState: '',
  campaignPath: '',
  problem: '',
  solution: '',
  invitationSource: '',
  internalOwner: '',
  lastContactAt: '',
  whereFound: '',
  researchSource: '',
  affiliateFit: '',
  adminNotes: '',
  whatWeUnderstood: '',
  whyInvited: '',
  expectedSetupTime: '',
};

export function CreateFounder() {
  const navigate = useNavigate();
  const toast = useToast();
  const pageRef = useRef<HTMLDivElement>(null);
  useProovdMotion(pageRef, []);

  const [form, setForm] = useState<FormState>(EMPTY);
  const [busy, setBusy] = useState<'create' | 'send' | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  /**
   * A prospect that exists whose invitation was refused.
   *
   * Kept in state rather than navigated past, because the refusal is the thing
   * the Admin came here to hear and a toast is not a place to put it: `toast`
   * is a no-op when the motion runtime is unavailable, and this page used to
   * fire one and then immediately navigate, so a refused send looked exactly
   * like nothing having happened at all. The record is created either way, so
   * the create controls are replaced rather than left to fire twice.
   */
  const [refused, setRefused] = useState<
    { prospectId: string; detail: AdminError } | null
  >(null);
  /** Owner values already in use, offered as a datalist — never a closed list. */
  const [owners, setOwners] = useState<string[]>([]);

  useEffect(() => {
    fetchFounders()
      .then(({ founders }) => {
        setOwners([...new Set(founders.map((row) => row.owner).filter((o): o is string => !!o))]);
      })
      .catch(() => {
        // The datalist is a convenience; the field stays free text without it.
      });
  }, []);

  const set = (key: keyof FormState) => (value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  /* The rail's five lines, from form state. The send route re-decides (§1.1). */
  const checks = useMemo(
    () => [
      Boolean(form.legalName.trim() && form.businessName.trim()),
      /\S+@\S+\.\S+/.test(form.email.trim()),
      Boolean(form.cityState.trim()),
      Boolean(form.internalOwner.trim()),
      Boolean(
        form.whatWeUnderstood.trim() &&
          form.whyInvited.trim() &&
          form.expectedSetupTime.trim() &&
          form.invitationSource.trim(),
      ),
    ],
    [form],
  );
  const allChecked = checks.every(Boolean);
  const creatable = Boolean(
    form.legalName.trim() && /\S+@\S+\.\S+/.test(form.email.trim()) && form.businessName.trim(),
  );

  /**
   * §7's two acts, in order, against the records each field belongs to. The
   * prospect is created first so a later failure leaves a person that exists
   * and is editable — the opposite ordering loses them over a phone number.
   */
  async function createRecords(): Promise<{ prospectId: string; draftId: string }> {
    const evidence = [
      form.whereFound.trim() ? `Found via: ${form.whereFound.trim()}` : null,
      form.researchSource.trim() ? `Research source: ${form.researchSource.trim()}` : null,
    ].filter((entry): entry is string => entry !== null);

    const created = await createProspect({
      legalName: form.legalName.trim(),
      email: form.email.trim(),
      ...(form.preferredName.trim() ? { preferredName: form.preferredName.trim() } : {}),
      ...(form.phone.trim() ? { phone: form.phone.trim() } : {}),
      ...(form.businessName.trim() ? { productName: form.businessName.trim() } : {}),
      ...(form.website.trim() ? { productUrl: form.website.trim() } : {}),
      ...(form.invitationSource.trim() ? { invitationSource: form.invitationSource.trim() } : {}),
      ...(form.internalOwner.trim() ? { internalOwner: form.internalOwner.trim() } : {}),
      ...(form.lastContactAt ? { lastContactAt: form.lastContactAt } : {}),
      ...(form.adminNotes.trim() ? { adminNotes: form.adminNotes.trim() } : {}),
      ...(form.problem.trim() ? { problem: form.problem.trim() } : {}),
      ...(form.solution.trim() ? { solution: form.solution.trim() } : {}),
    });

    // Everything below edits the record the create just made. A failure here
    // does not lose the person — every one of these is editable on the record.
    if (form.affiliateFit.trim() || evidence.length > 0) {
      await updateProspect(created.draftId, {
        ...(form.affiliateFit.trim() ? { affiliateSourcingHypothesis: form.affiliateFit.trim() } : {}),
        ...(evidence.length > 0 ? { discoveryEvidence: evidence } : {}),
      });
    }
    if (form.cityState.trim()) {
      await updateFounderField(created.prospectId, 'state', { value: form.cityState.trim() });
    }
    if (form.campaignPath) {
      await setFounderCampaignPath(created.draftId, form.campaignPath);
    }
    for (const [key, value] of [
      ['invKnow', form.whatWeUnderstood],
      ['invFit', form.whyInvited],
      ['invTime', form.expectedSetupTime],
    ] as const) {
      if (value.trim()) {
        await updateFounderField(created.prospectId, key, { value: value.trim() });
      }
    }

    return created;
  }

  async function run(intent: 'create' | 'send') {
    setBusy(intent);
    setFailure(null);
    try {
      const created = await createRecords();
      if (intent === 'send') {
        try {
          await sendInvite(created.prospectId);
          toast('Invitation sent');
        } catch (error) {
          // The prospect exists and the invitation does not. Stay here and say
          // so in the page, carrying the server's own §27.1 answers verbatim —
          // navigating away with only a toast is what made a refused send look
          // like a button that did nothing.
          setRefused({
            prospectId: created.prospectId,
            detail:
              error instanceof AdminRequestError
                ? error.detail
                : {
                    error: 'send_failed',
                    status: 0,
                    title: 'The invitation was not sent',
                    whatHappened:
                      'The Founder record was created, but the send was refused without an explanation.',
                    next: 'Open the record and send the invitation from its Invite tab.',
                  },
          });
          setBusy(null);
          return;
        }
      } else {
        toast('Prospect created', { sub: 'Nothing has been sent.' });
      }
      void navigate(`/admin/founders/${created.prospectId}?section=onboarding`);
    } catch (error) {
      setFailure(
        error instanceof AdminRequestError
          ? [error.detail.title, error.detail.whatHappened, error.detail.next]
              .filter(Boolean)
              .join(' ')
          : 'Nothing was created, and it is not certain why. Reload before trying again.',
      );
      setBusy(null);
    }
  }

  return (
    <div ref={pageRef} className="cf-page">
      <div className="crumb">
        <RouterLink className="btn btn--tertiary" to="/admin/founders">
          <span className="btn__label">← Founder directory</span>
        </RouterLink>
      </div>

      <header className="cf-head" data-scroll="rise">
        <div>
          <p className="kicker">New private invitation</p>
          <h1 className="h2" data-reveal="headline">
            Create Founder
          </h1>
          <p className="grey">
            Create the internal record, preserve research, and review the exact invitation
            before sending.
          </p>
        </div>
        <div className="cf-head__actions">
          <Button tier="tertiary" disabled={!creatable || busy !== null} onClick={() => void run('create')}>
            Save draft
          </Button>
        </div>
      </header>

      <div className="cf-layout">
        <div className="cf-steps">
          <StepPanel n="01" title="Account & business" sub="Private invitation recipient and basic business context.">
            <div className="cf-grid">
              <Field id="cf-legal" label="Founder name" hint="Required">
                <Input value={form.legalName} onChange={(e) => set('legalName')(e.target.value)} />
              </Field>
              <Field id="cf-business" label="Business name" hint="Required">
                <Input value={form.businessName} onChange={(e) => set('businessName')(e.target.value)} />
              </Field>
              <Field id="cf-email" label="Email" hint="Required">
                <Input type="email" value={form.email} onChange={(e) => set('email')(e.target.value)} />
              </Field>
              <Field id="cf-phone" label="Phone">
                <Input type="tel" value={form.phone} onChange={(e) => set('phone')(e.target.value)} />
              </Field>
              <Field id="cf-preferred" label="Preferred name">
                <Input
                  value={form.preferredName}
                  placeholder="Defaults to their first name"
                  onChange={(e) => set('preferredName')(e.target.value)}
                />
              </Field>
              <Field id="cf-website" label="Website">
                <Input value={form.website} onChange={(e) => set('website')(e.target.value)} />
              </Field>
              <Field id="cf-city" label="US city and state">
                <Input
                  value={form.cityState}
                  placeholder="Chicago, IL"
                  onChange={(e) => set('cityState')(e.target.value)}
                />
              </Field>
              <Field
                id="cf-type"
                label="Campaign type"
                hint="Optional here — it stays changeable until the Founder submits, then locks permanently (§9)."
              >
                <select
                  className="input"
                  value={form.campaignPath}
                  onChange={(e) => set('campaignPath')(e.target.value)}
                >
                  <option value="">Not decided yet</option>
                  {CAMPAIGN_PATH_CHOICES.map((choice) => (
                    <option key={choice.type} value={choice.type}>
                      {choice.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </StepPanel>

          <StepPanel
            n="02"
            title="Onboarding prefills"
            sub="A source-backed head start. The Founder owns the final answers."
          >
            <Field
              id="cf-problem"
              label="Problem"
              hint="§9's Admin prefill. It stops moving the moment the Founder edits the answer."
            >
              <Textarea rows={3} value={form.problem} onChange={(e) => set('problem')(e.target.value)} />
            </Field>
            <Field id="cf-solution" label="Solution">
              <Textarea rows={3} value={form.solution} onChange={(e) => set('solution')(e.target.value)} />
            </Field>
            <Absences boxes={['Business explanation', 'Audience', 'Founder story', 'Social links']} />
          </StepPanel>

          <StepPanel
            n="03"
            title="Research & internal setup"
            sub="Operational context that remains internal to Proovd."
          >
            <div className="cf-grid">
              <Field id="cf-source" label="Discovery source" hint="Required before sending — recorded on the send row (§7).">
                <Input
                  list="cf-source-list"
                  value={form.invitationSource}
                  onChange={(e) => set('invitationSource')(e.target.value)}
                />
              </Field>
              {/* Datalists live outside `Field` — it clones a single child. */}
              <datalist id="cf-source-list">
                {SOURCE_SUGGESTIONS.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
              <Field
                id="cf-owner"
                label="Internal owner"
                hint="Required before sending. Free text — values already in use are suggested."
              >
                <Input
                  list="cf-owner-list"
                  value={form.internalOwner}
                  onChange={(e) => set('internalOwner')(e.target.value)}
                />
              </Field>
              <datalist id="cf-owner-list">
                {owners.map((o) => (
                  <option key={o} value={o} />
                ))}
              </datalist>
              <Field
                id="cf-lastcontact"
                label="When we last spoke"
                hint="A record of a conversation. Nothing schedules a follow-up from it."
              >
                <Input type="date" value={form.lastContactAt} onChange={(e) => set('lastContactAt')(e.target.value)} />
              </Field>
              <Field id="cf-wherefound" label="Where we found them" hint="Recorded as discovery evidence.">
                <Input value={form.whereFound} onChange={(e) => set('whereFound')(e.target.value)} />
              </Field>
              <Field id="cf-research" label="Research source" hint="Recorded as discovery evidence.">
                <Input value={form.researchSource} onChange={(e) => set('researchSource')(e.target.value)} />
              </Field>
            </div>
            <Field id="cf-fit" label="Affiliate-fit notes" hint="The Creator-sourcing hypothesis (§7).">
              <Textarea rows={2} value={form.affiliateFit} onChange={(e) => set('affiliateFit')(e.target.value)} />
            </Field>
            <Field id="cf-notes" label="Internal notes" hint="What the discovery call produced. Never shown to the Founder.">
              <Textarea rows={3} value={form.adminNotes} onChange={(e) => set('adminNotes')(e.target.value)} />
            </Field>
            <Absences boxes={['Meeting notes']} />
          </StepPanel>

          <StepPanel
            n="04"
            title="Optional preparation"
            sub="Helpful preparation that never blocks the invitation."
          >
            <Absences boxes={['Visual asset uploads', 'Branding evidence', 'Interview scheduling']} />
          </StepPanel>

          <StepPanel n="05" title="Invitation" sub="Review the exact private invitation before it leaves Proovd.">
            <Field id="cf-know" label="What we know so far" hint="Required before sending — a paragraph of the message (§7).">
              <Textarea
                rows={3}
                value={form.whatWeUnderstood}
                onChange={(e) => set('whatWeUnderstood')(e.target.value)}
              />
            </Field>
            <Field id="cf-why" label="Why we think they could be a fit" hint="Required before sending.">
              <Textarea rows={3} value={form.whyInvited} onChange={(e) => set('whyInvited')(e.target.value)} />
            </Field>
            <Field
              id="cf-time"
              label="Estimated time to get started"
              hint="Required before sending. This must reflect the actual expected effort."
            >
              <Input value={form.expectedSetupTime} onChange={(e) => set('expectedSetupTime')(e.target.value)} />
            </Field>
            <p className="helper">
              The message also carries §7’s fixed wording — what happens next, the
              no-guarantee statement, and the support contact — which no surface can edit.
              The exact rendered message is previewable on the record before sending.
            </p>
          </StepPanel>
        </div>

        <aside className="cf-rail" data-scroll="rise" aria-label="Before you send">
          <div className="cf-check">
            <h2 className="h3">Before you send</h2>
            <ul>
              {CREATE_FOUNDER_CHECKLIST.map((label, index) => (
                <li key={label} className={checks[index] ? 'is-done' : undefined}>
                  <span aria-hidden="true">{checks[index] ? '✓' : '–'}</span> {label}
                  <span className="sr-only">{checks[index] ? ' — done' : ' — not yet'}</span>
                </li>
              ))}
            </ul>
            <p className="cf-check__note">
              Competition stays Founder-written and is never prefilled here. Proovd re-checks
              every line when the invitation is actually sent.
            </p>
          </div>
        </aside>
      </div>

      {failure ? (
        <p className="field-error" role="alert">
          {failure}
        </p>
      ) : null}

      {/*
        §27.1's six questions, answered in the server's own words. Rendered in
        the page rather than announced and navigated past, because this is the
        one outcome an Admin has to act on.
      */}
      {refused ? (
        <section className="cf-refused" role="alert" aria-labelledby="cf-refused-title">
          <h2 className="h3" id="cf-refused-title">
            {refused.detail.title}
          </h2>
          <p>
            <b>The Founder record was created and no invitation was sent.</b> Nothing has
            reached them.
          </p>
          {refused.detail.whatHappened ? <p>{refused.detail.whatHappened}</p> : null}
          {refused.detail.next ? <p>{refused.detail.next}</p> : null}
          <p className="helper">
            The record’s Invite tab lists anything still unfilled and carries the Send
            control, so nothing typed here is lost.
          </p>
          <span className="cf-foot__actions">
            <RouterLink
              className="btn btn--primary"
              to={`/admin/founders/${refused.prospectId}?section=onboarding`}
            >
              <span className="btn__label">Open the Founder record</span>
            </RouterLink>
            {refused.detail.action ? (
              <RouterLink className="btn btn--secondary" to={refused.detail.action}>
                <span className="btn__label">Confirm it is you</span>
              </RouterLink>
            ) : null}
          </span>
        </section>
      ) : null}

      <footer className="cf-foot" data-scroll="rise">
        <RouterLink className="btn btn--tertiary" to="/admin/founders">
          <span className="btn__label">Cancel</span>
        </RouterLink>
        {refused ? (
          <span className="grey">
            This Founder has been created. Continue on their record — creating again here
            would make a second one.
          </span>
        ) : (
          <>
            <span className="grey">
              Saved when you create the prospect — nothing is stored before that.
            </span>
            <span className="cf-foot__actions">
              <Button
                tier="secondary"
                disabled={!creatable || busy !== null}
                onClick={() => void run('create')}
              >
                {busy === 'create' ? 'Creating…' : 'Create prospect'}
              </Button>
              <Button
                tier="primary"
                disabled={!creatable || !allChecked || busy !== null}
                onClick={() => void run('send')}
              >
                {busy === 'send' ? 'Sending…' : 'Create & send invitation'}
              </Button>
            </span>
          </>
        )}
      </footer>
    </div>
  );
}

/* ── Pieces ─────────────────────────────────────────────────────────────────*/

function StepPanel({
  n,
  title,
  sub,
  children,
}: {
  n: string;
  title: string;
  sub: string;
  children: React.ReactNode;
}) {
  return (
    <section className="cf-step" data-scroll="rise">
      <header>
        <span className="cf-step__n" aria-hidden="true">
          {n}
        </span>
        <div>
          <h2 className="h3">{title}</h2>
          <p className="grey">{sub}</p>
        </div>
      </header>
      {children}
    </section>
  );
}

/**
 * The reference boxes this step does not render, each with its register
 * reason behind one gesture. The register is the contract — a box named here
 * has a recorded §1.8 refusal, and a test walks the list.
 */
function Absences({ boxes }: { boxes: string[] }) {
  const entries = CREATE_FOUNDER_ABSENCES.filter((entry) => boxes.includes(entry.box));
  return (
    <div className="cf-absent">
      {entries.map((entry) => (
        <p key={entry.box} className="helper">
          <b>No {entry.box.toLowerCase()} box.</b> {entry.reason}
        </p>
      ))}
    </div>
  );
}
