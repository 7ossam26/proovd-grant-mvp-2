/**
 * The Founder's account settings — Founder Dashboard Session G (§5.2).
 *
 * §5.2's eleven items at one account-level address, and the page Phase 22c's
 * `/settings/notifications` was always going to join: its own header has said
 * since it shipped that *"when a later phase has a second account-level
 * setting, it joins this page."* That address now redirects here and the digest
 * control is a section of this one.
 *
 * ── The register is what makes "all eleven" checkable ───────────────────────
 * `FOUNDER_SETTINGS_ITEMS` is §5.2's own list. Every entry is either built or
 * carries a sentence rendered where the control would be — a settings page
 * missing one of §5.2's names reads as a page that forgot rather than one that
 * decided, and a twelfth entry is a §1 rule 6 conversation rather than a nice
 * idea somebody had.
 *
 * ── Inline, not modal ───────────────────────────────────────────────────────
 * Every form here can be refused by the server: an unregistered field, a
 * missing reason, a wrong current password. `Modal` closes on its own primary
 * action, which would put the refusal on a page behind a panel that has just
 * vanished — the reason Chapters 1–4 edit in place, and it binds harder here
 * because two of these refusals are about a credential.
 *
 * ── Two blocks are somebody else's read, rendered by their own component ────
 * `PayoutOnboarding` renders §13's four states from `GET /api/founder/payouts`,
 * and `NotificationSettings` renders §27.7's preference and history from Phase
 * 22c's two routes. Neither is re-fetched or re-composed here: a second answer
 * to "is this payout account complete" is exactly the drift one resolver
 * exists to prevent (§33.8.13's rule, applied to a status).
 */

import { useCallback, useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router';
import {
  FOUNDER_DELETION_IS_RECORDED_NOT_EXECUTED,
  FOUNDER_SETTINGS_FIELDS,
  FOUNDER_SETTINGS_GUARDED,
  FOUNDER_SETTINGS_ITEMS,
  KYC_IS_STRIPES_RECORD,
  PASSWORD_CHANGE_NEEDS_CURRENT,
  PASSWORD_CHANGE_REVOKES_OTHER_SESSIONS,
  SETTINGS_READS_THE_CURRENT_RECORD,
  FOUNDER_SETTINGS_REASON_IS_RECORDED,
  FOUNDER_TRANSACTIONAL_IS_NOT_OPTIONAL,
  W9_IS_PER_CAMPAIGN,
  settingsAbsence,
} from '@proovd/shared';
import {
  Button,
  Field,
  Input,
  Measure,
  NO_ACTION,
  Section,
  StatePanel,
  Tag,
  Textarea,
} from '../../components/index.js';
import { SurfaceLoading, supportMailto } from '../../features/public/states.js';
import { NotificationSettings } from '../notifications/NotificationSettings.js';
import { PayoutOnboarding } from '../payouts/PayoutOnboarding.js';
import { fetchPayouts, requestOnboardingLink, type PayoutState } from '../payouts/api.js';
import {
  changeFounderPassword,
  correctFounderField,
  fetchFounderSettings,
  requestFounderDeletion,
  type FounderSettingsView,
} from './api.js';

/** The server's refusal, or an honest fallback. Never a guess about a cause. */
function refusalText(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'detail' in error) {
    const detail = (error as { detail?: { whatHappened?: string; message?: string } }).detail;
    if (detail?.whatHappened) return detail.whatHappened;
    if (detail?.message) return detail.message;
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

const localDate = (iso: string): string =>
  new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

/* ── One correctable field ────────────────────────────────────────────────── */

interface FieldSpec {
  id: string;
  label: string;
  help: string | null;
  consequence: string | null;
}

const SPECS: FieldSpec[] = [
  ...FOUNDER_SETTINGS_FIELDS.map((f) => ({
    id: f.id,
    label: f.label,
    help: f.help ?? null,
    consequence: null,
  })),
  ...FOUNDER_SETTINGS_GUARDED.map((f) => ({
    id: f.id,
    label: f.label,
    help: null,
    consequence: f.consequence,
  })),
];

function SettingsField({
  spec,
  value,
  onChanged,
}: {
  spec: FieldSpec;
  value: string | null;
  onChanged: (view: FounderSettingsView) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const save = useCallback(async () => {
    setBusy(true);
    setFailure(null);
    try {
      const result = await correctFounderField(spec.id, draft.trim() || null, reason);
      onChanged(result.settings);
      setReason('');
      setOpen(false);
    } catch (error: unknown) {
      setFailure(refusalText(error, 'We could not save that. Nothing has changed.'));
    } finally {
      setBusy(false);
    }
  }, [spec.id, draft, reason, onChanged]);

  return (
    <li className="fd-set__field">
      <div className="fd-set__row">
        <div>
          <span className="fd-set__label">{spec.label}</span>
          <span className="fd-set__value">{value ?? 'Not set'}</span>
        </div>
        {open ? null : (
          <Button
            tier="secondary"
            onClick={() => {
              setDraft(value ?? '');
              setOpen(true);
            }}
          >
            Change {spec.label.toLowerCase()}
          </Button>
        )}
      </div>

      {spec.help ? <p className="fd-set__help">{spec.help}</p> : null}

      {open ? (
        <div className="fd-set__edit">
          {/* The consequence is stated BEFORE the change rather than discovered
              after it. §5.2 names both of these fields, so neither is refused —
              what differs is that changing one of them moves something else. */}
          {spec.consequence ? <p className="fd-set__consequence">{spec.consequence}</p> : null}
          {failure ? <p role="alert">{failure}</p> : null}

          <Field label={spec.label} id={`set-${spec.id}`}>
            <Input value={draft} onChange={(event) => setDraft(event.currentTarget.value)} />
          </Field>
          <Field label="Why is this changing?" id={`set-${spec.id}-reason`}>
            <Textarea
              rows={2}
              value={reason}
              onChange={(event) => setReason(event.currentTarget.value)}
            />
          </Field>
          <p className="fd-set__help">{FOUNDER_SETTINGS_REASON_IS_RECORDED}</p>

          <div className="fd-set__acts">
            <Button onClick={() => void save()} disabled={busy || reason.trim() === ''}>
              Save this change
            </Button>
            <Button
              tier="tertiary"
              onClick={() => {
                setOpen(false);
                setFailure(null);
                setReason('');
              }}
            >
              Leave it as it is
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

/* ── §5.2's password ──────────────────────────────────────────────────────── */

function PasswordSection() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const save = useCallback(async () => {
    setBusy(true);
    setFailure(null);
    try {
      await changeFounderPassword(current, next);
      setCurrent('');
      setNext('');
      setDone(true);
    } catch (error: unknown) {
      setFailure(refusalText(error, 'That did not work. Nothing has changed.'));
    } finally {
      setBusy(false);
    }
  }, [current, next]);

  return (
    <section aria-labelledby="set-password" className="fd-set__block">
      <h2 className="h3" id="set-password">
        Password
      </h2>
      <p className="fd-set__rule">{PASSWORD_CHANGE_REVOKES_OTHER_SESSIONS}</p>

      {done ? (
        <StatePanel
          state="Your password has changed"
          whatHappened="This browser is still signed in. Everywhere else has been signed out."
          next="Use the new password next time you sign in."
          owner="You"
          nextUpdate="Nothing further is scheduled"
          action={NO_ACTION}
          reference="Your account"
          getHelp={{ href: supportMailto('Password') }}
        />
      ) : (
        <>
          {failure ? <p role="alert">{failure}</p> : null}
          <Field label="Your password now" id="set-pw-current">
            <Input
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(event) => setCurrent(event.currentTarget.value)}
            />
          </Field>
          <Field label="Your new password" id="set-pw-next">
            <Input
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(event) => setNext(event.currentTarget.value)}
            />
          </Field>
          <p className="fd-set__help">{PASSWORD_CHANGE_NEEDS_CURRENT}</p>
          <div className="fd-set__acts">
            <Button
              onClick={() => void save()}
              disabled={busy || current === '' || next === ''}
            >
              Change my password
            </Button>
            {/* §5.5 ships and stays. It is a PUBLIC ask, because somebody who
                cannot sign in cannot reach this page — so this is a link to it
                rather than a second reset mechanism. */}
            <RouterLink to="/reset-password">Reset it by email instead</RouterLink>
          </div>
        </>
      )}

      <p className="fd-absence">{settingsAbsence('sign_in_email_change').absentBecause}</p>
    </section>
  );
}

/* ── §5.2's delete-account request ────────────────────────────────────────── */

function CloseAccount({
  view,
  onChanged,
}: {
  view: FounderSettingsView;
  onChanged: (next: FounderSettingsView) => void;
}) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const send = useCallback(async () => {
    setBusy(true);
    setFailure(null);
    try {
      const result = await requestFounderDeletion(detail);
      onChanged(result.settings);
      setDetail('');
      setOpen(false);
    } catch (error: unknown) {
      setFailure(refusalText(error, 'We could not record that. Nothing has changed.'));
    } finally {
      setBusy(false);
    }
  }, [detail, onChanged]);

  return (
    <section aria-labelledby="set-close" className="fd-set__block">
      <h2 className="h3" id="set-close">
        Close your account
      </h2>
      {/* §1.4. It rides the control rather than sitting under it: somebody who
          reads "close my account" and nothing else will believe their records
          are gone, and the next tax document they receive is the correction. */}
      <p className="fd-set__rule">{FOUNDER_DELETION_IS_RECORDED_NOT_EXECUTED}</p>

      {view.deletionRequestedAt ? (
        <StatePanel
          state="Your request is with Proovd"
          whatHappened={`You asked on ${localDate(view.deletionRequestedAt)}. Nothing has been deleted and nothing about your campaign has changed.`}
          next="A person reads it and answers you. Asking again does not make it move faster."
          owner="Proovd"
          nextUpdate="When Proovd answers"
          action={NO_ACTION}
          reference="Your account"
          getHelp={{ href: supportMailto('Account closure') }}
        />
      ) : open ? (
        <>
          {failure ? <p role="alert">{failure}</p> : null}
          <Field label="What are you asking for?" id="set-close-detail">
            <Textarea
              rows={3}
              value={detail}
              onChange={(event) => setDetail(event.currentTarget.value)}
            />
          </Field>
          <div className="fd-set__acts">
            <Button onClick={() => void send()} disabled={busy || detail.trim() === ''}>
              Send this to Proovd
            </Button>
            <Button tier="tertiary" onClick={() => setOpen(false)}>
              Never mind
            </Button>
          </div>
        </>
      ) : (
        <Button tier="secondary" onClick={() => setOpen(true)}>
          Ask Proovd to close my account
        </Button>
      )}

      <p className="fd-absence">{settingsAbsence('delete_executes').absentBecause}</p>
    </section>
  );
}

/* ── The page ─────────────────────────────────────────────────────────────── */

export function SettingsPage() {
  const [view, setView] = useState<FounderSettingsView | null>(null);
  const [payouts, setPayouts] = useState<PayoutState | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const [settings, payoutState] = await Promise.all([
          fetchFounderSettings(),
          fetchPayouts('founder').catch(() => null),
        ]);
        if (!live) return;
        setView(settings.settings);
        setPayouts(payoutState?.payouts ?? null);
      } catch (error: unknown) {
        if (live) setFailure(refusalText(error, 'We could not load your account.'));
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const startOnboarding = useCallback(async () => {
    const { url } = await requestOnboardingLink('founder');
    window.location.assign(url);
  }, []);

  if (loading) return <SurfaceLoading subject="your account" reference="Your account" />;

  if (failure || !view) {
    return (
      <Section aria-labelledby="set-error">
        <Measure>
          <h1 className="h2" id="set-error">
            We could not load your account
          </h1>
          <StatePanel
            state="We could not load your account"
            whatHappened={`${failure ?? 'The server did not return your record.'} Nothing about your account has changed.`}
            next="Reload the page. Your campaign, your payments, and the emails you receive are all unaffected."
            owner="Proovd"
            nextUpdate="As soon as you reload"
            action={NO_ACTION}
            reference="Your account"
            getHelp={{ href: supportMailto('Account settings') }}
          />
        </Measure>
      </Section>
    );
  }

  const valueOf = (id: string): string | null =>
    view.fields.find((field) => field.id === id)?.value ?? null;

  const photo = FOUNDER_SETTINGS_ITEMS.find((item) => item.id === 'profile_photo');

  return (
    <Section aria-labelledby="set-heading" className="fd-set">
      <Measure>
        <h1 className="h2" id="set-heading">
          Your account
        </h1>
        <p className="fd-set__kicker">
          {SETTINGS_READS_THE_CURRENT_RECORD}
          {view.campaignTitle ? ` — ${view.campaignTitle}` : ''}
        </p>

        {/* ── You ─────────────────────────────────────────────────────────── */}
        <section aria-labelledby="set-you" className="fd-set__block">
          <h2 className="h3" id="set-you">
            You
          </h2>
          <ul className="fd-set__fields">
            {SPECS.map((spec) => (
              <SettingsField
                key={spec.id}
                spec={spec}
                value={valueOf(spec.id)}
                onChanged={setView}
              />
            ))}
          </ul>
          <p className="fd-absence">{settingsAbsence('account_name_edit').absentBecause}</p>
        </section>

        {/* ── What you confirmed ──────────────────────────────────────────── */}
        <section aria-labelledby="set-confirmed" className="fd-set__block">
          <h2 className="h3" id="set-confirmed">
            What you confirmed
          </h2>
          <ul className="fd-set__confirmations">
            {view.representations.map((fact) => (
              <li key={fact.id}>
                <span className="fd-set__label">{fact.label}</span>
                <Tag variant={fact.confirmed ? 'moss' : 'default'}>
                  {fact.confirmed ? 'Confirmed' : 'Not confirmed'}
                </Tag>
              </li>
            ))}
            <li>
              <span className="fd-set__label">Date of birth</span>
              {/* Presence only. A birthday printed on a page somebody screen-
                  shares is a fact leaving for no reason (§25.5), and nothing
                  here needs the value. */}
              <span className="fd-set__value">
                {view.dateOfBirthOnFile ? 'On file' : 'Not on file'}
              </span>
            </li>
            <li>
              <span className="fd-set__label">Where you are</span>
              <span className="fd-set__value">
                {[view.stateRegion, view.country].filter(Boolean).join(', ') || 'Not set'}
              </span>
            </li>
          </ul>
          <p className="fd-absence">{settingsAbsence('representation_toggles').absentBecause}</p>
        </section>

        <PasswordSection />

        {/* ── Payouts and identity ────────────────────────────────────────── */}
        <section aria-labelledby="set-payouts" className="fd-set__block">
          <h2 className="h3" id="set-payouts">
            Getting paid
          </h2>
          <p className="fd-set__rule">{KYC_IS_STRIPES_RECORD}</p>
          {payouts ? (
            <PayoutOnboarding payouts={payouts} role="founder" onStart={startOnboarding} />
          ) : (
            <p className="fd-set__help">
              We could not read your payout account just now. Nothing about it has changed — reload
              to try again.
            </p>
          )}
          <p className="fd-absence">{settingsAbsence('kyc_documents').absentBecause}</p>
        </section>

        {/* ── W-9 ─────────────────────────────────────────────────────────── */}
        <section aria-labelledby="set-w9" className="fd-set__block">
          <h2 className="h3" id="set-w9">
            W-9
          </h2>
          <p className="fd-set__rule">{W9_IS_PER_CAMPAIGN}</p>
          {view.w9 ? (
            <>
              {/* §33.8.13: the resolver's own line and action, rendered. This
                  page composes no §22.3 sentence of its own — Chapter 3, the
                  Admin queue, and every §22.3 email render the same two. */}
              <p className="fd-set__value">{view.w9.line}</p>
              <p className="fd-set__help">{view.w9.action}</p>
            </>
          ) : (
            <p className="fd-set__help">{view.w9NotApplicableBecause}</p>
          )}
          <p className="fd-absence">{settingsAbsence('w9_upload').absentBecause}</p>
        </section>

        {/* ── Notifications ───────────────────────────────────────────────── */}
        <div className="fd-set__block">
          <p className="fd-set__rule">{FOUNDER_TRANSACTIONAL_IS_NOT_OPTIONAL}</p>
          {/* Phase 22c's page, absorbed whole rather than reimplemented — one
              digest control and one history, and the same failure state. */}
          <NotificationSettings role="founder" embedded />
          <p className="fd-absence">{settingsAbsence('per_topic_toggles').absentBecause}</p>
        </div>

        {/* ── Profile photo ───────────────────────────────────────────────── */}
        <section aria-labelledby="set-photo" className="fd-set__block">
          <h2 className="h3" id="set-photo">
            Profile photo
          </h2>
          {/* §5.2 names it and there is nowhere to put one. Rendered as its own
              named absence rather than dropped from the page: a settings page
              missing one of §5.2's names reads as a page that forgot. */}
          <p className="fd-absence">{photo?.absentBecause}</p>
        </section>

        <CloseAccount view={view} onChanged={setView} />
      </Measure>
    </Section>
  );
}
