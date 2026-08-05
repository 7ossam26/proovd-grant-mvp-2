/**
 * §22.10's next-campaign panel — Spec §22.10, §33.10.9.
 *
 * Two gates, rendered as two things. The phase trap is that "meeting the
 * cooldown grants nothing by itself", and the way a surface breaks that is by
 * summarising both into one green tick — so there is deliberately no single
 * status line here, and the combined answer appears only after both gates have
 * been shown separately with their own state.
 *
 * The cooldown date is the exact instant the server computed from
 * `campaign_close_at`, rendered local-primary with UTC secondary (§27.1). It
 * is never approximated to "in about a month": §22.10 asks for the exact
 * earliest request date, and a Founder planning a launch needs the day.
 */

import { StatePanel, Tag, NO_ACTION } from '../../components/index.js';

export interface NextCampaignView {
  cooldown: {
    months: number | null;
    closedAt: string | null;
    earliestAt: string | null;
    elapsed: boolean;
    blocker: string | null;
  };
  adminReadiness: {
    decision: 'ready' | 'not_ready' | null;
    decidedAt: string | null;
    explanation: string | null;
  };
  readyForNextCampaign: boolean;
  prepareNote: string;
}

/** §27.1: local primary, canonical UTC secondary. */
function renderInstant(iso: string): string {
  const date = new Date(iso);
  const local = date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  return `${local} (${iso.replace('T', ' ').slice(0, 16)} UTC)`;
}

export function NextCampaign({ view }: { view: NextCampaignView }) {
  return (
    <section aria-labelledby="next-campaign-heading">
      <h2 id="next-campaign-heading" className="h3">
        Your next campaign
      </h2>

      {/* Gate one: time. */}
      <StatePanel
        state="The three-month wait"
        whatHappened={
          view.cooldown.blocker
            ? view.cooldown.blocker
            : view.cooldown.earliestAt
              ? `You can ask for a next campaign from ${renderInstant(view.cooldown.earliestAt)}.`
              : 'We cannot work out the date yet.'
        }
        next={
          view.cooldown.elapsed
            ? 'This part is done.'
            : 'Nothing to do here — it passes on its own.'
        }
        owner="Proovd"
        nextUpdate={view.cooldown.earliestAt ? renderInstant(view.cooldown.earliestAt) : 'Unknown'}
        action={NO_ACTION}
        reference={
          view.cooldown.months !== null
            ? `${String(view.cooldown.months)} months from the day this campaign closed.`
            : 'Not configured on this deployment.'
        }
      />

      {/* Gate two: judgement. A separate panel, deliberately. */}
      <StatePanel
        state="Proovd's readiness decision"
        whatHappened={
          view.adminReadiness.decision === null
            ? 'A person at Proovd has not made this decision yet.'
            : (view.adminReadiness.explanation ?? '')
        }
        next={
          view.adminReadiness.decision === 'ready'
            ? 'This part is done.'
            : view.adminReadiness.decision === 'not_ready'
              ? 'We will tell you when this changes.'
              : 'We will tell you when it is made.'
        }
        owner="Proovd"
        nextUpdate={
          view.adminReadiness.decidedAt
            ? renderInstant(view.adminReadiness.decidedAt)
            : 'No date set'
        }
        action={NO_ACTION}
        // §22.10: "separate Admin-readiness criteria". Named as separate here
        // so the two gates cannot read as one thing with two halves.
        reference="This is decided separately from the wait, and neither one covers the other."
      />

      <p>
        {view.readyForNextCampaign ? (
          <Tag variant="moss">Ready for next campaign</Tag>
        ) : (
          <Tag variant="default">Not yet — both parts above have to be done</Tag>
        )}
      </p>

      {/* §22.10's own promise about what this page is not. */}
      <p>{view.prepareNote}</p>
    </section>
  );
}

export default NextCampaign;
