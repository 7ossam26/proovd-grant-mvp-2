/**
 * Stage 4 — Listing fee. Spec §6, §12, §24.3, §24.6, §26.
 *
 * Ten lines: the base, the five §12 items that each take a saving off it, the
 * calculated fee, the tax, the total and the provider's own transaction id.
 * Every row's `.row-actions` is empty, and that is the design — nothing on this
 * screen changes a number. Changing the fee means changing an optional item,
 * which happens on Onboarding and produces a new calculation and a new checkout
 * link, exactly as the action bar says.
 *
 * ── Every amount is the server's ───────────────────────────────────────────
 * There is no arithmetic in this file. `Saved $N` has no column, so it is
 * composed server-side as `base − subtotal`; where the record does not state
 * it, the row says the amount is not stated rather than working it out.
 * §24.3's one-implementation rule is not only about the waterfall — a surface
 * that subtracts is a second answer waiting to disagree with the ledger, and
 * this is the surface an Admin quotes to a Founder from.
 *
 * The reference's own numbers disagree with each other — it prints `$29` and
 * `Saved $6` beside a `−$10` on the stage before it, while its own stated rule
 * `max(25, 35 − 5×2)` gives `$25` and `Saved $10`. `subtotal_cents` is what
 * renders here, so the two stages agree with the ledger rather than with the
 * seed value one of them was drawn from.
 *
 * ── There is no tax before the checkout is paid ────────────────────────────
 * Tax is calculated at checkout and is outside the listing fee (§24.3). Before
 * payment there is no tax amount, and the row renders that absence — never
 * `$0.00`, which would be a claim that a calculation ran and returned zero.
 */

import { useState } from 'react';
import { call } from '../../api.js';
import {
  RecordGroup,
  StageFrame,
  StateStrip,
  asRequestError,
  minusUsd,
  readPanel,
  refusalLine,
  usd,
  type RecordRowProps,
  type StageProps,
} from './recordGroup.js';
import { absoluteTime } from '../format.js';

/**
 * The reference's own five line labels. Deliberately NOT `OPTIONAL_ITEMS`'
 * labels — the register says `Founder interview` and `Visuals`, this screen
 * says `Interview` and `Visuals`. A surface-local map, so no other reader of
 * the register is renamed to suit one stage.
 */
const FEE_LINES: { key: string; label: string }[] = [
  { key: 'visuals', label: 'Visuals' },
  { key: 'branding', label: 'Branding' },
  { key: 'interview', label: 'Interview' },
  { key: 'story', label: 'Story' },
  { key: 'socials', label: 'Socials' },
];

const NOT_STATED = 'Not stated by this record';

export function ListingFeeStage({ detail, panel, onSaved, onOpenStage }: StageProps) {
  const p = readPanel(panel);
  const fee = p.listingFee;
  const campaignId = detail.campaigns.current?.campaignId ?? null;

  const [note, setNote] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  /**
   * The two wayfinding controls hand the move back to the record shell, which
   * is the only thing that knows which stage is on screen. Where the shell did
   * not pass one, the press says so rather than doing nothing at all.
   */
  const go = (stageId: string) => {
    if (onOpenStage) {
      onOpenStage(stageId);
      return;
    }
    setNote('This record shell did not hand the stage a way to move between stages.');
  };

  /**
   * The checkout link. `POST` to the listing record's own namespace; where the
   * server has no such route, its refusal is what the Admin reads. A local
   * "Link sent" over a request that never created one is the one outcome this
   * must never produce (§1.4).
   */
  const sendPaymentLink = () => {
    if (!campaignId) {
      setNote('This record has no campaign to raise a checkout against.');
      return;
    }
    setSending(true);
    setNote(null);
    call(`/api/admin/listing/campaigns/${encodeURIComponent(campaignId)}/checkout-link`, {
      method: 'POST',
      body: JSON.stringify({}),
    })
      .then(() => {
        setNote('Checkout link sent and recorded');
        onSaved();
      })
      .catch((e: unknown) => setNote(refusalLine(asRequestError(e))))
      .finally(() => setSending(false));
  };

  const base = usd(fee?.baseCents);
  const subtotal = usd(fee?.subtotalCents);
  const floor = usd(fee?.minSubtotalCents);
  const saved = usd(fee?.savedCents);
  const tax = usd(fee?.taxCents);
  const total = usd(fee?.totalCents);

  const lineFor = (key: string) => fee?.lines?.find((l) => l.key === key) ?? null;
  const composedLines = fee?.lines != null;
  /* The fee locks on a successful payment, and the whole bottom of this stage
     branches on it — the total's state, the transaction line, what follows, and
     which primary action the moment earns. */
  const paid = fee?.paid === true || fee?.status === 'Paid';

  const rows: RecordRowProps[] = [
    {
      label: 'Base listing fee',
      value: base,
      absence: 'The record does not state the base fee in force',
      source: 'System rule',
      status: base ? 'Base' : NOT_STATED,
      tone: 'plain',
      actions: [],
    },
    ...FEE_LINES.map((spec): RecordRowProps => {
      const line = lineFor(spec.key);
      const qualifies = line?.qualifies ?? line != null;
      const amount = minusUsd(line?.amountCents);
      return {
        label: spec.label,
        value: !composedLines ? null : qualifies ? 'Founder item qualifies' : 'Not complete',
        absence: 'The record does not state this line',
        source: 'Founder saved values',
        /* `$0` on an item that did not qualify is not arithmetic — an item with
           no discount line took nothing off the fee, which is what the record
           says. The amount on the qualifying side is the record's own. */
        status: !composedLines
          ? NOT_STATED
          : qualifies
            ? (amount ?? 'Qualifies · amount not stated')
            : '$0',
        tone: !composedLines ? 'plain' : qualifies ? 'done' : 'waiting',
        actions: [],
      };
    }),
    {
      label: 'Listing fee',
      value: subtotal,
      absence: 'No calculation is recorded against this campaign',
      source: 'Calculated',
      /* Both halves are the server's. Neither is subtracted here. */
      status: [floor ? `Floor ${floor}` : 'Floor not stated', saved ? `Saved ${saved}` : 'Saved not stated'].join(
        ' · ',
      ),
      tone: subtotal ? 'done' : 'waiting',
      actions: [],
    },
    {
      label: 'Tax',
      value: tax,
      /* Not `$0.00`: no tax exists until the checkout runs, and a zero would
         claim a calculation that never happened (§24.3, §1.4). */
      absence: 'No tax until the checkout is paid',
      source: 'Checkout',
      status: 'Separate from listing fee',
      tone: 'plain',
      actions: [],
    },
    {
      label: 'Total',
      value: total,
      absence: 'No total until the checkout is paid',
      source: 'Checkout',
      status: paid ? 'Paid' : (fee?.status ?? NOT_STATED),
      /* An unpaid total is the thing the stage is waiting on somebody to do,
         which is what `action` marks — not `waiting`, which is somebody else. */
      tone: paid ? 'done' : 'action',
      actions: [],
    },
    {
      label: 'Transaction',
      value: fee?.transactionId ?? null,
      absence: 'Not created',
      source: 'Payment provider',
      status: fee?.paidAt ? absoluteTime(fee.paidAt) : (fee?.status ?? NOT_STATED),
      tone: fee?.transactionId ? 'done' : 'waiting',
      actions: [],
    },
  ];

  return (
    <StageFrame
      stage="Listing fee"
      heading={subtotal ? `Listing fee · ${subtotal}` : 'Listing fee'}
      lead="The fee is derived from the five optional Founder items and locks only after successful payment."
    >
      <StateStrip
        status={fee?.status ?? NOT_STATED}
        lastChange={
          fee?.paidAt
            ? absoluteTime(fee.paidAt)
            : fee?.calculatedAt
              ? absoluteTime(fee.calculatedAt)
              : 'No calculation recorded against this campaign'
        }
        next={fee?.nextLabel ?? (paid ? 'Matching' : 'Founder completes checkout')}
      />

      <div className="record-groups">
        <RecordGroup title="Calculation and payment" rows={rows} />

        <section className="policy-note">
          <strong>Creator terms do not belong here.</strong>
          <p>
            Matching begins only after payment. If the final Creator-review phase fails, the
            retained/refunded amount must follow the policy recorded for this checkout.
          </p>
        </section>

        <div className="actionbar">
          <div>
            <small>
              {note ?? 'Changing optional items creates a new fee version and checkout link'}
            </small>
          </div>
          <div className="action-buttons">
            <button type="button" onClick={() => go('onboarding')}>
              Return to optional items
            </button>
            {/* The reference swaps the primary action on payment: before it,
                the moment is getting the Founder to a checkout; after it, the
                moment is Matching. */}
            {paid ? (
              <button className="primary" type="button" onClick={() => go('matching')}>
                Open Matching
              </button>
            ) : (
              <button
                className="primary"
                type="button"
                disabled={sending}
                onClick={sendPaymentLink}
              >
                Send payment link
              </button>
            )}
          </div>
        </div>
      </div>
    </StageFrame>
  );
}
