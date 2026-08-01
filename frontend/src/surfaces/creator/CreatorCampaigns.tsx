/**
 * The signed-in Creator's campaigns and the preparing Campaign kit —
 * Spec §10, §31.5, §14.1, §33.2.4.
 *
 * §10 grants exactly one thing at this stage: the right to *read*. The named
 * campaign appears in `preparing`, with one action — `Review campaign` — and
 * the Creator may read the currently available Founder, Problem, Solution, and
 * Competition information plus the single Campaign kit.
 *
 * ── What this surface must never offer ──────────────────────────────────────
 * §10: the Creator "cannot accept, decline, propose compensation, activate a
 * link, or begin work until listing-fee payment makes the formal opportunity
 * actionable." So there is no accept control, no decline control, no
 * compensation input, and no tracking link on this page — not disabled ones,
 * absent ones. §33.2.4 is partly the fact that they cannot be reached.
 *
 * ── The confidentiality terms travel with the content ───────────────────────
 * §31.5 grants this pre-view "before agreement" and requires the per-campaign
 * IP and confidentiality agreement "before work". A Creator reading a Founder's
 * unreleased product information has signed nothing, so the surface says what
 * that means, in the same view as the material rather than behind a link.
 *
 * ── One kit ─────────────────────────────────────────────────────────────────
 * §14.1: "All material lives in one Campaign kit", and §30 defers a reusable
 * resource library. One page, staged Glance → Act → Explore (DNA §5.14).
 *
 * ── Absences are named, not hidden ──────────────────────────────────────────
 * Most of §14.1's kit does not exist yet — the campaign is unbuilt, the listing
 * fee unpaid, the high-effort result uncomputed. Rendering empty sections would
 * read as a campaign offering nothing rather than one that is early, so the
 * server returns the list of what is missing and why, and this renders it.
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import {
  Button,
  Card,
  Field,
  Input,
  Measure,
  NO_ACTION,
  Section,
  StatePanel,
  Tag,
} from '../../components/index.js';
import { supportMailto } from '../../features/public/states.js';
import {
  fetchCreatorCampaigns,
  fetchPreparingKit,
  creatorSignIn,
  creatorSignOut,
  CreatorRequestError,
  type CreatorCampaign,
  type PreparingKit,
} from './api.js';

/**
 * §31.5, said to the person it binds.
 *
 * The same promise the notification carries, in the same words. A Creator who
 * read it in an email and something different on the page would reasonably
 * wonder which one holds.
 */
export const CONFIDENTIALITY_TERMS =
  'What you can read here is confidential. It is the Founder’s unreleased product ' +
  'information, shared with you early and in confidence because Proovd recruited you for ' +
  'this campaign. Please do not share it, post about it, or use it for anything else. ' +
  'Every time you open it we record that you did, and we can withdraw access at any time.';

/** §10: no work permission until the opportunity is formally actionable. */
export const NO_WORK_YET =
  'Reading this is not accepting it. You cannot accept, decline, or propose terms yet, and ' +
  'no promotion should start before the campaign formally opens. We will email you then.';

/* ── The list ─────────────────────────────────────────────────────────────── */

export function CreatorCampaigns() {
  const [state, setState] = useState<
    { status: 'loading' } | { status: 'signed_out' } | { status: 'ready'; rows: CreatorCampaign[] }
  >({ status: 'loading' });

  const load = useCallback(async () => {
    try {
      const { campaigns } = await fetchCreatorCampaigns();
      setState({ status: 'ready', rows: campaigns });
    } catch {
      setState({ status: 'signed_out' });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.status === 'loading') {
    return (
      <Measure>
        <StatePanel
          state="Loading your campaigns"
          whatHappened="Proovd is checking which campaigns you are part of."
          next="They appear as soon as that comes back."
          owner="Proovd"
          nextUpdate="Within a few seconds"
          action={NO_ACTION}
          reference="Your campaigns"
        />
      </Measure>
    );
  }

  if (state.status === 'signed_out') return <CreatorSignIn onSignedIn={load} />;

  return (
    <Measure>
      <Section>
        <h1>Your campaigns</h1>
        <p>
          Proovd recruits Creators for one campaign at a time. Everything you are part of is
          here.
        </p>
      </Section>

      {state.rows.length === 0 ? (
        <StatePanel
          state="Nothing here yet"
          whatHappened="You are not part of any campaign that is ready to read."
          next="We will email you as soon as one is."
          owner="Proovd"
          nextUpdate="When a campaign is ready"
          action={NO_ACTION}
          reference="Your campaigns"
        />
      ) : (
        state.rows.map((row) => <CampaignRow key={row.associationId} row={row} />)
      )}

      <Button tier="tertiary" onClick={() => void creatorSignOut().then(load)}>
        Sign out
      </Button>
    </Measure>
  );
}

function CampaignRow({ row }: { row: CreatorCampaign }) {
  const navigate = useNavigate();
  const name = row.productName ?? 'A campaign';

  if (row.revoked) {
    // §10: revocation removes access immediately. The campaign still appears —
    // a row that silently vanished would be more alarming than one that says
    // what happened — but it carries no action.
    return (
      <StatePanel
        state={`${name} is no longer available to you`}
        whatHappened="Your access to this campaign was withdrawn."
        next="Nothing you did necessarily caused this. Reply to the email we sent you and we will explain."
        owner="Proovd"
        nextUpdate="When you contact us"
        action={NO_ACTION}
        reference={row.campaignId}
        getHelp={{ href: supportMailto(`Campaign access — ${row.campaignId}`) }}
      />
    );
  }

  if (!row.reviewAvailable) {
    return (
      <StatePanel
        state={`${name} is still being prepared`}
        whatHappened="The Founder is finishing their setup, so there is nothing to read yet."
        next="Proovd owns this step. We will email you as soon as it is ready."
        owner="Proovd"
        nextUpdate="When the campaign is ready to read"
        action={NO_ACTION}
        reference={row.campaignId}
      />
    );
  }

  return (
    <Card>
      <Tag variant="mint">Preparing</Tag>
      <h2>{name}</h2>
      <p className="field-hint">
        Ready for you to read. Nothing to decide yet.
      </p>
      {/* §10's ONE action. */}
      <div className="claim__actions">
        <Button
          tier="primary"
          onClick={() => void navigate(`/creator/campaigns/${row.associationId}`)}
        >
          Review campaign
        </Button>
      </div>
    </Card>
  );
}

/* ── Sign-in (§5.3: email + password, no second factor) ───────────────────── */

/** One refusal for every credential failure, for §5.5's non-enumeration rule. */
const CREDENTIAL_REFUSAL =
  'That email address and password combination was not accepted. Nothing about the account is confirmed or denied by this message.';

function CreatorSignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await creatorSignIn(email.trim(), password);
      onSignedIn();
    } catch {
      // §5.3 gives the Affiliate email + password only — there is no second
      // factor here, and §5.1's mandatory MFA is Admin's rule. Requiring one
      // would lock out every Creator who has already signed up.
      setError(CREDENTIAL_REFUSAL);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Measure>
      <Section>
        <h1>Sign in</h1>
        <p>Use the email address and password you set when you created your account.</p>
      </Section>

      <Card>
        <form className="admin-form" onSubmit={submit} noValidate>
          <Field label="Email">
            <Input
              type="email"
              value={email}
              autoComplete="username"
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>
          <Field label="Password" {...(error ? { error } : {})}>
            <Input
              type="password"
              value={password}
              autoComplete="current-password"
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
          <Button tier="primary" type="submit" disabled={busy || !email || !password}>
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </Card>
    </Measure>
  );
}

/* ── The kit (§10, §14.1's preparing subset, §31.5) ───────────────────────── */

export function CreatorCampaignKit() {
  const { associationId = '' } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'refused'; title: string; whatHappened: string; next: string }
    | { status: 'ready'; kit: PreparingKit }
  >({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { kit } = await fetchPreparingKit(associationId);
        if (!cancelled) setState({ status: 'ready', kit });
      } catch (caught) {
        if (cancelled) return;
        if (caught instanceof CreatorRequestError) {
          setState({
            status: 'refused',
            title: caught.detail.title,
            whatHappened: caught.detail.whatHappened ?? 'This campaign is not available to you.',
            next: caught.detail.next ?? 'Go back to your campaigns.',
          });
        } else {
          setState({
            status: 'refused',
            title: 'This campaign is not available',
            whatHappened: 'Proovd could not open it.',
            next: 'Go back to your campaigns and try again.',
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [associationId]);

  if (state.status === 'loading') {
    return (
      <Measure>
        <StatePanel
          state="Opening the campaign"
          whatHappened="Proovd is checking your access."
          next="It appears as soon as that comes back."
          owner="Proovd"
          nextUpdate="Within a few seconds"
          action={NO_ACTION}
          reference="Campaign kit"
        />
      </Measure>
    );
  }

  if (state.status === 'refused') {
    return (
      <Measure>
        <StatePanel
          state={state.title}
          whatHappened={state.whatHappened}
          next={state.next}
          owner="Proovd"
          nextUpdate="When you contact us"
          action={
            <Button tier="secondary" onClick={() => void navigate('/creator/campaigns')}>
              Back to your campaigns
            </Button>
          }
          reference={associationId}
          getHelp={{ href: supportMailto('Campaign access') }}
          ring
        />
      </Measure>
    );
  }

  const { kit } = state;

  return (
    <Measure>
      <Section>
        <Tag variant="mint">Preparing</Tag>
        <h1>{kit.productName ?? 'This campaign'}</h1>
        {kit.campaignType ? <p className="field-hint">{kit.campaignType}</p> : null}
      </Section>

      {/* §31.5 and §10, before the material rather than after it. */}
      <StatePanel
        state="You can read this, and nothing more yet"
        whatHappened={NO_WORK_YET}
        next={CONFIDENTIALITY_TERMS}
        owner="Proovd"
        nextUpdate="We will email you when the campaign formally opens."
        action={NO_ACTION}
        reference={kit.campaignId}
        getHelp={{ href: supportMailto(`Campaign kit — ${kit.campaignId}`) }}
      />

      <Card>
        <h2>The Founder</h2>
        <dl className="kv">
          <Row label="Name">{kit.founder.name ?? 'Not recorded yet'}</Row>
          <Row label="Selling as">
            {kit.founder.soleProprietor === true
              ? 'A sole proprietor — the Founder personally'
              : (kit.founder.entity ?? 'Not recorded yet')}
          </Row>
        </dl>
        {/* §30 defers direct Founder–Affiliate messaging, in both directions.
            There is no contact control here and no address to build one from. */}
        <p className="field-hint">
          Questions about the campaign go through Proovd, not directly to the Founder.
        </p>
      </Card>

      <Card>
        <h2>The problem</h2>
        <p>{kit.problem ?? 'The Founder has not written this yet.'}</p>
      </Card>

      <Card>
        <h2>The solution</h2>
        <p>{kit.solution ?? 'The Founder has not written this yet.'}</p>
      </Card>

      <Card>
        <h2>The competition</h2>
        <p>{kit.competition ?? 'The Founder has not written this yet.'}</p>
      </Card>

      {/* Naming the absences, rather than rendering empty sections. */}
      <Card>
        <h2>Not decided yet</h2>
        <p className="field-hint">
          This campaign is early. These are the parts that do not exist yet, and why.
        </p>
        <dl className="kv">
          {kit.notYetAvailable.map((entry) => (
            <Row key={entry.item} label={entry.item}>
              {entry.because}
            </Row>
          ))}
        </dl>
      </Card>

      <Button tier="tertiary" onClick={() => void navigate('/creator/campaigns')}>
        Back to your campaigns
      </Button>
    </Measure>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="kv__row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
