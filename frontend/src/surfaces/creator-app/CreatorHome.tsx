/**
 * The Creator's home — Creator Flow v2 **deviation 5**, Session D, 2026-08-19.
 *
 * §20's rules for the Founder campaign home, applied by analogy because the
 * Spec gives no Creator equivalent. Each of them has a visible consequence
 * here:
 *
 *   * **One thing waiting, or the caught-up ending.** The hero is either the
 *     pitch count with `Review pitches`, or `CREATOR_HOME_CAUGHT_UP` with no
 *     control at all — the branch returns no button and there is nowhere in it
 *     for one to be added (§20's "show no manufactured CTA", DNA §5.4).
 *   * **Every number derived, or not shown.** A standing with no completed
 *     campaign behind it is `STANDING_NOT_ENOUGH_HISTORY` rather than a zero;
 *     a percentile with no cohort is absent rather than computed anyway; and
 *     `Backed` is stated as what people bought rather than as what was earned,
 *     because those are different numbers and only one is on this surface.
 *   * **Freshness is a time, never a claim about immediacy.** `GLANCE_FRESHNESS`
 *     is reused rather than a second wording minted, and the suite scans this
 *     surface for `BANNED_FRESHNESS_TERMS`.
 *
 * ── Nothing here decides anything ─────────────────────────────────────────
 * The standing tier binds nothing — `STANDING_BINDS_NOTHING` renders WITH the
 * block rather than below it, because somebody reading a tier will assume it
 * does something unless told otherwise, and the sentence that makes it honest
 * has to be where the number is.
 *
 * ── The three refused controls, and what renders in their place ───────────
 * `Pick your next campaign` implies a pool nobody has (`CREATOR_NO_CAMPAIGN_POOL`);
 * the referral's percentage is refused outright (`REFERRAL_PAYS_NOTHING`); and
 * the public join link does not exist (`REFERRAL_HAS_NO_PUBLIC_LINK`).
 * `CREATOR_APP_ABSENCES` records all of them and the suite walks the rendered
 * surface for each replacement sentence — so re-adding one means deleting the
 * sentence that says why it must not exist.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import {
  CREATOR_HOME_CAUGHT_UP,
  CREATOR_HOME_CAUGHT_UP_BODY,
  CREATOR_HOME_LEADERBOARD_TITLE,
  CREATOR_HOME_REFERRAL_TITLE,
  CREATOR_HOME_REVIEW_ACTION,
  CREATOR_HOME_STANDING_TITLE,
  CREATOR_HOME_TEAM_UP_TITLE,
  CREATOR_HOME_TRACK_RECORD_TITLE,
  CREATOR_HOME_WAITING_EYEBROW,
  CREATOR_NO_CAMPAIGN_POOL,
  CREATOR_REFERRAL_FIELDS,
  CREATOR_STANDING_INPUTS,
  CREATOR_STANDING_TASKS,
  CREATOR_STANDING_TIERS,
  CREATOR_TEAM_UP_IS_THE_FOUNDERS_ASK,
  CREATOR_TRACK_RECORD_ITEMS,
  GLANCE_FRESHNESS,
  REFERRAL_HAS_NO_PUBLIC_LINK,
  REFERRAL_IS_AN_INTRODUCTION,
  REFERRAL_PAYS_NOTHING,
  STANDING_BINDS_NOTHING,
  STANDING_HOW_IT_IS_WORKED_OUT,
  STANDING_LEADERBOARD_SHOWS_HANDLES_ONLY,
  STANDING_NOT_ENOUGH_HISTORY,
  creatorHomeGreeting,
  creatorPitchesWaitingHeadline,
} from '@proovd/shared';
import { Accordion } from '../../components/Accordion.js';
import { Button } from '../../components/Button.js';
import { Field } from '../../components/Input.js';
import { StatePanel } from '../../components/StatePanel.js';
import { SurfaceLoading } from '../../features/public/states.js';
import {
  CreatorRequestError,
  fetchCreatorHome,
  respondToWorkAgainRequest,
  saveCreatorReferral,
  type CreatorHomeView,
} from '../creator/api.js';

/** Integer cents in, a US amount out. The only arithmetic is a divide by 100. */
function usd(cents: string): string {
  const value = Number(cents) / 100;
  return `US$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function tierLabel(id: string): string {
  return CREATOR_STANDING_TIERS.find((tier) => tier.id === id)?.label ?? id;
}

export function CreatorHome() {
  const [home, setHome] = useState<CreatorHomeView | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchCreatorHome()
      .then((body) => setHome(body.home))
      .catch((caught: unknown) =>
        setFailed(
          caught instanceof CreatorRequestError
            ? (caught.detail.whatHappened ?? 'We could not load your home.')
            : 'We could not load your home.',
        ),
      );
  }, []);

  useEffect(load, [load]);

  if (failed) {
    return (
      <>
        <div className="cra-page">
          {/* §27.1's six questions, on a failure. Nothing was lost, because
              nothing on this page is a draft — it is all a read. */}
          <StatePanel
            state="We could not load your home"
            whatHappened={failed}
            next="Reload the page. Nothing here is a draft, so nothing is lost."
            owner="Proovd"
            nextUpdate="As soon as the page loads."
            action={
              <Button tier="secondary" onClick={load}>
                Try again
              </Button>
            }
            reference="Your Creator account"
            getHelp={{ href: '/support' }}
          />
        </div>
      </>
    );
  }

  if (!home) {
    return (
      <>
        <div className="cra-page">
          <SurfaceLoading subject="your home" reference="Your Creator account" />
        </div>
      </>
    );
  }

  return (
    <>
      <div className="cra-page">
        <p className="cra-home__greeting">{creatorHomeGreeting(home.firstName)}</p>
        <Hero home={home} />
        <div className="cra-home__split">
          <div className="cra-home__main">
            <Standing home={home} />
            <TrackRecord home={home} />
            <TeamUp home={home} onAnswered={load} />
            <NextCampaign />
          </div>
          <div className="cra-home__side">
            <Leaders home={home} />
            <Referrals home={home} />
          </div>
        </div>
      </div>
    </>
  );
}

/**
 * §20's one Act, or its caught-up ending.
 *
 * The `h1` is the thing waiting rather than the page's name — DNA §5.1's hero,
 * and §33.11.2 is satisfied either way because both branches render exactly one.
 */
function Hero({ home }: { home: CreatorHomeView }) {
  const count = home.pitches.length;

  if (count === 0) {
    return (
      <section className="cra-hero cra-hero--calm" aria-labelledby="home-hero">
        <h1 id="home-hero" className="cra-hero__head">
          {CREATOR_HOME_CAUGHT_UP}
        </h1>
        {/* No control. §20: "show no manufactured CTA". Naming what happens
            next is not the same as offering something to do about it. */}
        <p className="cra-hero__body">{CREATOR_HOME_CAUGHT_UP_BODY}</p>
      </section>
    );
  }

  return (
    // `mode-dark`, not the reference's brand fill. A `.btn--primary` IS the
    // brand fill (proovd.css:158's hard rule), so a primary control on a brand
    // band is invisible — which the browser pass found. On dark it is white,
    // and the two hero states now differ in treatment as well as in content,
    // which is DNA §5.4's point about the done-moment.
    <section className="cra-hero mode-dark" aria-labelledby="home-hero">
      <p className="cra-hero__eyebrow">{CREATOR_HOME_WAITING_EYEBROW}</p>
      <h1 id="home-hero" className="cra-hero__head">
        {creatorPitchesWaitingHeadline(count)}
      </h1>
      <Button tier="primary" href="/creator/campaigns">
        {CREATOR_HOME_REVIEW_ACTION}
      </Button>
      <ul className="cra-hero__list">
        {home.pitches.map((pitch) => (
          <li key={pitch.associationId}>
            <Link to={`/creator/campaigns/${pitch.associationId}/opportunity`}>
              {pitch.productName ?? 'A campaign'}
            </Link>{' '}
            <span className="cra-muted">
              {pitch.kind === 'proposal' ? 'Waiting on your answer' : 'New opportunity'}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The standing block — deviation 2.
 *
 * `STANDING_BINDS_NOTHING` renders with the number, not below it. There is no
 * `Founders see this` badge (nothing shows a tier to a Founder), no "climb for
 * higher floors" claim (an eligibility condition §1 rule 6 forbids and §29.4
 * already answers), and no streak (§30 forbids it by name).
 */
function Standing({ home }: { home: CreatorHomeView }) {
  const standing = home.standing;

  return (
    <section className="cra-block" aria-labelledby="home-standing">
      <h2 id="home-standing" className="cra-block__title">
        {CREATOR_HOME_STANDING_TITLE}
      </h2>
      {standing ? (
        <>
          <p className="cra-standing__score">{standing.score}</p>
          <p className="cra-standing__tier">
            {tierLabel(standing.tier)}
            {standing.percentile === null ? null : (
              <span className="cra-muted">
                {' '}
                · top {Math.max(1, 100 - standing.percentile)}% of Creators
              </span>
            )}
          </p>
          <p className="cra-standing__freshness cra-muted">
            {/* §20's own vocabulary, reused rather than a second wording minted.
                A date as well as a time, because this is a stored snapshot
                rather than a live read — `Updated 3:40 PM` on a figure computed
                three days ago would be a freshness claim that is not true. No
                seconds: a machine locale with seconds is what Founder Flow
                Session E recorded on its own deadline line. */}
            {GLANCE_FRESHNESS.replace(
              '[TIME]',
              new Date(standing.computedAt).toLocaleString(undefined, {
                dateStyle: 'medium',
                timeStyle: 'short',
              }),
            )}
          </p>
          <p className="cra-pinned">{STANDING_BINDS_NOTHING}</p>
          <Accordion
            items={[
              {
                value: 'how',
                head: 'How this is worked out',
                body: (
                  <div>
                    <p>{STANDING_HOW_IT_IS_WORKED_OUT}</p>
                    <dl className="cra-defs">
                      {CREATOR_STANDING_INPUTS.map((input) => (
                        <div key={input.id}>
                          <dt>
                            {input.label}: {standing.inputs[input.id] ?? 0}
                          </dt>
                          <dd>{input.explanation}</dd>
                        </div>
                      ))}
                    </dl>
                    <ul className="cra-tasks">
                      {/* One task, and it names a record. The reference's other
                          two are refused: the first would make §14.2's
                          no-penalty decline untrue, the second is a sales
                          target §22.8 keeps out of standing entirely. */}
                      {CREATOR_STANDING_TASKS.map((task) => (
                        <li key={task.id}>
                          <strong>{task.label}</strong> {task.explanation}
                        </li>
                      ))}
                    </ul>
                  </div>
                ),
              },
            ]}
          />
        </>
      ) : (
        // §16a: not yet populated is not zero. A stored zero would render as a
        // score of nothing and a lowest tier, which reads as a judgement about
        // somebody who has simply not started.
        <p>{STANDING_NOT_ENOUGH_HISTORY}</p>
      )}
    </section>
  );
}

/** Three counts, each from a record. The reference's `Hits` is refused. */
function TrackRecord({ home }: { home: CreatorHomeView }) {
  const values: Record<string, string> = {
    launched: String(home.trackRecord.launched),
    verified: String(home.trackRecord.verified),
    backed: usd(home.trackRecord.backedCents),
  };

  return (
    <section className="cra-block" aria-labelledby="home-track">
      <h2 id="home-track" className="cra-block__title">
        {CREATOR_HOME_TRACK_RECORD_TITLE}
      </h2>
      <dl className="cra-defs cra-defs--wide">
        {CREATOR_TRACK_RECORD_ITEMS.map((item) => (
          <div key={item.id}>
            <dt>
              {item.label}: {values[item.id]}
            </dt>
            {/* §20's last bullet made structural: every number carries the
                definition of what it counts, so two people reading the same
                figure cannot mean different things by it. */}
            <dd>{item.explanation}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/**
 * §22.9's work-again requests.
 *
 * Read-only until a Founder asks, and there is no control here that starts one:
 * §30 defers direct Founder–Creator messaging, and an Admin or Creator
 * initiating this would fabricate a Founder's ask — the same refusal the
 * Founders workspace records for `Send work-again request`.
 */
function TeamUp({ home, onAnswered }: { home: CreatorHomeView; onAnswered: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);

  async function answer(requestId: string, accept: boolean) {
    setBusy(requestId);
    try {
      await respondToWorkAgainRequest(requestId, accept);
      onAnswered();
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="cra-block" aria-labelledby="home-team">
      <h2 id="home-team" className="cra-block__title">
        {CREATOR_HOME_TEAM_UP_TITLE}
      </h2>
      <p className="cra-pinned">{CREATOR_TEAM_UP_IS_THE_FOUNDERS_ASK}</p>
      <ul className="cra-list">
        {home.workAgain.map((request) => (
          <li key={request.requestId} className="cra-list__row">
            <div>
              <p className="cra-list__head">{request.productName ?? 'A campaign'}</p>
              <p className="cra-muted">{request.message}</p>
            </div>
            {/* §33.11.4: a CTA names the action. `Yes`/`No` is what the
                reference draws and what the sweep caught — with two requests on
                screen, a bare Yes says nothing about what is being agreed to,
                and §14.2's own word for the other half is Decline. */}
            <div className="cra-list__acts">
              <Button
                tier="secondary"
                small
                disabled={busy === request.requestId}
                onClick={() => void answer(request.requestId, true)}
              >
                Work together again
              </Button>
              <Button
                tier="tertiary"
                small
                disabled={busy === request.requestId}
                onClick={() => void answer(request.requestId, false)}
              >
                Decline this request
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Where the reference draws `Pick your next campaign`. */
function NextCampaign() {
  return (
    <section className="cra-block">
      <p className="cra-pinned">{CREATOR_NO_CAMPAIGN_POOL}</p>
      <Button tier="tertiary" href="/creator/campaigns">
        Open your campaigns
      </Button>
    </section>
  );
}

/** Public handles and standing. Nothing about another Creator's money. */
function Leaders({ home }: { home: CreatorHomeView }) {
  if (home.leaders.length === 0) {
    return (
      <section className="cra-block" aria-labelledby="home-leaders">
        <h2 id="home-leaders" className="cra-block__title">
          {CREATOR_HOME_LEADERBOARD_TITLE}
        </h2>
        {/* §16a again: a ranking of three is a sentence about two strangers,
            and saying so is a different fact from ranking somebody last. */}
        <p>
          This appears once at least {home.cohortMinimum} Creators have a standing. There are not
          enough yet to compare.
        </p>
      </section>
    );
  }

  return (
    <section className="cra-block" aria-labelledby="home-leaders">
      <h2 id="home-leaders" className="cra-block__title">
        {CREATOR_HOME_LEADERBOARD_TITLE}
      </h2>
      <ol className="cra-list">
        {home.leaders.map((leader, index) => (
          <li key={`${leader.handle}-${index}`} className="cra-list__row">
            <span>
              {index + 1}. {leader.isYou ? 'You' : leader.handle}
            </span>
            <span className="cra-muted">
              {leader.score} · {tierLabel(leader.tier)}
            </span>
          </li>
        ))}
      </ol>
      <p className="cra-pinned">{STANDING_LEADERBOARD_SHOWS_HANDLES_ONLY}</p>
    </section>
  );
}

/**
 * The referral — deviation 3.
 *
 * No percentage, no join link, and no Copy control: what the reference draws is
 * an amount §24 has no stream for and a public signup route §5.3 refuses. Both
 * pinned refusals render beside the form rather than in a disclosure below it,
 * because anybody who has seen a referral programme before will assume a
 * payment exists unless the control says otherwise.
 */
function Referrals({ home }: { home: CreatorHomeView }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [list, setList] = useState(home.referrals);

  async function send() {
    setBusy(true);
    setProblem(null);
    setSaved(null);
    try {
      const body = await saveCreatorReferral({
        referredName: values['referred_name'] ?? '',
        referredContact: values['referred_contact'] ?? '',
        relationship: values['relationship'] ?? '',
        why: values['why'] ?? '',
        note: values['note'] ?? '',
      });
      setList(body.referrals);
      setValues({});
      setSaved('Sent to Proovd. An Admin reads it and decides whether to look into it.');
    } catch (caught) {
      setProblem(
        caught instanceof CreatorRequestError
          ? (caught.detail.whatHappened ?? 'That could not be sent.')
          : 'That could not be sent, and nothing was recorded.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="cra-block" aria-labelledby="home-referral">
      <h2 id="home-referral" className="cra-block__title">
        {CREATOR_HOME_REFERRAL_TITLE}
      </h2>
      <p className="cra-pinned">{REFERRAL_PAYS_NOTHING}</p>
      <p className="cra-pinned">{REFERRAL_HAS_NO_PUBLIC_LINK}</p>
      <div className="cra-fields">
        {CREATOR_REFERRAL_FIELDS.map((field) => (
          <Field key={field.id} label={field.label} hint={'help' in field ? field.help : undefined}>
            <input
              className="input"
              value={values[field.id] ?? ''}
              onChange={(event) =>
                setValues((current) => ({ ...current, [field.id]: event.target.value }))
              }
            />
          </Field>
        ))}
      </div>
      <p className="cra-pinned">{REFERRAL_IS_AN_INTRODUCTION}</p>
      <Button tier="secondary" disabled={busy} onClick={() => void send()}>
        {busy ? 'Sending…' : 'Send this introduction'}
      </Button>
      {problem ? (
        <p className="cra-problem" role="alert">
          {problem}
        </p>
      ) : null}
      {saved ? <p role="status">{saved}</p> : null}
      {list.length > 0 ? (
        <ul className="cra-list">
          {list.map((referral) => (
            <li key={referral.id} className="cra-list__row">
              <span>{referral.referredName}</span>
              <span className="cra-muted">{referral.state}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
