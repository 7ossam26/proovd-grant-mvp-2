/**
 * Screen 24 — your Backer rewards — Founder Flow v2, Session F.
 *
 * `campaign_reward_packages`, through `saveRewardPackage` — the same route
 * `/campaigns/:campaignId/build` calls. §14.4 requires at least one, which is
 * why `deriveBuildStatus` lists `rewardPackages` among what is missing until
 * there is one.
 *
 * ── No cap ─────────────────────────────────────────────────────────────────
 * The reference's card pager stops at three and labels its control `1/3 Add
 * Rewards`. §14.4 caps nothing; a Founder with a fourth reward would be refused
 * by a number nobody agreed to (§1 rule 6). The pager is a layout, and this
 * renders a list.
 *
 * ── The price is cents, and the browser does no arithmetic ─────────────────
 * `priceCents` crosses the wire as a decimal string of integer cents, and what
 * a Founder types in dollars is converted once, here, at the point of entry —
 * never re-derived from a formatted value.
 */

import { useCallback, useState } from 'react';
import { useParams } from 'react-router';
import { formatUsd } from '@proovd/shared';
import { Button, Field, Input, Textarea } from '../../components/index.js';
import { BuildStepPage, buildStepNav } from './BuildStepPage.js';
import { useBuildFlow } from './useBuild.js';
import { saveRewardPackage } from '../founder/api.js';

/** Dollars as typed → integer cents, once. `12.5` and `12.50` are the same. */
function toCents(typed: string): string | null {
  const match = /^\s*\$?\s*(\d+)(?:\.(\d{1,2}))?\s*$/.exec(typed);
  if (!match) return null;
  const cents = `${match[2] ?? ''}00`.slice(0, 2);
  return `${BigInt(match[1]!) * 100n + BigInt(cents)}`;
}

export function RewardsStep() {
  const { campaignId = '' } = useParams();
  const build = useBuildFlow(campaignId);
  const [title, setTitle] = useState('');
  const [price, setPrice] = useState('');
  const [contents, setContents] = useState('');
  const [delivery, setDelivery] = useState('');
  const [commitment, setCommitment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rewards = build.state?.rewardPackages ?? [];
  const cents = toCents(price);
  const ready =
    title.trim() && cents !== null && contents.trim() && delivery.trim() && commitment.trim();

  const add = useCallback(async () => {
    if (!ready || cents === null) return;
    setBusy(true);
    setError(null);
    try {
      await saveRewardPackage(campaignId, {
        // The SKU is the Founder's own title, slugged — §14.4 asks for a stable
        // identifier and does not ask a Founder to invent one.
        sku: title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40),
        title: title.trim(),
        priceCents: cents,
        contents: contents.trim(),
        fulfillmentCommitment: commitment.trim(),
        delivery: delivery.trim(),
      });
      await build.refresh();
      setTitle('');
      setPrice('');
      setContents('');
      setDelivery('');
      setCommitment('');
    } catch {
      setError('We could not save that reward. Nothing has changed.');
    } finally {
      setBusy(false);
    }
  }, [build, campaignId, cents, commitment, contents, delivery, price, ready, title]);

  return (
    <BuildStepPage
      pageId="rewards"
      campaignId={campaignId}
      build={build}
      title="Add your Backer rewards"
      lede="What somebody receives for pre-ordering, what it costs, and when it arrives. Your campaign needs at least one."
    >
      <div className="ff-rewards">
        <div className="ff-rewards__form">
          <Field label="What is it called?" id="ff-reward-title">
            <Input value={title} onChange={(e) => setTitle(e.currentTarget.value)} />
          </Field>
          <Field
            label="Price"
            id="ff-reward-price"
            hint="In dollars, before sales tax. Tax is worked out from each Backer's own address."
          >
            <Input
              value={price}
              inputMode="decimal"
              placeholder="120.00"
              onChange={(e) => setPrice(e.currentTarget.value)}
            />
          </Field>
          <Field label="What is included?" id="ff-reward-contents">
            <Textarea
              value={contents}
              rows={4}
              onChange={(e) => setContents(e.currentTarget.value)}
            />
          </Field>
          <Field
            label="When does it arrive?"
            id="ff-reward-delivery"
            hint="A month and year is enough. This is the promise your Backers hold you to."
          >
            <Input
              value={delivery}
              placeholder="March 2027"
              onChange={(e) => setDelivery(e.currentTarget.value)}
            />
          </Field>
          <Field
            label="What you commit to"
            id="ff-reward-commitment"
            hint="What you will do if something slips, and how people hear about it."
          >
            <Textarea
              value={commitment}
              rows={3}
              onChange={(e) => setCommitment(e.currentTarget.value)}
            />
          </Field>
          <Button tier="secondary" onClick={() => void add()} disabled={busy || !ready}>
            {busy ? 'Saving…' : 'Add this reward'}
          </Button>
          {price.trim() && cents === null ? (
            <p className="field__error">
              Write the price as an amount, like 120 or 120.00.
            </p>
          ) : null}
          {error ? (
            <div className="notice notice--warn" role="alert">
              <p>{error}</p>
            </div>
          ) : null}
        </div>

        <div className="ff-rewards__list">
          <p className="ff-rewards__label">On your campaign page</p>
          {rewards.length === 0 ? (
            <p className="ff-rewards__empty">
              Nothing yet. Your campaign needs at least one reward before it can go for review.
            </p>
          ) : (
            rewards.map((reward) => (
              <div className="ff-rewards__card" key={reward.id}>
                <p className="ff-rewards__card-title">{reward.title}</p>
                <p className="ff-rewards__card-price">{formatUsd(BigInt(reward.priceCents))}</p>
                <p className="ff-rewards__card-body">{reward.contents}</p>
                <p className="ff-rewards__card-when">Delivered by {reward.delivery}</p>
              </div>
            ))
          )}
        </div>
      </div>

      {buildStepNav(build, 'rewards')}
    </BuildStepPage>
  );
}
