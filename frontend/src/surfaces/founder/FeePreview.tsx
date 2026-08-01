/**
 * The itemised listing-fee preview — Spec §12, §24.6, §33.3.2.
 *
 * §12 fixes what it shows: the base line, each earned US$2 saving as its own
 * labeled line, and the total. §24.6 adds that the listing fee is stored and
 * presented as its own stream, so the sentence about the separate 5% travels
 * with it.
 *
 * ── Nothing here does arithmetic ────────────────────────────────────────────
 * Phase 09's trap: "Don't recalculate in the UI. A second implementation in a
 * React component is how the preview and the charge diverge." Every number
 * below is a string of integer cents the server calculated, parsed only to be
 * formatted by `shared/money`'s USD formatter. There is no addition, no
 * subtraction, and no `Math.min` in this file — if the lines and the total
 * disagree, that is a server bug and it should be visible as one rather than
 * papered over by a browser that re-derives the total.
 *
 * ── Tax and total-due are not shown, and that is honest ─────────────────────
 * §12 puts sales tax on the Checkout, calculated by Stripe Tax at the moment of
 * payment (Phase 10 establishes the client, Phase 11 uses it). A tax line
 * showing US$0.00 here would be a claim nobody has made, and a "total due now"
 * without tax would be a number the Founder is not going to be charged. So the
 * panel says the subtotal, and says plainly that tax is added at payment.
 */

import { formatUsd } from '@proovd/shared';
import { OPTIONAL_ITEMS, type OptionalItemKey } from '@proovd/shared';
import { Card } from '../../components/index.js';
import type { FeeState } from './api.js';

const LABELS = new Map<OptionalItemKey, string>(OPTIONAL_ITEMS.map((i) => [i.key, i.label]));

/** Cents cross the wire as decimal strings; `bigint` is the only safe parse. */
const usd = (cents: string): string => formatUsd(BigInt(cents));

export function FeePreview({ fee }: { fee: FeeState | null }) {
  if (!fee) {
    return (
      <Card>
        <p className="lede">Your listing fee appears here once we have looked at your campaign.</p>
      </Card>
    );
  }

  return (
    <Card>
      <h2 className="section-title">Your listing fee</h2>

      <dl className="fee-preview">
        <div className="fee-preview__row">
          <dt>Listing a campaign</dt>
          <dd>{usd(fee.baseCents)}</dd>
        </div>

        {/* §12: "each earned $2 saving as its own labeled line". Not a single
            "discounts" line — the Founder is meant to see which of their own
            work earned which saving. */}
        {fee.discountLines.map((line) => (
          <div className="fee-preview__row fee-preview__row--saving" key={line.item}>
            <dt>{LABELS.get(line.item) ?? line.item} completed</dt>
            <dd>−{usd(line.discountCents)}</dd>
          </div>
        ))}

        {fee.discountLines.length === 0 ? (
          <div className="fee-preview__row fee-preview__row--quiet">
            <dt>No savings yet</dt>
            <dd>Each optional item you complete takes {usd(fee.itemDiscountCents)} off.</dd>
          </div>
        ) : null}

        <div className="fee-preview__row fee-preview__row--total">
          <dt>Subtotal</dt>
          <dd>{usd(fee.subtotalCents)}</dd>
        </div>
      </dl>

      <p className="fine">
        Sales tax is worked out when you pay, so your final total will be a little higher than the
        subtotal. The lowest this fee can go is {usd(fee.minSubtotalCents)}.
      </p>

      {/* §24.6 / §12: "The 5% campaign fee is separate and unchanged." The
          server owns this sentence — it is a commercial statement, not copy. */}
      <p className="fine fine--separated">{fee.separateStreamNote}</p>

      {fee.locked ? (
        <p className="fine">
          This is the amount you paid. It does not change if you edit your campaign now.
        </p>
      ) : null}
    </Card>
  );
}

/**
 * §12's high-effort result, presented neutrally.
 *
 * §12: "Present the criteria neutrally, not as a quality judgment." So the
 * three inputs are stated as facts about what has been prepared, the one thing
 * it affects is named, and the one thing it does not affect is named too —
 * because a Founder who reads "high effort" with no context will read it as a
 * verdict, and §30 forbids copy that implies they have underperformed.
 */
export function HighEffortPanel({
  highEffort,
}: {
  highEffort: {
    visualsCompleted: boolean;
    brandingCompleted: boolean;
    interviewScheduledOrConfirmed: boolean;
    highEffort: boolean;
  } | null;
}) {
  if (!highEffort) return null;

  const prepared = [
    highEffort.visualsCompleted ? 'visuals' : null,
    highEffort.brandingCompleted ? 'branding' : null,
    highEffort.interviewScheduledOrConfirmed ? 'an interview' : null,
  ].filter(Boolean) as string[];

  return (
    <Card>
      <h2 className="section-title">What Creators will see about preparation</h2>
      {prepared.length > 0 ? (
        <p className="lede">
          You have {prepared.join(', ')} in place. Creators promoting your campaign will be offered
          the standard rate.
        </p>
      ) : (
        <p className="lede">
          You have not added visuals, branding, or an interview yet. While that is the case, a
          Creator may propose a rate above the standard one — because they would be doing more of
          the preparation themselves.
        </p>
      )}
      <p className="fine">
        This is a description of what is ready, not a judgement of your campaign. It affects one
        thing: whether a Creator may propose a percentage above the base rate. It has no effect on
        whether a fixed payment is available, and none on your listing fee beyond the savings
        listed above.
      </p>
    </Card>
  );
}
