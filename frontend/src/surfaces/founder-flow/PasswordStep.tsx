/**
 * Screen 25 — your password — the LAST page of the Founder flow.
 *
 * ── Why it is here and not near the beginning ───────────────────────────────
 * §10 creates the account and takes the credential in one act, at a screen that
 * used to sit before the campaign setup. By product direction (2026-08-20)
 * those became two acts: the account is created by submitting the answers,
 * because §13's Stripe onboarding is keyed to a real `ownerUserId` and every
 * page from `visuals` onward is behind `requireRole('founder')` — so the
 * account cannot wait. The password can, and this is where it waits.
 *
 * `backend/src/vetting/claim.ts` records the deviation in full, including the
 * eight §10 items the claim no longer asks for and what each was replaced by.
 * This file is the screen; that file is the reasoning.
 *
 * ── What it is honest about ─────────────────────────────────────────────────
 * Until this page a Founder's account is held open by one browser session and
 * nothing else — there is no credential to sign in with. That is a real fact
 * about their account and §1.4 means saying it rather than presenting this as
 * an optional preference. So the lede states it, and the screen offers no way
 * past it that pretends otherwise: the one control is `Set password and open my
 * dashboard`, and it names both things it does (§33.11.4).
 *
 * ── The server re-decides the length ────────────────────────────────────────
 * The twelve-character minimum is Better Auth's own and `setFounderPassword`
 * enforces it. The counter here is a courtesy that stops somebody submitting a
 * password they will be told about; §1.1 is why the refusal that matters is the
 * server's, and it renders in full when it comes.
 *
 * The requirement list has ONE entry deliberately — Founder Flow Session B
 * recorded why: the reference draws four live ticks starting at eight
 * characters, three of which decide nothing, and a checklist where most ticks
 * are decorative teaches people that ticks are decorative.
 */

import { useCallback, useState, type FormEvent } from 'react';
import { useParams } from 'react-router';
import { Button, Field, Input, StatePanel } from '../../components/index.js';
import { FlowPage, useFlowNav } from './FlowPage.js';
import { setInitialPassword } from '../founder/api.js';
import { DraftRequestError } from '../draft/api.js';

const HEADLINE = 'One last thing';
const LEDE =
  'Choose a password so you can sign back in. Until now your account has been held open by this browser alone — close it without setting one and you would have to ask us for a link back.';
const MIN = 12;

export function PasswordStep() {
  const { campaignId = '' } = useParams();

  return (
    <FlowPage pageId="password" param={campaignId} badge>
      <PasswordForm campaignId={campaignId} />
    </FlowPage>
  );
}

function PasswordForm({ campaignId }: { campaignId: string }) {
  const { leave } = useFlowNav();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<{ title: string; detail: string; next: string } | null>(
    null,
  );

  const short = value.length > 0 && value.length < MIN;

  const submit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      if (busy || value.length < MIN) return;
      setBusy(true);
      setRefusal(null);
      try {
        await setInitialPassword(campaignId, value);
        leave(`/campaigns/${encodeURIComponent(campaignId)}/home`);
      } catch (error) {
        /*
          The server's whole explanation, not just its headline. §27.1's first
          two questions are what happened and what to do about it, and the
          title alone answers neither — the same defect `lib/autosave.ts`
          records for the save line.
        */
        const body = error instanceof DraftRequestError ? error.detail : null;
        setRefusal({
          title: body?.title ?? 'That password was not set',
          detail: body?.whatHappened ?? 'The server did not answer.',
          next:
            body?.next ??
            'Try again. Your campaign is live either way — nothing about it changed.',
        });
        setBusy(false);
      }
    },
    [busy, campaignId, leave, value],
  );

  return (
    <form className="ff-password" onSubmit={(e) => void submit(e)}>
      <h1 className="ff-build__title" data-anim="head">
        {HEADLINE}
      </h1>

      <div data-anim="panel">
        <p className="ff-password__lede">{LEDE}</p>

        <Field
          label="Your password"
          id="ff-password-value"
          hint={`At least ${MIN} characters. Nothing else is required.`}
        >
          <Input
            type="password"
            value={value}
            autoComplete="new-password"
            onChange={(e) => setValue(e.currentTarget.value)}
          />
        </Field>

        {/*
          One requirement, and it renders as a state rather than as a tick that
          is green from the first keystroke. It appears only once somebody has
          typed something, because telling an empty box it is too short is
          telling somebody off for not having started.
        */}
        {short ? (
          <p className="ff-password__short" role="status">
            {MIN - value.length} more{' '}
            {MIN - value.length === 1 ? 'character' : 'characters'} to go.
          </p>
        ) : null}

        {refusal ? (
          <div className="ff-password__refusal">
            <StatePanel
              state={refusal.title}
              whatHappened={refusal.detail}
              next={refusal.next}
              owner="You"
              nextUpdate="As soon as you try again"
              reference={campaignId}
              /*
                §27.1's sixth question. There is no retry control here because
                the form's own button IS the retry and it is still on screen —
                offering a second one would be two controls for one act (DNA
                §5.6). What this adds is the route out, for somebody the
                refusal has left stuck.
              */
              action={
                <Button
                  tier="secondary"
                  onClick={() => leave(`/campaigns/${encodeURIComponent(campaignId)}/home`)}
                >
                  Skip for now and open my dashboard
                </Button>
              }
            />
          </div>
        ) : null}
      </div>

      <div className="ff-password__nav" data-anim="cta">
        <Button tier="primary" type="submit" disabled={busy || value.length < MIN}>
          {busy ? 'Setting your password…' : 'Set password and open my dashboard'}
        </Button>
      </div>
    </form>
  );
}
