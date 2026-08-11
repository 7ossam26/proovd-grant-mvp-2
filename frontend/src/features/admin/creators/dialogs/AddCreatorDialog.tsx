/**
 * Add Affiliate — the reference's four-step recruitment flow. §8, §5.3, §7.
 *
 * ── Four steps, because §8 asks four different questions ────────────────────
 * Who is the prospect · what evidence supports the channel · how does Admin
 * assess quality and risk · which campaign relationship is being created. Each
 * step is one question at a time (DNA §5.6), and the progress bar is honest
 * about how many are left rather than being a decoration.
 *
 * ── The campaign and the Founder are chosen, never typed ────────────────────
 * The reference's acceptance audit refuses a free-text campaign or Founder
 * field by name. The Founder is not a second control at all: it follows from
 * the campaign, because a form that let an Admin pick a campaign and a
 * mismatched Founder would offer a pair the record cannot hold.
 *
 * ── Saving the prospect creates no account and sends nothing ────────────────
 * §5.3 admits Affiliates by private invitation only; §33.2.1 is partly the fact
 * that nothing outside `/api/admin` can create one. The summary says so, in the
 * place an Admin who has just filled four steps of forms would otherwise assume
 * something had been sent.
 *
 * ── The form collects exactly what the route requires ───────────────────────
 * A field the create route would ignore is a field the form should not have
 * asked for. `campaignFit` is deliberately absent: the reference removes it,
 * and the route stopped requiring it on the same date (see
 * `admin-affiliates.ts`). It stays editable on the research record.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  ADD_AFFILIATE_STEPS,
  CAMPAIGN_IS_CHOSEN_NOT_TYPED,
  PROSPECT_CREATES_NO_ACCOUNT,
  QUALITY_TIER_HELPER,
} from '@proovd/shared';
import { Button, Field, Input, Textarea } from '../../../../components/index.js';
import { DialogShell } from '../../founders/dialogs/index.js';
import {
  AdminRequestError,
  createAffiliate,
  fetchAffiliateRegistry,
  fetchAssignableCampaigns,
  type AffiliateRegistry,
  type AssignableCampaign,
} from '../api.js';

/** The §5.3 subtype ids, with the words the Admin reads. */
const SUBTYPE_LABELS: Record<string, string> = {
  social_creator: 'Social Creator',
  newsletter_blog_operator: 'Newsletter / blog operator',
  podcast_host: 'Podcast host',
  community_owner: 'Community owner',
  course_instructor: 'Course instructor',
  student_affiliate: 'Student affiliate',
  niche_marketer: 'Niche distribution partner',
};

interface Draft {
  legalName: string;
  publicHandle: string;
  email: string;
  phone: string;
  subtype: string;
  channelReference: string;
  audienceNiche: string;
  audienceSize: string;
  audienceDemographics: string;
  permissionBasis: string;
  priorSponsoredContent: string;
  adminBio: string;
  qualityTier: string;
  conflictNotes: string;
  sanctionsNotes: string;
  internalComments: string;
  recruitmentSource: string;
  recruitingAdmin: string;
  campaignId: string;
  rosterIntent: 'initial_roster' | 'mid_campaign';
}

const EMPTY: Draft = {
  legalName: '',
  publicHandle: '',
  email: '',
  phone: '',
  subtype: '',
  channelReference: '',
  audienceNiche: '',
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
  campaignId: '',
  rosterIntent: 'initial_roster',
};

export function AddCreatorDialog({
  trigger,
  onClose,
  onCreated,
}: {
  trigger: HTMLElement | null;
  onClose: () => void;
  onCreated: (prospectId: string) => void;
}) {
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [campaigns, setCampaigns] = useState<AssignableCampaign[]>([]);
  const [registry, setRegistry] = useState<AffiliateRegistry | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void fetchAssignableCampaigns()
      .then(({ campaigns: rows }) => {
        if (live) setCampaigns(rows);
      })
      .catch(() => {
        /* Step 4 says so rather than offering an empty select. */
      });
    void fetchAffiliateRegistry()
      .then((value) => {
        if (live) setRegistry(value);
      })
      .catch(() => {
        /* The subtype list falls back to the labels above. */
      });
    return () => {
      live = false;
    };
  }, []);

  const set = (key: keyof Draft) => (value: string) =>
    setDraft((current) => ({ ...current, [key]: value }));

  /**
   * What this step still needs before Continue does anything useful.
   *
   * The server re-decides everything on submit — this is only so an Admin is
   * not walked to step 4 and then told step 1 was incomplete.
   */
  const blocking = useMemo(() => {
    if (step === 1) {
      return [
        !draft.legalName && 'Name',
        !draft.publicHandle && 'Username',
        !draft.email && 'Email',
        !draft.channelReference && 'Public channel URL',
        !draft.subtype && 'Affiliate subtype',
        !draft.audienceNiche && 'Niche',
      ].filter(Boolean) as string[];
    }
    if (step === 2) return [!draft.permissionBasis && 'Channel ownership / permission'].filter(Boolean) as string[];
    if (step === 3) {
      return [
        !draft.adminBio && 'Admin-written bio',
        !draft.recruitmentSource && 'Recruitment source',
        !draft.recruitingAdmin && 'Recruiting Admin',
      ].filter(Boolean) as string[];
    }
    return [!draft.campaignId && 'Campaign'].filter(Boolean) as string[];
  }, [step, draft]);

  const subtypeIds = registry?.subtypes ?? Object.keys(SUBTYPE_LABELS);
  const requiredEvidence = draft.subtype
    ? (registry?.requiredEvidence[draft.subtype] ?? [])
    : [];

  async function submit() {
    setBusy(true);
    setFailure(null);
    try {
      const created = await createAffiliate({
        legalName: draft.legalName,
        publicHandle: draft.publicHandle,
        email: draft.email,
        phone: draft.phone || null,
        subtype: draft.subtype,
        channelReference: draft.channelReference,
        audienceNiche: draft.audienceNiche,
        audienceSize: draft.audienceSize || null,
        audienceDemographics: draft.audienceDemographics || null,
        permissionBasis: draft.permissionBasis,
        priorSponsoredContent: draft.priorSponsoredContent || null,
        adminBio: draft.adminBio,
        qualityTier: draft.qualityTier || null,
        conflictNotes: draft.conflictNotes || null,
        sanctionsNotes: draft.sanctionsNotes || null,
        internalComments: draft.internalComments || null,
        recruitmentSource: draft.recruitmentSource,
        recruitingAdmin: draft.recruitingAdmin,
        campaignId: draft.campaignId,
        rosterIntent: draft.rosterIntent,
      });
      onCreated(created.prospectId);
    } catch (error: unknown) {
      setFailure(
        error instanceof AdminRequestError
          ? (error.detail.whatHappened ?? error.detail.title)
          : 'The prospect could not be recorded, and nothing was saved.',
      );
      setBusy(false);
    }
  }

  const current = ADD_AFFILIATE_STEPS[step - 1]!;

  return (
    <DialogShell
      kicker={`Add Affiliate · ${step} of ${ADD_AFFILIATE_STEPS.length}`}
      title={current.title}
      description={PROSPECT_CREATES_NO_ACCOUNT}
      trigger={trigger}
      onClose={onClose}
    >
      {(close) => (
        <>
          <div
            className="cr-progress"
            role="progressbar"
            aria-valuemin={1}
            aria-valuemax={ADD_AFFILIATE_STEPS.length}
            aria-valuenow={step}
            aria-label="Add Affiliate progress"
          >
            <span style={{ transform: `scaleX(${step / ADD_AFFILIATE_STEPS.length})` }} />
          </div>

          {failure ? (
            <p className="helper" role="alert">
              {failure}
            </p>
          ) : null}

          {step === 1 ? (
            <>
              <Field label="Name">
                <Input value={draft.legalName} onChange={(e) => set('legalName')(e.target.value)} />
              </Field>
              <Field label="Username">
                <Input
                  value={draft.publicHandle}
                  placeholder="@username"
                  onChange={(e) => set('publicHandle')(e.target.value)}
                />
              </Field>
              <Field label="Email">
                <Input
                  type="email"
                  value={draft.email}
                  onChange={(e) => set('email')(e.target.value)}
                />
              </Field>
              <Field
                label="Phone number"
                hint="Collected, never verified. The MVP has no way to verify a phone number."
              >
                <Input type="tel" value={draft.phone} onChange={(e) => set('phone')(e.target.value)} />
              </Field>
              <Field label="Public channel URL">
                <Input
                  type="url"
                  value={draft.channelReference}
                  placeholder="https://…"
                  onChange={(e) => set('channelReference')(e.target.value)}
                />
              </Field>
              <Field
                label="Affiliate subtype"
                hint="This decides which §5.3 evidence is required."
              >
                <select
                  className="input"
                  value={draft.subtype}
                  onChange={(e) => set('subtype')(e.target.value)}
                >
                  <option value="">Choose a subtype…</option>
                  {subtypeIds.map((id) => (
                    <option value={id} key={id}>
                      {SUBTYPE_LABELS[id] ?? id}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Niche / category">
                <Input
                  value={draft.audienceNiche}
                  onChange={(e) => set('audienceNiche')(e.target.value)}
                />
              </Field>
            </>
          ) : null}

          {step === 2 ? (
            <>
              {requiredEvidence.length > 0 ? (
                <p className="helper">
                  §5.3 asks this subtype for: {requiredEvidence.join(', ')}. Missing evidence
                  is reported, never enforced — except on Verified.
                </p>
              ) : null}
              <Field
                label="Audience size"
                hint="Followers, subscribers, members, enrolled students — the unit differs by subtype."
              >
                <Input
                  value={draft.audienceSize}
                  onChange={(e) => set('audienceSize')(e.target.value)}
                />
              </Field>
              <Field label="Audience demographics">
                <Textarea
                  value={draft.audienceDemographics}
                  onChange={(e) => set('audienceDemographics')(e.target.value)}
                />
              </Field>
              <Field
                label="Channel ownership / permission"
                hint="Whether they are entitled to promote on this channel at all."
              >
                <Textarea
                  value={draft.permissionBasis}
                  onChange={(e) => set('permissionBasis')(e.target.value)}
                />
              </Field>
              <Field label="Sponsored-content history">
                <Textarea
                  value={draft.priorSponsoredContent}
                  onChange={(e) => set('priorSponsoredContent')(e.target.value)}
                />
              </Field>
            </>
          ) : null}

          {step === 3 ? (
            <>
              <Field label="Internal quality tier" hint={QUALITY_TIER_HELPER}>
                <Input
                  value={draft.qualityTier}
                  onChange={(e) => set('qualityTier')(e.target.value)}
                />
              </Field>
              <Field label="Recruitment source">
                <Input
                  value={draft.recruitmentSource}
                  onChange={(e) => set('recruitmentSource')(e.target.value)}
                />
              </Field>
              <Field label="Recruiting Admin" hint="§1.3: manual work counts when it is recorded.">
                <Input
                  value={draft.recruitingAdmin}
                  onChange={(e) => set('recruitingAdmin')(e.target.value)}
                />
              </Field>
              <Field label="Admin-written bio" hint="Prefills their signup; §11 lets them correct it.">
                <Textarea value={draft.adminBio} onChange={(e) => set('adminBio')(e.target.value)} />
              </Field>
              <Field label="Conflicts / relationships">
                <Textarea
                  value={draft.conflictNotes}
                  onChange={(e) => set('conflictNotes')(e.target.value)}
                />
              </Field>
              <Field label="Sanctions research note">
                <Textarea
                  value={draft.sanctionsNotes}
                  onChange={(e) => set('sanctionsNotes')(e.target.value)}
                />
              </Field>
              <Field label="Internal notes">
                <Textarea
                  value={draft.internalComments}
                  onChange={(e) => set('internalComments')(e.target.value)}
                />
              </Field>
            </>
          ) : null}

          {step === 4 ? (
            <>
              <p className="helper">{CAMPAIGN_IS_CHOSEN_NOT_TYPED}</p>
              {campaigns.length === 0 ? (
                <p className="grey">
                  There are no campaigns to attach this Affiliate to. A campaign is created
                  by inviting a Founder.
                </p>
              ) : (
                <Field label="Campaign">
                  <select
                    className="input"
                    value={draft.campaignId}
                    onChange={(e) => set('campaignId')(e.target.value)}
                  >
                    <option value="">Choose a campaign…</option>
                    {campaigns.map((campaign) => (
                      <option value={campaign.campaignId} key={campaign.campaignId}>
                        {[campaign.name, campaign.founderName, campaign.status]
                          .filter(Boolean)
                          .join(' · ')}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              <Field label="Roster designation">
                <select
                  className="input"
                  value={draft.rosterIntent}
                  onChange={(e) =>
                    setDraft((c) => ({
                      ...c,
                      rosterIntent:
                        e.target.value === 'mid_campaign' ? 'mid_campaign' : 'initial_roster',
                    }))
                  }
                >
                  <option value="initial_roster">Initial launch roster</option>
                  <option value="mid_campaign">Mid-campaign addition</option>
                </select>
              </Field>
              <p className="helper">{PROSPECT_CREATES_NO_ACCOUNT}</p>
            </>
          ) : null}

          {blocking.length > 0 ? (
            <p className="helper">Still needed on this step: {blocking.join(', ')}.</p>
          ) : null}

          <div className="case-actions">
            {step > 1 ? (
              <Button tier="secondary" onClick={() => setStep(step - 1)}>
                Back to {ADD_AFFILIATE_STEPS[step - 2]!.title}
              </Button>
            ) : null}
            {step < ADD_AFFILIATE_STEPS.length ? (
              <Button disabled={blocking.length > 0} onClick={() => setStep(step + 1)}>
                Continue to {ADD_AFFILIATE_STEPS[step]!.title}
              </Button>
            ) : (
              <Button disabled={busy || blocking.length > 0} onClick={() => void submit()}>
                Save prospect
              </Button>
            )}
            <Button tier="tertiary" onClick={close}>
              Cancel
            </Button>
          </div>
        </>
      )}
    </DialogShell>
  );
}
