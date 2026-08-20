/**
 * The preparing Campaign kit — Spec §10, §31.5, §14.1, §33.2.4.
 *
 * §10 grants exactly one thing at this stage: the right to *read*. The Creator
 * may read the currently available Founder, Problem, Solution, and Competition
 * information plus the single Campaign kit, and nothing else.
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
 *
 * ── The LIST that used to be here is Session E's `CreatorPitches` ───────────
 * Phase 08c's single list of campaigns, and the sign-in form it fell back to,
 * were replaced on 2026-08-20 by the `Active`/`Pitches` surface at the same
 * address. The sign-in went with it: `/creator/campaigns` has been inside
 * `RequireRole allow={['affiliate']}` with its own `signInPath` since Session D,
 * so a second credential form on the page behind that guard was unreachable.
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import {
  Button,
  Card,
  Measure,
  NO_ACTION,
  Section,
  StatePanel,
  Tag,
} from '../../components/index.js';
import { supportMailto } from '../../features/public/states.js';
import { fetchPreparingKit, CreatorRequestError, type PreparingKit } from './api.js';

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

      {/* Legacy records only: the simplified flow (2026-08-10) no longer asks
          the Founder for a competition answer, so a card promising one "yet"
          would be waiting for something that will never arrive (§1.4). A
          record that has one still shows it. */}
      {kit.competition ? (
        <Card>
          <h2>The competition</h2>
          <p>{kit.competition}</p>
        </Card>
      ) : null}

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
