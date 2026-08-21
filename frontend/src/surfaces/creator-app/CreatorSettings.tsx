/**
 * The Creator's settings — Creator Flow v2, Session F, 2026-08-20.
 *
 * ═══ NOT A DEVIATION. §5.3 AS WRITTEN, AND IT CLOSES A REAL GAP ═════════════
 *
 * §5.3 lists the settings a Creator may change and **none of it has been
 * editable after the claim**: `saveSignupProfile` hard-refuses once `claimed_at`
 * is set and no session-authenticated route wrote the profile at all — so
 * `requestAffiliateCorrection` has been emailing Creators since 2026-08-17
 * asking them to correct something they had no route to correct.
 *
 * ── Every save carries a reason, and that is the design ───────────────────
 * The profile has no history table, so the reason IS the history. It is the
 * Admin correction path's discipline applied to the person's own record, and
 * `SETTINGS_REASON_IS_RECORDED` says why rather than leaving it as friction
 * somebody removes later as a courtesy.
 *
 * ── Two fields are guarded, and neither is refused ────────────────────────
 * `legal_name` is the identity Stripe was given and `email` is where every
 * transactional message goes. Both are editable — §5.3 names them — and both
 * state the consequence before the change rather than after it.
 *
 * ── The reference's three notification switches are refused ───────────────
 * `New pitches` / `Campaign updates` / `Payouts`. §27.2's first rule is that
 * transactional email is not opt-out-able, and `Payouts` is the most
 * transactional message a Creator receives. What renders instead is §27.7's
 * digest control — the one opt-out-able thing in the product — and the
 * notification history, at their own address.
 */

import { useEffect, useState } from 'react';
import {
  CREATOR_DELETION_IS_RECORDED_NOT_EXECUTED,
  CREATOR_SETTINGS_GUARDED,
  CREATOR_SETTINGS_FIELDS,
  POLICY_DOCUMENTS,
  SETTINGS_IS_WHAT_FOUNDERS_SEE,
  SETTINGS_REASON_IS_RECORDED,
  SETTINGS_TRANSACTIONAL_IS_NOT_OPTIONAL,
} from '@proovd/shared';
import {
  Button,
  Card,
  Field,
  Input,
  NO_ACTION,
  StatePanel,
  Tag,
  Textarea,
} from '../../components/index.js';
import { supportMailto } from '../../features/public/states.js';
import { NotificationSettings } from '../notifications/NotificationSettings.js';
import {
  CreatorRequestError,
  fetchCreatorSettings,
  requestAccountDeletion,
  saveCreatorSetting,
  type CreatorSettingsField,
  type CreatorSettingsView,
} from '../creator/api.js';

/** §11's source label, in words. `null` is a field that never carried one. */
const SUPPLIER_LABELS: Record<string, string> = {
  proovd: 'Proovd wrote this from our own research',
  affiliate: 'You wrote this',
};

const HELP: Record<string, string | undefined> = Object.fromEntries(
  CREATOR_SETTINGS_FIELDS.map((f) => [f.id, f.help]),
);

const CONSEQUENCE: Record<string, string> = Object.fromEntries(
  CREATOR_SETTINGS_GUARDED.map((f) => [f.id, f.consequence]),
);

const POLICY_TITLES: Record<string, string> = Object.fromEntries(
  POLICY_DOCUMENTS.map((d) => [d.slug, d.title]),
);

export function CreatorSettings() {
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'error'; title: string; message: string }
    | { status: 'ready'; settings: CreatorSettingsView }
  >({ status: 'loading' });
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { settings } = await fetchCreatorSettings();
        if (!cancelled) setState({ status: 'ready', settings });
      } catch (caught) {
        if (cancelled) return;
        const detail = caught instanceof CreatorRequestError ? caught.detail : null;
        setState({
          status: 'error',
          title: detail?.title ?? 'This could not be loaded',
          message: detail?.whatHappened ?? 'Your settings could not be loaded.',
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === 'loading') {
    return (
      <div className="cra-page">
        <StatePanel
          state="Loading your settings"
          whatHappened="Proovd is gathering your profile, your agreements, and your account."
          next="It appears in a moment."
          owner="Proovd"
          nextUpdate="Within a few seconds"
          action={NO_ACTION}
          reference="Your account"
        />
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="cra-page">
        <StatePanel
          state={state.title}
          whatHappened={state.message}
          next="Ask us and somebody will change it for you."
          owner="Proovd"
          nextUpdate="No update pending"
          action={
            <Button tier="secondary" href="/creator/home">
              Back to your home
            </Button>
          }
          reference="Your account"
          getHelp={{ href: supportMailto('My settings') }}
        />
      </div>
    );
  }

  const s = state.settings;

  return (
    <div className="cra-page">
      <header className="cra-page__head">
        <h1>Your account</h1>
        <p className="cra-lede">{SETTINGS_IS_WHAT_FOUNDERS_SEE}</p>
        {notice ? (
          <p role="status" className="cra-notice">
            {notice}
          </p>
        ) : null}
      </header>

      <Card>
        <h2>Your profile</h2>
        <p className="cra-help">{SETTINGS_REASON_IS_RECORDED}</p>
        {s.fields.map((field) => (
          <EditableField
            key={field.id}
            field={field}
            onSaved={(settings) => {
              setState({ status: 'ready', settings });
              setNotice(`${field.label} saved.`);
            }}
          />
        ))}
      </Card>

      <Card>
        <h2>Your channel</h2>
        <p>
          {s.channelSubtype ? (
            <Tag variant="mint">{s.channelSubtype.replace(/_/g, ' ')}</Tag>
          ) : (
            'Not classified yet'
          )}
        </p>
        {/* The subtype is Admin's §5.3 classification and the evidence on file
            was recorded against it. A Creator flipping it here would silently
            invalidate a verification, so it is shown and not editable. */}
        <p className="cra-help">
          How Proovd classified your channel, from the evidence you sent. If it is wrong, tell us —
          changing it means looking at the evidence again, so it is not something to change on your
          own.
        </p>
      </Card>

      <Card>
        <h2>Getting paid</h2>
        <dl className="kv">
          <div className="kv__row">
            <dt>Payout account</dt>
            <dd>
              {s.payout.accountPresent
                ? s.payout.payoutsEnabled
                  ? 'Ready'
                  : 'Set up, not finished'
                : 'Not set up yet'}
            </dd>
          </div>
        </dl>
        <p className="cra-help">
          Your bank details, your tax form, and your payout schedule live with Stripe. Proovd holds a
          status and an account number and nothing else.
        </p>
        {/*
          There is deliberately no control here, and that is a recorded gap
          rather than a decision. Until 2026-08-21 this rendered a button to
          `/creator/payouts`, which has never been a route — so it did not open
          payout setup, it rendered the 404 surface. The backend half exists and
          is tested (`CREATOR_PAYOUTS_PATH`, `routes/payouts.ts`); what is
          missing is a signed-in Creator surface to render `PayoutOnboarding`
          against it, the way the Founder's own settings page already does.

          Removing the control rather than pointing it somewhere plausible is
          §1.4: the status above is true and useful on its own, and a button
          that goes to the wrong place is worse than no button. The one place a
          Creator can currently reach onboarding is the invitation flow's last
          screen, which renders `PayoutOnboarding` against the token-addressed
          endpoint.
        */}
      </Card>

      <Card>
        <h2>What you have signed</h2>
        {s.signed.length === 0 ? (
          <p className="cra-help">Nothing recorded yet.</p>
        ) : (
          <dl className="kv">
            {s.signed.map((doc) => (
              <div className="kv__row" key={`${doc.label}-${doc.acceptedAt}`}>
                <dt>{POLICY_TITLES[doc.label] ?? doc.label}</dt>
                <dd>
                  {doc.version ? `Version ${doc.version} · ` : ''}
                  {new Date(doc.acceptedAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </Card>

      <Card>
        <h2>Your password</h2>
        <p className="cra-help">
          Changing a password goes through the same route as forgetting one — we email you a link, so
          somebody with your open laptop cannot change it.
        </p>
        {/* `/reset-password` is the route (`routes.tsx`); `/forgot-password`
            was never one and rendered the 404 surface. */}
        <Button tier="secondary" href="/reset-password">
          Send me a password link
        </Button>
      </Card>

      <Card>
        <h2>Email</h2>
        <p className="cra-help">{SETTINGS_TRANSACTIONAL_IS_NOT_OPTIONAL}</p>
      </Card>

      {/* §27.7's real control and the notification history, at their own
          address — the one opt-out-able thing in the product. */}
      <NotificationSettings role="creator" embedded />

      <DeleteAccount
        requestedAt={s.deletionRequestedAt}
        onFiled={(settings) => {
          setState({ status: 'ready', settings });
          setNotice('We have your request. Somebody will read it.');
        }}
      />
    </div>
  );
}

function EditableField({
  field,
  onSaved,
}: {
  field: CreatorSettingsField;
  onSaved: (settings: CreatorSettingsView) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(field.value ?? '');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!editing) {
    return (
      <div className="cra-setting">
        {/*
          One label column across every row. A `dl.kv` per row sizes its own
          `minmax(8rem, max-content)`, so ten rows produced five different value
          x-positions — a column that is not a column. The browser pass is what
          found it.
        */}
        <div className="cra-setting__row">
          <span className="cra-setting__label">{field.label}</span>
          <span className="cra-setting__value">{field.value || 'Not set'}</span>
        </div>
        {field.supplier ? (
          <p className="cra-source">{SUPPLIER_LABELS[field.supplier] ?? field.supplier}</p>
        ) : null}
        {field.guarded ? <p className="cra-help">{CONSEQUENCE[field.id]}</p> : null}
        <Button
          tier="tertiary"
          onClick={() => {
            setValue(field.value ?? '');
            setReason('');
            setError(null);
            setEditing(true);
          }}
        >
          Change your {field.label.toLowerCase()}
        </Button>
      </div>
    );
  }

  return (
    <div className="cra-setting">
      <Field label={field.label} {...(HELP[field.id] ? { hint: HELP[field.id]! } : {})}>
        <Input value={value} onChange={(event) => setValue(event.target.value)} />
      </Field>
      <Field label="Why it is changing" hint={SETTINGS_REASON_IS_RECORDED}>
        <Textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={2} />
      </Field>
      {error ? (
        <p role="alert" className="cra-error">
          {error}
        </p>
      ) : null}
      <div className="cra-acts">
        <Button
          disabled={busy || !value.trim() || !reason.trim()}
          onClick={() => {
            void (async () => {
              setBusy(true);
              setError(null);
              try {
                const { settings } = await saveCreatorSetting(field.id, {
                  value: value.trim(),
                  reason: reason.trim(),
                });
                setEditing(false);
                onSaved(settings);
              } catch (caught) {
                const detail = caught instanceof CreatorRequestError ? caught.detail : null;
                setError(detail?.whatHappened ?? 'That could not be saved.');
              } finally {
                setBusy(false);
              }
            })();
          }}
        >
          Save your {field.label.toLowerCase()}
        </Button>
        <Button tier="tertiary" onClick={() => setEditing(false)}>
          Leave it as it is
        </Button>
      </div>
    </div>
  );
}

/**
 * §5.3's delete-account request.
 *
 * Recorded, never executed — there is no `deleted_at`, no purge schedule, and
 * no approval state on the record, because §25.8's retention obligations do not
 * end because somebody clicked a button. Saying that here is what stops the
 * control being read as one that erases anything.
 */
function DeleteAccount({
  requestedAt,
  onFiled,
}: {
  requestedAt: string | null;
  onFiled: (settings: CreatorSettingsView) => void;
}) {
  const [detail, setDetail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (requestedAt) {
    return (
      <Card>
        <h2>You asked us to close your account</h2>
        <p>
          Recorded on{' '}
          {new Date(requestedAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}. Somebody
          reads every one of these.
        </p>
        <p className="cra-help">{CREATOR_DELETION_IS_RECORDED_NOT_EXECUTED}</p>
      </Card>
    );
  }

  return (
    <Card>
      <h2>Closing your account</h2>
      <p className="cra-help">{CREATOR_DELETION_IS_RECORDED_NOT_EXECUTED}</p>
      <Field label="What you want us to do" hint="In your own words.">
        <Textarea value={detail} onChange={(event) => setDetail(event.target.value)} rows={3} />
      </Field>
      {error ? (
        <p role="alert" className="cra-error">
          {error}
        </p>
      ) : null}
      <Button
        tier="secondary"
        disabled={busy || !detail.trim()}
        onClick={() => {
          void (async () => {
            setBusy(true);
            setError(null);
            try {
              const { settings } = await requestAccountDeletion(detail.trim());
              onFiled(settings);
            } catch (caught) {
              const caughtDetail = caught instanceof CreatorRequestError ? caught.detail : null;
              setError(caughtDetail?.whatHappened ?? 'That could not be recorded.');
            } finally {
              setBusy(false);
            }
          })();
        }}
      >
        Ask Proovd to close my account
      </Button>
    </Card>
  );
}
