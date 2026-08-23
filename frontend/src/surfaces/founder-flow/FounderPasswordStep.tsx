import { useState, type FormEvent } from 'react';
import { useParams } from 'react-router';
import {
  CREATOR_PASSWORD_REQUIREMENTS,
  creatorPasswordMeetsRequirements,
  founderDashboardPath,
} from '@proovd/shared';
import { Button } from '../../components/index.js';
import { FlowPage, useFlowNav } from './FlowPage.js';
import { FounderRequestError, setInitialPassword } from '../founder/api.js';

/** Replaces the claim's temporary credential before the Founder leaves onboarding. */
export function FounderPasswordStep() {
  const { campaignId = '' } = useParams();
  return (
    <FlowPage pageId="password" param={campaignId}>
      <PasswordForm campaignId={campaignId} />
    </FlowPage>
  );
}

function Tick() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function PasswordForm({ campaignId }: { campaignId: string }) {
  const { leave } = useFlowNav();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const strong = creatorPasswordMeetsRequirements(password);
  const mismatch = confirmation.length > 0 && confirmation !== password;
  const ready = strong && confirmation === password && !busy;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      await setInitialPassword(campaignId, password);
      leave(founderDashboardPath(campaignId), 1);
    } catch (caught: unknown) {
      setError(
        caught instanceof FounderRequestError
          ? (caught.detail.whatHappened ?? caught.detail.title)
          : 'We could not secure your account. Nothing was changed; try again.',
      );
      setBusy(false);
    }
  }

  return (
    <form className="ff-money" onSubmit={submit}>
      <div data-anim="head">
        <h1 className="ff-build__title">Secure your Founder account</h1>
        <p className="ff-money__lede">
          Choose the password you will use when you come back. We never store it in plain text.
        </p>
      </div>

      <div className="crf-pw__body" data-anim="field">
        <label className="sr-only" htmlFor="founder-password">New password</label>
        <input
          id="founder-password"
          className="crf-pw__input"
          type="password"
          autoComplete="new-password"
          placeholder="New password"
          aria-describedby="founder-password-requirements"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <ul className="crf-pw__reqs" id="founder-password-requirements">
          {CREATOR_PASSWORD_REQUIREMENTS.map((requirement) => {
            const met = requirement.met(password);
            return (
              <li key={requirement.id} className={met ? 'crf-pw__req is-met' : 'crf-pw__req'}>
                <span className="crf-pw__box"><Tick /></span>
                <span className="crf-pw__req-label">
                  {requirement.label}
                  <span className="sr-only">{met ? ' — met' : ' — not yet met'}</span>
                </span>
              </li>
            );
          })}
        </ul>

        {strong ? (
          <div className="crf-pw__confirm">
            <label className="sr-only" htmlFor="founder-password-confirmation">Confirm password</label>
            <input
              id="founder-password-confirmation"
              className="crf-pw__input"
              type="password"
              autoComplete="new-password"
              placeholder="Confirm password"
              aria-invalid={mismatch || undefined}
              aria-describedby={mismatch ? 'founder-password-error' : undefined}
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </div>
        ) : null}

        {mismatch ? <p className="crf-pw__mismatch" id="founder-password-error" role="alert">Those passwords do not match.</p> : null}
        {error ? <p className="crf-pw__mismatch" role="alert">{error}</p> : null}
      </div>

      <div className="ff-nav" data-anim="cta">
        <Button tier="primary" type="submit" disabled={!ready}>
          {busy ? 'Securing your account…' : 'Set password and open dashboard'}
        </Button>
      </div>
    </form>
  );
}
