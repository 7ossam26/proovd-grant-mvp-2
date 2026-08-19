/**
 * Screen 22 — your order threshold — Founder Flow v2, Session F.
 *
 * `campaign_build.order_threshold`, and Idea campaigns only — §14.4 gives a
 * Product campaign no public threshold, so `buildFlowStepsFor` never routes one
 * here and a Founder who types the address anyway is told why.
 *
 * ── It is a COUNT, and the reference collects an amount ─────────────────────
 * §4.1: "a number of Backers, not a dollar amount". The reference labels this
 * `(USD)` with `Ex: $1,000` and `Min. $500` — a different commercial instrument
 * with an invented floor, since §14.4 fixes no minimum at all. The field takes a
 * count of pre-orders and `ORDER_THRESHOLD_IS_A_COUNT` says so beside it.
 *
 * ── And the word `goal` appears nowhere ─────────────────────────────────────
 * §3.2 bans it for an Idea threshold in every audience INCLUDING identifiers,
 * and §33.11.3 reads the built bundle where a prop name survives minification.
 * The reference carries it 65 times. It is not in this file's copy, class
 * names, state keys, or ids.
 */

import { useCallback, useState } from 'react';
import { useParams } from 'react-router';
import { ORDER_THRESHOLD_IS_A_COUNT } from '@proovd/shared';
import { Button, Field, Input, StatePanel } from '../../components/index.js';
import { BuildStepPage, buildStepNav } from './BuildStepPage.js';
import { useBuildFlow } from './useBuild.js';
import { useFlowNav } from './FlowPage.js';

export function ThresholdStep() {
  const { campaignId = '' } = useParams();
  const build = useBuildFlow(campaignId);
  const [typed, setTyped] = useState<string | null>(null);

  const stored = build.state?.build?.orderThreshold;
  const value = typed ?? (stored === null || stored === undefined ? '' : String(stored));

  const write = useCallback(
    (next: string) => {
      // Digits only. A count with a decimal point in it is not a count, and a
      // field that accepted one would store a number nothing can act on.
      const digits = next.replace(/[^0-9]/g, '');
      setTyped(digits);
      build.autosave.queue({ orderThreshold: digits === '' ? null : Number(digits) });
    },
    [build.autosave],
  );

  return (
    <BuildStepPage
      pageId="threshold"
      campaignId={campaignId}
      build={build}
      title="Set your order threshold"
      lede="The number of pre-orders your campaign needs before any card is charged."
    >
      {build.state?.model === 'product' ? <NotYours campaignId={campaignId} /> : null}

      {build.state?.model === 'idea' ? (
        <div className="ff-threshold">
          <Field
            label="Pre-orders needed"
            id="ff-threshold-count"
            hint="A whole number of pre-orders. You can change it until your campaign goes for review."
          >
            <Input
              value={value}
              inputMode="numeric"
              onChange={(e) => write(e.currentTarget.value)}
            />
          </Field>
          <p className="ff-threshold__note">{ORDER_THRESHOLD_IS_A_COUNT}</p>
          {buildStepNav(build, 'threshold')}
        </div>
      ) : null}
    </BuildStepPage>
  );
}

/**
 * A Product Founder who reached this address anyway.
 *
 * §14.4 gives them no public threshold, so there is no field to disable — the
 * screen says which step is theirs and opens it (§1.4, §27.1).
 */
function NotYours({ campaignId }: { campaignId: string }) {
  const { leaveToPage } = useFlowNav();
  return (
    <div className="ff-threshold">
      <StatePanel
        state="This step is for Idea Campaigns"
        whatHappened="A Product Campaign takes pre-orders for something that already exists, so it has no public threshold to reach — every pre-order is charged when the campaign closes."
        next="Carry on with your FAQs."
        owner="You"
        nextUpdate="No further update needed"
        action={
          <Button tier="primary" onClick={() => leaveToPage('faqs')}>
            On to your FAQs
          </Button>
        }
        reference={campaignId}
      />
    </div>
  );
}
