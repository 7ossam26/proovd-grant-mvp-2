/**
 * The render catalog — Spec §27.2, §27.3–27.6 (Phase 22a).
 *
 * One entry per event key that has a sender, mapping it to the *same* render
 * function the sender calls, with representative variables. Two things depend
 * on it and neither could exist without it:
 *
 *  1. **Coverage.** "Every event has a template" stops being a claim somebody
 *     checked once and becomes a test that enumerates the key set. Adding a key
 *     to `events.ts` without a catalog entry fails the suite.
 *
 *  2. **The §27.2 contract.** The rules — one primary action, a plain-text
 *     support route, a stable reference, the money facts, a spelled-out
 *     timezone — are properties of a *rendered message*. Asserting them means
 *     rendering all of them, and rendering all of them means having one place
 *     that knows how.
 *
 * §27.2's "high-impact messages can be previewed with final variables before
 * manual send" falls out of the same structure: `preview.ts` renders through
 * this catalog with the caller's real variables rather than these samples.
 *
 * ── Why the samples are realistic and not `'x'` ─────────────────────────────
 * A contract asserted against `subject: 'x'` proves the assertion runs, not
 * that the message satisfies it. These carry a campaign name, real amounts, a
 * real descriptor, and a real reference, because that is what the checks read.
 * The cost is that a sample can drift from what a sender actually passes; the
 * mitigation is that the *renderer* is shared, so a template that stops
 * satisfying §27.2 fails here regardless of which variables reached it.
 */

import type { NotificationEventKey } from './events.js';
import { renderFounderInvitation } from './templates/founder-invitation.js';
import { renderAffiliateInvitation } from './templates/affiliate-invitation.js';
import { renderSignupConfirmed } from './templates/affiliate-signup-confirmed.js';
import { renderPreparingAvailable } from './templates/affiliate-preparing-available.js';
import { renderFormalOpportunity } from './templates/affiliate-formal-opportunity.js';
import { renderInterviewEmail } from './templates/founder-interview.js';
import { renderListingReceipt, renderListingRefund } from './templates/listing-fee.js';
import {
  renderAcceptConfirmation,
  renderDeclineConfirmation,
  renderProposalSubmitted,
  renderProposalReceived,
  renderFounderRevision,
  renderVersionDecision,
  renderProposalExpired,
} from './templates/decisions.js';
import {
  renderCampaignLiveFounder,
  renderCampaignLiveAffiliate,
  renderFirstPostPass,
  renderFirstPostCorrection,
  renderFirstPostReject,
  renderCampaignDiscoveryOpened,
  renderThresholdReached,
  renderThresholdLost,
} from './templates/launch.js';
import { renderPreorderConfirmation } from './templates/backer-preorder.js';
import { renderPrechargeReminder } from './templates/backer-precharge-reminder.js';
import { renderCancellation } from './templates/backer-cancellation.js';
import { renderRefundNotice } from './templates/backer-refund.js';
import {
  renderChargeReceipt,
  renderFailedPayment,
  renderNoChargeClosure,
  renderCampaignEnded,
  renderRetrySuccess,
  renderResultsReady,
  renderCreatorClosed,
} from './templates/close.js';
import {
  renderCompletionDecision,
  renderCommissionFinalized,
  renderTransferCreated,
  renderTransferFailure,
  renderPayout,
} from './templates/earnings.js';
import {
  renderW9Prompt,
  renderW9Block,
  renderPaymentReleased,
  renderEarlyRequestAck,
  renderEarlyResult,
} from './templates/founder-payments.js';
import { renderEnforcementNotice } from './templates/enforcement.js';
import { renderDeliveryNotice, renderDay14Result } from './templates/fulfillment.js';
import { renderInternalNotice, renderPlainNotice } from './templates/plain.js';
import {
  WORK_AGAIN_NO_PENALTY,
  WORK_AGAIN_ACCEPTANCE_GRANTS_NOTHING,
  PREPARE_WITHOUT_OPENING,
} from '../completion/logic.js';
import { renderDigest } from './templates/digest.js';

export interface RenderedMessage {
  subject: string;
  html: string;
  text: string;
}

/* ── Sample values, shared so the checks read the same facts everywhere ────── */

const SUPPORT = 'support@proovd.co';
const APP = 'https://app.proovd.co';
const CAMPAIGN = 'The Rainfall Kettle';
const FOUNDER = 'Rainfall Goods LLC';
const REWARD = 'Founding-member kettle';
const REF = 'campaign-2f1c8a4e';
const DESCRIPTOR = 'PROOVD* RAINFALL KETTLE';
const CLOSE_UTC = '2026-09-14 17:00 UTC';

/**
 * The renderer for each key that has a sender. Keyed by `NotificationEventKey`
 * so the compiler refuses an entry for a key nothing sends, and the coverage
 * test refuses a sent key with no entry.
 */
export const NOTIFICATION_CATALOG: Record<NotificationEventKey, () => Promise<RenderedMessage>> = {
  /* ── §27.3 Founder ──────────────────────────────────────────────────────── */

  founder_invitation: () =>
    renderFounderInvitation({
      recipientName: 'Ada',
      productName: CAMPAIGN,
      productUrl: 'https://rainfallgoods.example',
      whatWeUnderstood: 'A kettle that measures and logs the water it boils.',
      whyInvited: 'Your prototype has an audience already asking to buy it.',
      senderName: 'Sam at Proovd',
      senderEmail: SUPPORT,
      expectedSetupTime: 'about 25 minutes',
      draftUrl: `${APP}/draft/sample-token`,
      reference: REF,
      supportEmail: SUPPORT,
    }),

  founder_interview_confirmed: () => interview('confirmed'),
  founder_interview_reminder: () => interview('reminder'),
  founder_interview_rescheduled: () => interview('rescheduled'),
  founder_interview_canceled: () => interview('canceled'),

  founder_listing_fee_receipt: () =>
    renderListingReceipt({
      founderName: 'Ada',
      productName: CAMPAIGN,
      // The sender formats through `formatUsdCents`, so the sample carries the
      // `US$` prefix it really passes — a sample without it would have hidden
      // the money-fact check rather than exercised it.
      lines: [
        { label: 'Listing fee', amount: 'US$49.00' },
        { label: 'Visuals uploaded', amount: '-US$2.00' },
        { label: 'Sales tax', amount: 'US$3.05' },
      ],
      total: 'US$50.05',
      descriptor: 'PROOVD LISTING',
      receiptUrl: `${APP}/campaigns/c1/workspace`,
      responseDeadlineUtc: '2026-08-12 09:00 UTC',
      reference: REF,
      supportEmail: SUPPORT,
    }),

  founder_listing_fee_refund: () =>
    renderListingRefund({
      founderName: 'Ada',
      productName: CAMPAIGN,
      totalRefunded: 'US$50.05',
      explanation:
        'No Creator accepted within the response window, so the whole listing charge including sales tax has been refunded.',
      reference: REF,
      supportEmail: SUPPORT,
    }),

  founder_response_window_started: () =>
    renderPlainNotice({
      subject: `Creators have until 2026-08-12 09:00 UTC to respond — ${CAMPAIGN}`,
      headline: 'The Creator response window has started.',
      facts: [
        { label: 'Creators must respond by', value: '2026-08-12 09:00 UTC' },
        { label: 'Creators who can respond', value: '4 Creators' },
        { label: 'Who owns it', value: 'The Creators — and you, once one proposes terms' },
        { label: 'What you can do now', value: 'Build your campaign; both tracks run in parallel' },
      ],
      paragraphs: [
        'If no Creator and you mutually accept the same terms before that deadline, Proovd refunds your listing payment in full, including its sales tax, automatically.',
      ],
      action: { label: 'Open your campaign roster', url: `${APP}/campaigns/c1/roster` },
      reference: REF,
      supportEmail: SUPPORT,
    }),

  founder_roster_update: () =>
    renderPlainNotice({
      subject: `A Creator's status changed on ${CAMPAIGN}`,
      headline: 'Reviewing → Paused',
      facts: [
        { label: 'Campaign', value: CAMPAIGN },
        { label: 'Was', value: 'Reviewing' },
        { label: 'Now', value: 'Paused' },
        {
          label: 'What you need to do',
          value: 'Nothing right now. Your roster shows who is where.',
        },
      ],
      paragraphs: [
        'One Creator on this campaign moved to a new status. Your roster names who.',
      ],
      action: { label: 'Open your roster', url: `${APP}/campaigns/c1/roster` },
      reference: REF,
      supportEmail: SUPPORT,
    }),

  founder_creator_proposal_received: () => renderProposalReceived(proposal()),
  founder_creator_proposal_revision: () => renderProposalReceived(proposal()),
  founder_creator_proposal_decision: () =>
    renderVersionDecision({ ...proposal(), decision: 'accepted', decidedBy: 'Creator' }),

  founder_campaign_live: () =>
    renderCampaignLiveFounder({
      founderName: 'Ada',
      productName: CAMPAIGN,
      campaignUrl: `${APP}/campaigns/c1/home`,
      closeUtc: CLOSE_UTC,
      reference: REF,
      supportEmail: SUPPORT,
    }),

  founder_campaign_discovery_opened: () =>
    renderCampaignDiscoveryOpened({
      founderName: 'Ada',
      productName: CAMPAIGN,
      campaignUrl: `${APP}/campaigns/c1/home`,
      reference: REF,
      supportEmail: SUPPORT,
    }),

  founder_idea_threshold_reached: () => renderThresholdReached(crossing()),
  founder_idea_threshold_lost: () => renderThresholdLost(crossing()),

  founder_campaign_ended: () =>
    renderCampaignEnded({
      founderName: 'Ada',
      campaignTitle: CAMPAIGN,
      closedAtUtc: CLOSE_UTC,
      outcomeLine: 'The order threshold was met and charges have begun.',
      campaignHomeUrl: `${APP}/campaigns/c1/home`,
      reference: REF,
      supportEmail: SUPPORT,
    }),

  founder_results_ready: () =>
    renderResultsReady({
      founderName: 'Ada',
      campaignTitle: CAMPAIGN,
      rewardSubtotalCaptured: '4,180.00',
      salesTaxCaptured: '258.14',
      totalCaptured: '4,438.14',
      capturedCount: 44,
      resultsUrl: `${APP}/campaigns/c1/results`,
      reference: REF,
      supportEmail: SUPPORT,
    }),

  founder_w9_prompt: () =>
    renderW9Prompt({
      campaignTitle: CAMPAIGN,
      resubmission: false,
      resubmissionReason: null,
      paymentsUrl: `${APP}/campaigns/c1/results`,
      reference: REF,
      supportEmail: SUPPORT,
    }),

  founder_w9_block: () =>
    renderW9Block({
      campaignTitle: CAMPAIGN,
      amountAffected: 'US$3,204.90',
      amountExact: true,
      nextReviewDate: '2026-09-28',
      paymentsUrl: `${APP}/campaigns/c1/results`,
      reference: REF,
      supportEmail: SUPPORT,
    }),

  founder_single_payment_released: () => released('Single Founder payment'),
  founder_first_payment_released: () => released('First payment'),
  founder_remaining_payment_released: () => released('Remaining payment'),

  founder_early_remaining_request: () =>
    renderEarlyRequestAck({
      campaignTitle: CAMPAIGN,
      paymentsUrl: `${APP}/campaigns/c1/results`,
      reference: REF,
      supportEmail: SUPPORT,
    }),

  founder_early_remaining_result: () =>
    renderEarlyResult({
      campaignTitle: CAMPAIGN,
      approved: true,
      amount: 'US$1,922.94',
      reason:
        'Delivery is available, communication is current, tax collection is configured, and no risk flag is open.',
      neverSkipsLine:
        'Early release never skips the Day 14 Progress Check — the review still happens on schedule.',
      paymentsUrl: `${APP}/campaigns/c1/results`,
      reference: REF,
      supportEmail: SUPPORT,
    }),

  founder_campaign_suspended: () => enforcement('suspended', 'founder'),
  founder_campaign_killed: () => enforcement('stopped', 'founder'),

  founder_payment_blocked: () =>
    renderPlainNotice({
      subject: `Campaign payment on hold — ${CAMPAIGN}`,
      headline: 'A campaign payment is on hold.',
      facts: [
        { label: 'Campaign', value: CAMPAIGN },
        { label: 'Amount affected', value: 'US$3,204.90' },
        { label: 'Status', value: 'Blocked — the campaign has been suspended' },
        { label: 'Who owns it', value: 'Proovd' },
        { label: 'What you can do now', value: 'No action is needed from you' },
      ],
      paragraphs: [
        'Unreleased payments are restricted while that stands. Proovd will contact you with the outcome.',
      ],
      action: { label: 'View your payment status', url: `${APP}/campaigns/c1/results` },
      reference: REF,
      supportEmail: SUPPORT,
    }),

  founder_connected_account_status: () => accountStatus('founder'),

  founder_day_14_review_result: () =>
    renderDay14Result({
      campaignTitle: CAMPAIGN,
      outcome: 'pass',
      reasons: [],
      consequences: [],
      explanation:
        'Your progress evidence and Backer communication were both adequate. The remaining payment stays on schedule.',
      actionUrl: `${APP}/campaigns/c1/results`,
      reference: REF,
      supportEmail: SUPPORT,
    }),

  /* ── §27.4 Creator ──────────────────────────────────────────────────────── */

  affiliate_campaign_invitation: () =>
    renderAffiliateInvitation({
      recipientName: 'Jo',
      founderName: 'Ada',
      productName: CAMPAIGN,
      whyRecruited: 'Your kitchen-gear reviews reach exactly the people this is for.',
      reviewedPresence: 'youtube.com/@example — 42k subscribers',
      senderName: 'Sam at Proovd',
      senderEmail: SUPPORT,
      claimUrl: `${APP}/creator/signup/sample-token`,
      reference: REF,
      supportEmail: SUPPORT,
    }),

  affiliate_signup_confirmed: () =>
    renderSignupConfirmed({
      recipientName: 'Jo',
      productName: CAMPAIGN,
      nextUpdate: 'within five business days',
      reference: REF,
      supportEmail: SUPPORT,
    }),

  affiliate_founder_signup_completed: () =>
    renderPreparingAvailable({
      recipientName: 'Jo',
      productName: CAMPAIGN,
      reviewUrl: `${APP}/creator/campaigns/a1/kit`,
      reference: REF,
      supportEmail: SUPPORT,
    }),

  affiliate_formal_opportunity_available: () =>
    renderFormalOpportunity({
      creatorName: 'Jo',
      productName: CAMPAIGN,
      campaignUrl: `${APP}/creator/campaigns/a1/opportunity`,
      responseDeadlineUtc: '2026-08-12 09:00 UTC',
      reference: REF,
      supportEmail: SUPPORT,
    }),

  affiliate_accept_confirmation: () =>
    renderAcceptConfirmation({
      creatorName: 'Jo',
      productName: CAMPAIGN,
      totalPercent: 22,
      exampleChargeFormatted: 'US$95.00',
      exampleShareFormatted: 'US$20.90',
      fixedPaymentFormatted: 'US$250.00',
      responseDeadlineUtc: '2026-08-12 09:00 UTC',
      campaignUrl: `${APP}/creator/campaigns/a1/opportunity`,
      reference: REF,
      supportEmail: SUPPORT,
    }),

  affiliate_decline_confirmation: () =>
    renderDeclineConfirmation({
      creatorName: 'Jo',
      productName: CAMPAIGN,
      reference: REF,
      supportEmail: SUPPORT,
    }),

  affiliate_proposal_submitted: () => renderProposalSubmitted(proposal()),
  affiliate_founder_revision: () => renderFounderRevision(proposal()),
  affiliate_founder_decision: () =>
    renderVersionDecision({ ...proposal(), decision: 'accepted', decidedBy: 'Founder' }),

  affiliate_proposal_expired: () =>
    renderProposalExpired({
      creatorName: 'Jo',
      productName: CAMPAIGN,
      reference: REF,
      supportEmail: SUPPORT,
    }),

  affiliate_campaign_live: () =>
    renderCampaignLiveAffiliate({
      creatorName: 'Jo',
      productName: CAMPAIGN,
      kitUrl: `${APP}/creator/campaigns/a1/partnership`,
      closeUtc: CLOSE_UTC,
      reference: REF,
      supportEmail: SUPPORT,
    }),

  affiliate_first_post_pass: () =>
    renderFirstPostPass({
      creatorName: 'Jo',
      productName: CAMPAIGN,
      campaignUrl: `${APP}/creator/campaigns/a1/partnership`,
      reference: REF,
      supportEmail: SUPPORT,
    }),

  affiliate_first_post_correction: () =>
    renderFirstPostCorrection({
      creatorName: 'Jo',
      productName: CAMPAIGN,
      correctionDetail: 'The disclosure needs to appear before the first mention of the product.',
      correctionDueUtc: '2026-08-20 17:00 UTC',
      campaignUrl: `${APP}/creator/campaigns/a1/partnership`,
      reference: REF,
      supportEmail: SUPPORT,
    }),

  affiliate_first_post_reject: () =>
    renderFirstPostReject({
      creatorName: 'Jo',
      productName: CAMPAIGN,
      reason: 'The post described a delivery date the campaign has never committed to.',
      campaignUrl: `${APP}/creator/campaigns/a1/partnership`,
      reference: REF,
      supportEmail: SUPPORT,
    }),

  affiliate_campaign_closed: () =>
    renderCreatorClosed({
      campaignTitle: CAMPAIGN,
      contentVerifiedLine: 'Your first post was verified on 12 August.',
      attributedPreorders: 18,
      attributedCaptured: 16,
      moneyStatusBlock:
        'Estimated — US$704.00. This is an estimate until completion is verified and earnings are finalized.',
      nextReviewLine: 'Completion review is due by 21 September.',
      partnershipUrl: `${APP}/creator/campaigns/a1/close`,
      reference: REF,
      supportEmail: SUPPORT,
    }),

  affiliate_completion_decision: () =>
    renderCompletionDecision({
      campaignTitle: CAMPAIGN,
      outcomeLine: 'Your deliverables were verified as complete.',
      fixedPaymentLine: 'Your fixed Creator payment of US$250.00 is eligible for release.',
      partnershipUrl: `${APP}/creator/campaigns/a1/close`,
      reference: REF,
      supportEmail: SUPPORT,
    }),

  affiliate_commission_finalized: () =>
    renderCommissionFinalized({
      campaignTitle: CAMPAIGN,
      commissionAmount: '704.00',
      bonusAmount: '0.00',
      fixedAmount: '250.00',
      moneyStatusBlock: 'Finalized — US$954.00 total, approved and awaiting transfer.',
      partnershipUrl: `${APP}/creator/campaigns/a1/close`,
      reference: REF,
      supportEmail: SUPPORT,
    }),

  affiliate_transfer_created: () =>
    renderTransferCreated({
      campaignTitle: CAMPAIGN,
      commissionAmount: '704.00',
      bonusAmount: '0.00',
      fixedAmount: '250.00',
      totalAmount: '954.00',
      moneyStatusBlock: 'Transferred — US$954.00 is on its way to your connected account.',
      partnershipUrl: `${APP}/creator/campaigns/a1/close`,
      reference: REF,
      supportEmail: SUPPORT,
    }),

  affiliate_transfer_failure: () =>
    renderTransferFailure({
      campaignTitle: CAMPAIGN,
      amount: 'US$954.00',
      partnershipUrl: `${APP}/creator/campaigns/a1/close`,
      reference: REF,
      supportEmail: SUPPORT,
    }),

  affiliate_transfer_reversal: () =>
    renderPlainNotice({
      subject: `Transfer reversal recorded — ${CAMPAIGN}`,
      headline: 'A transfer for this campaign was reversed.',
      facts: [
        { label: 'Campaign', value: CAMPAIGN },
        { label: 'Amount reversed', value: 'US$954.00' },
        { label: 'Status', value: 'Reversed — recorded recovery decision' },
      ],
      paragraphs: [
        'Your money status view shows the current state, the amounts involved, and the reason on record.',
        `Questions, or to dispute this decision: reply to ${SUPPORT} and a person will answer.`,
      ],
      action: { label: 'View your earnings', url: `${APP}/creator/campaigns/a1/close` },
      reference: REF,
      supportEmail: SUPPORT,
    }),

  affiliate_payout_paid: () => renderPayout('paid', payout()),
  affiliate_payout_failed: () => renderPayout('failed', payout()),

  affiliate_warning: () => enforcement('warned', 'affiliate'),
  affiliate_suspension: () => enforcement('suspended', 'affiliate'),

  affiliate_connected_account_info_required: () => accountStatus('affiliate'),

  affiliate_transfer_update: () =>
    renderPlainNotice({
      subject: `Transfer amount under review — ${CAMPAIGN}`,
      headline: 'A transfer for this campaign is being checked.',
      facts: [
        { label: 'Campaign', value: CAMPAIGN },
        { label: 'Amount Proovd recorded', value: 'US$954.00' },
        { label: 'Amount the payment provider reports', value: 'US$940.00' },
        { label: 'Status', value: 'Pending — a person is reconciling the two' },
        { label: 'Who owns it', value: 'Proovd' },
      ],
      paragraphs: [
        'Your finalized earnings have not changed. We are checking why the two figures differ before anything else happens, and we will tell you the outcome.',
        'No action is needed from you.',
      ],
      action: { label: 'View your earnings', url: `${APP}/creator/campaigns/a1/close` },
      reference: REF,
      supportEmail: SUPPORT,
    }),

  affiliate_policy_reacceptance: () =>
    renderPlainNotice({
      subject: 'Action needed — an updated policy needs your acceptance',
      headline: 'An updated policy needs your acceptance.',
      facts: [
        { label: 'Document', value: 'Creator Acceptable Use Policy' },
        { label: 'Version', value: '1.1' },
        { label: 'Who owns it', value: 'You — nothing moves until you accept' },
        { label: 'Accept by', value: '2026-09-20 23:59 UTC' },
      ],
      paragraphs: [
        'Continued use of your Creator account is paused until you review and accept it. Sign in, open the updated document, and accept.',
      ],
      action: { label: 'Review and accept', url: `${APP}/legal/creator-aup` },
      reference: REF,
      supportEmail: SUPPORT,
    }),

  /* ── §27.5 Backer ───────────────────────────────────────────────────────── */

  backer_preorder_confirmation: () =>
    renderPreorderConfirmation({
      campaignTitle: CAMPAIGN,
      founderLegalName: FOUNDER,
      rewardTitle: REWARD,
      rewardSubtotal: '95.00',
      salesTax: '5.86',
      totalAuthorized: '100.86',
      chargeRule:
        'Your card is saved and not charged today. You are charged only if the campaign reaches its order threshold by the close date.',
      chargeTimeUtc: CLOSE_UTC,
      delivery: 'Expected March 2027',
      statementDescriptor: DESCRIPTOR,
      magicLinkUrl: `${APP}/backer/sample-token`,
      reference: 'PO-8H2K-4M9Q',
      supportEmail: SUPPORT,
    }),

  backer_precharge_reminder: () =>
    renderPrechargeReminder({
      campaignTitle: CAMPAIGN,
      founderLegalName: FOUNDER,
      rewardSubtotal: '95.00',
      salesTax: '5.86',
      totalAuthorized: '100.86',
      whenUtc: CLOSE_UTC,
      condition: 'only if the campaign reaches its order threshold',
      statementDescriptor: DESCRIPTOR,
      magicLinkUrl: `${APP}/backer/sample-token`,
      reference: 'PO-8H2K-4M9Q',
      supportEmail: SUPPORT,
    }),

  backer_cancellation_confirmation: () =>
    renderCancellation({
      campaignTitle: CAMPAIGN,
      rewardTitle: REWARD,
      canceledAtUtc: '2026-09-01 11:20 UTC',
      reference: 'PO-8H2K-4M9Q',
      supportEmail: SUPPORT,
    }),

  backer_threshold_miss_no_charge: () =>
    renderNoChargeClosure({
      reason: 'The campaign did not reach its order threshold by the close date.',
      campaignTitle: CAMPAIGN,
      rewardTitle: REWARD,
      reference: 'PO-8H2K-4M9Q',
      supportEmail: SUPPORT,
    }),

  backer_charge_receipt: () =>
    renderChargeReceipt({
      campaignTitle: CAMPAIGN,
      founderLegalName: FOUNDER,
      rewardTitle: REWARD,
      rewardSubtotal: '95.00',
      salesTax: '5.86',
      totalCaptured: '100.86',
      statementDescriptor: DESCRIPTOR,
      delivery: 'Expected March 2027',
      magicLinkUrl: `${APP}/backer/sample-token`,
      reference: 'PO-8H2K-4M9Q',
      supportEmail: SUPPORT,
    }),

  backer_charge_failed_update_card: () =>
    renderFailedPayment({
      resolvedBody: [
        'We could not complete your pre-order charge.',
        '',
        `Campaign: ${CAMPAIGN}`,
        `Seller: ${FOUNDER}`,
        `Amount: US$100.86`,
        `Your statement will show: ${DESCRIPTOR}`,
        'Status: pending — no money has moved.',
        'You have until 2026-09-16 17:00 UTC to update your card. After that the pre-order is canceled and you are not charged.',
      ].join('\n'),
      action: 'Update card',
      campaignTitle: CAMPAIGN,
      updateCardUrl: `${APP}/backer/sample-token`,
      reference: 'PO-8H2K-4M9Q',
      supportEmail: SUPPORT,
    }),

  backer_retry_success: () =>
    renderRetrySuccess({
      campaignTitle: CAMPAIGN,
      founderLegalName: FOUNDER,
      rewardTitle: REWARD,
      rewardSubtotal: '95.00',
      salesTax: '5.86',
      totalCaptured: '100.86',
      statementDescriptor: DESCRIPTOR,
      delivery: 'Expected March 2027',
      magicLinkUrl: `${APP}/backer/sample-token`,
      reference: 'PO-8H2K-4M9Q',
      supportEmail: SUPPORT,
    }),

  backer_retry_dropped: () =>
    renderNoChargeClosure({
      reason:
        'The card could not be charged before the recovery window closed, so the pre-order was canceled.',
      campaignTitle: CAMPAIGN,
      rewardTitle: REWARD,
      reference: 'PO-8H2K-4M9Q',
      supportEmail: SUPPORT,
    }),

  backer_refund_started: () => refund('started'),
  backer_refund_completed: () => refund('completed'),
  backer_refund_failed: () => refund('failed'),

  backer_support_received: () =>
    renderPlainNotice({
      subject: 'We received your request — PVD-8H2KM-4Q7RT',
      headline: 'We received your request.',
      facts: [],
      paragraphs: [
        [
          'We received your message — case PVD-8H2KM-4Q7RT.',
          '',
          'Topic: Delivery question',
          'Owner: Founder, coordinated by Proovd',
          'Human response due: 6 August 2026, 5:00 PM MDT (2026-08-06 23:00 UTC)',
          'If the founder needs to respond, we will follow up after 48 hours if you have not heard back.',
          '',
          'Reply to this message to keep everything in one case.',
        ].join('\n'),
        'Your card issuer’s rights are unaffected by anything here.',
      ],
      reference: 'PVD-8H2KM-4Q7RT',
      supportEmail: SUPPORT,
    }),

  backer_support_founder_response: () =>
    renderPlainNotice({
      subject: 'Response to your request — PVD-8H2KM-4Q7RT',
      headline: 'There is a response to your request.',
      facts: [],
      paragraphs: [
        'The kettles shipped on Monday and yours has a tracking number waiting on your pre-order page.',
        'Reply from your pre-order page — your context is already there.',
      ],
      reference: 'PVD-8H2KM-4Q7RT',
      supportEmail: SUPPORT,
    }),

  backer_support_followup: () =>
    renderPlainNotice({
      subject: 'An update on your support request — PVD-8H2KM-4Q7RT',
      headline: 'We said we would check in today, so we are.',
      facts: [
        { label: 'Your case', value: 'PVD-8H2KM-4Q7RT' },
        { label: 'What it is about', value: 'Delivery question' },
        { label: 'Who owns it', value: 'Founder, coordinated by Proovd' },
        { label: 'Where it stands', value: 'Still open — we have not closed it' },
        {
          label: 'What you can do now',
          value:
            'Reply to this email with anything new. You do not need to repeat what you already told us.',
        },
      ],
      paragraphs: [
        'We promised you an update by now and we do not have a resolution yet. Your case is still open and still owned by a person, and nothing you sent has been lost.',
      ],
      reference: 'PVD-8H2KM-4Q7RT',
      supportEmail: SUPPORT,
    }),

  internal_support_sla_breach: () =>
    renderInternalNotice({
      subject: 'Support SLA breached — PVD-8H2KM-4Q7RT (Human response)',
      headline: 'Human response is past due on PVD-8H2KM-4Q7RT.',
      facts: [
        { label: 'Case', value: 'PVD-8H2KM-4Q7RT' },
        { label: 'Topic', value: 'Delivery question' },
        { label: 'Owner', value: 'Founder, coordinated by Proovd' },
        { label: 'Clock', value: 'Human response' },
        { label: 'Was due', value: '2026-08-06 23:00 UTC' },
        { label: 'Case status', value: 'open' },
      ],
      paragraphs: [
        '§27.8 publishes this promise, so a breach is a commitment the product has already made and not kept. The queue has the full context.',
      ],
      action: { label: 'Open the support queue', url: `${APP}/admin/support` },
      reference: 'PVD-8H2KM-4Q7RT',
      supportEmail: SUPPORT,
    }),

  backer_magic_link_reissue: () =>
    renderPlainNotice({
      subject: `Your link to ${CAMPAIGN}`,
      headline: 'Here is a fresh link to your pre-order.',
      facts: [
        { label: 'Campaign', value: CAMPAIGN },
        { label: 'What this link does', value: 'Opens your pre-orders on this campaign' },
        {
          label: 'How long it lasts',
          value: 'It works once, and the previous link stops working',
        },
        {
          label: 'If you did not ask for this',
          value: 'Nothing has changed and nothing has been charged. You can ignore this email.',
        },
      ],
      paragraphs: [
        'You asked for a new link to your pre-order page. Opening it changes nothing on its own — you can cancel, update your card, or ask for help from there.',
      ],
      action: { label: 'Open your pre-order', url: `${APP}/backer/sample-token` },
      reference: REF,
      supportEmail: SUPPORT,
    }),

  backer_delivery: () =>
    renderDeliveryNotice({
      campaignTitle: CAMPAIGN,
      rewardTitle: REWARD,
      items: [
        { key: 'reward', label: 'What you pre-ordered', value: REWARD },
        {
          key: 'access',
          label: 'How to get it',
          value: 'Your shipment left on 3 August; tracking is on your pre-order page.',
        },
        {
          key: 'original_commitment',
          label: 'What was originally promised',
          value: 'Expected March 2027',
        },
        { key: 'founder_support', label: 'Founder support', value: 'Ada — rainfallgoods.example' },
        { key: 'proovd_escalation', label: 'If that does not resolve it', value: `Proovd — ${SUPPORT}` },
      ],
      actionUrl: `${APP}/backer/sample-token`,
      reference: 'PO-8H2K-4M9Q',
      supportEmail: SUPPORT,
    }),

  backer_campaign_suspended: () => enforcement('suspended', 'backer'),
  backer_campaign_killed: () => enforcement('stopped', 'backer'),

  /* ── §27.6 Internal ─────────────────────────────────────────────────────── */

  internal_listing_paid_deadline_started: () =>
    renderInternalNotice({
      subject: 'Listing paid — response deadline 2026-08-12 09:00 UTC — campaign c1',
      headline: 'Listing fee paid — campaign c1',
      facts: [
        { label: 'Response window ends', value: '2026-08-12 09:00 UTC' },
        { label: 'Formal opportunities opened', value: '4 Creators' },
      ],
      paragraphs: [
        'The deadline was stored at payment with the window length in force at that moment; a later settings change moves future deadlines and never this one.',
      ],
      action: { label: 'Open the campaign roster', url: `${APP}/admin/campaigns/c1` },
      reference: REF,
      supportEmail: SUPPORT,
    }),

  internal_threshold_reached: () => crossingNotice('reached'),
  internal_threshold_lost: () => crossingNotice('lost'),

  internal_charge_batch_result: () =>
    renderInternalNotice({
      subject: 'Charge batch result — campaign c1',
      headline: 'Close batch complete — campaign c1',
      facts: [
        { label: 'Campaign model', value: 'Idea' },
        { label: 'Captured', value: '44' },
        { label: 'In the retry window', value: '3' },
        { label: 'Dropped', value: '0' },
        { label: 'Closed without charge', value: '0' },
        { label: 'Order threshold', value: 'Met at 47/40 unique active Backers' },
        { label: 'Retry window closes', value: '2026-09-16T17:00:00.000 UTC' },
        { label: 'Campaign status', value: 'closed_pending_capture' },
      ],
      action: { label: 'Open the close queue', url: `${APP}/admin/close` },
      reference: REF,
      supportEmail: SUPPORT,
    }),

  internal_retry_reconciliation_complete: () =>
    renderInternalNotice({
      subject: 'Retry window ended — campaign c1',
      headline: 'The 48-hour retry window has ended — campaign c1',
      facts: [
        { label: 'Recovered', value: '2' },
        { label: 'Dropped', value: '1' },
        { label: 'Captured in total', value: '46' },
      ],
      paragraphs: [
        'Dropped reservations count as no revenue, no Creator commission, and no Founder share (§21) — the ledger was only ever written at capture, so nothing needs unwinding.',
        'Reconciliation can begin.',
      ],
      action: { label: 'Open the close queue', url: `${APP}/admin/close` },
      reference: REF,
      supportEmail: SUPPORT,
    }),

  internal_money_decisions_due: () =>
    renderInternalNotice({
      subject: 'Money decisions due — campaign c1',
      headline: 'Day 3 money decisions are due — campaign c1',
      facts: [
        { label: 'Due', value: '2026-09-17T17:00:00.000 UTC' },
        { label: 'Schedule day', value: 'Day 3 from campaign close' },
      ],
      paragraphs: [
        'Founder payment eligibility under the §22.3 schedule, and any remaining Creator earnings approvals and Transfers (§22.1).',
      ],
      action: { label: 'Open the close queue', url: `${APP}/admin/close` },
      reference: REF,
      supportEmail: SUPPORT,
    }),

  internal_deliverable_verification_due: () =>
    renderInternalNotice({
      subject: 'Deliverable verification due — campaign c1',
      headline: 'Deliverable verification is due — campaign c1',
      facts: [
        { label: 'Awaiting a §22.1 completion decision', value: '2 Creator associations' },
        { label: 'Why now', value: 'The money schedule has reached its first payment day' },
      ],
      action: { label: 'Open the close queue', url: `${APP}/admin/close` },
      reference: REF,
      supportEmail: SUPPORT,
    }),

  internal_dispute_opened: () =>
    renderInternalNotice({
      subject: 'Dispute opened — evidence due in 24 hours (dp_1Nx)',
      headline: 'Payment dispute opened — evidence due within 24 hours',
      facts: [
        { label: 'Provider dispute', value: 'dp_1Nx' },
        { label: 'Reservation', value: 'res-9f2' },
        { label: 'Amount', value: 'US$100.86' },
        { label: 'Provider reason', value: 'product_not_received' },
        { label: 'Evidence due', value: '2026-09-18T09:00:00.000 UTC' },
      ],
      paragraphs: [
        'Classify the case through the §24.8 cause register. Nothing about the Creator’s earnings moves until an Admin records that classification.',
      ],
      action: { label: 'Open the dispute queue', url: `${APP}/admin/refunds` },
      reference: REF,
      supportEmail: SUPPORT,
    }),

  internal_missing_w9: () =>
    renderInternalNotice({
      subject: 'W-9 missing — campaign c1',
      headline: 'A verified W-9 is missing — campaign c1',
      facts: [
        { label: 'Campaign', value: CAMPAIGN },
        { label: 'Amount blocked', value: 'US$3,204.90' },
        {
          label: 'Why',
          value:
            'Charges settled and the payment schedule has started; no Founder payment can exist without a verified W-9 (§22.3).',
        },
        { label: 'Next', value: 'Record receipt and the verification decision from the close queue.' },
      ],
      action: { label: 'Open the close queue', url: `${APP}/admin/close` },
      reference: REF,
      supportEmail: SUPPORT,
    }),

  /* §27.6's operational queue notices (Phase 22b). */
  internal_invitation_claimed: () =>
    renderInternalNotice({
      subject: 'New Founder account — c1',
      headline: 'A Founder claimed their invitation',
      facts: [
        { label: 'Who', value: 'Rowan Vale' },
        { label: 'Role', value: 'Founder' },
      ],
      action: { label: 'Open the admin surface', url: `${APP}/admin/founders` },
      reference: REF,
      supportEmail: SUPPORT,
    }),









  /* The last four customer messages §27 named and nothing sent (Phase 22b). */
  founder_password_reset: () =>
    renderPlainNotice({
      subject: 'Reset your Proovd password',
      headline: 'Set a new password',
      facts: [
        { label: 'Account', value: 'rowan@example.com' },
        { label: 'Who owns it', value: 'You' },
        {
          label: 'If this was not you',
          value: 'Nothing has changed. You can ignore this and your password stays as it is.',
        },
      ],
      action: { label: 'Set a new password', url: `${APP}/reset/opaque-token` },
      reference: REF,
      supportEmail: SUPPORT,
    }),

  /* ── The Affiliate workspace rebuild, Session B (2026-08-17) ──────────────
   * The reset is the SAME render the Founder key uses — one path chooses the
   * key by the account's role, so the two entries pointing at one shape is
   * the truth rather than a shortcut. The correction request is §11's right
   * to correct prefilled public information, exercised as an ask.            */
  affiliate_password_reset: () =>
    renderPlainNotice({
      subject: 'Reset your Proovd password',
      headline: 'Set a new password',
      facts: [
        { label: 'Account', value: 'mira@example.com' },
        { label: 'Who owns it', value: 'You' },
        {
          label: 'If this was not you',
          value: 'Nothing has changed. You can ignore this and your password stays as it is.',
        },
      ],
      action: { label: 'Set a new password', url: `${APP}/reset/opaque-token` },
      reference: REF,
      supportEmail: SUPPORT,
    }),

  affiliate_correction_request: () =>
    renderPlainNotice({
      subject: 'Please review one detail on your Proovd record',
      headline: 'One thing to check on your record',
      facts: [
        { label: 'What to review', value: 'Audience size' },
        {
          label: 'What we ask',
          value: 'Share a current analytics screenshot for the channel, taken this month.',
        },
        {
          label: 'What has changed',
          value: 'Nothing. The current value stays until you supply a correction.',
        },
      ],
      paragraphs: [
        'Proovd keeps a record of your public channel and audience so campaigns can be matched honestly. You have the right to correct anything on it.',
        'Reply to this message with the correction or the evidence, and a person will record it.',
      ],
      reference: REF,
      supportEmail: SUPPORT,
    }),



  affiliate_disclosure_tracking_available: () =>
    renderPlainNotice({
      subject: `Your link and disclosure for ${CAMPAIGN}`,
      headline: 'Your tracking link and the disclosure you must use.',
      facts: [
        { label: 'Campaign', value: CAMPAIGN },
        { label: 'Your link', value: `${APP}/c/abc123` },
        {
          label: 'Required disclosure',
          value: 'Paid partnership: I may earn a commission from purchases made through this link. #ad',
        },
        { label: 'Status', value: 'Not active yet — it starts earning at launch' },
      ],
      paragraphs: ['Clicks before it activates earn nothing.'],
      action: { label: 'Open your campaign', url: `${APP}/creator/campaigns/a1/partnership` },
      reference: REF,
      supportEmail: SUPPORT,
    }),





  /*
   * §20's mid-campaign addition (Phase 22b). Ten keys, four moments, all on the
   * addition row. The frozen remaining-time terms are what makes these separate
   * messages rather than the ordinary invitation and activation copy.
   */
  affiliate_mid_campaign_invitation: () =>
    midCampaign('affiliate', 'invitation'),
  founder_mid_campaign_creator_proposed: () => midCampaign('founder', 'proposed'),
  internal_mid_campaign_invite: () => midCampaign('internal', 'invite'),
  founder_mid_campaign_creator_accepted: () => midCampaign('founder', 'accepted'),
  internal_mid_campaign_accept: () => midCampaign('internal', 'accept'),
  affiliate_mid_campaign_readiness: () => midCampaign('affiliate', 'readiness'),
  internal_mid_campaign_readiness: () => midCampaign('internal', 'readiness'),
  affiliate_mid_campaign_activation: () => midCampaign('affiliate', 'activation'),
  founder_mid_campaign_creator_activated: () => midCampaign('founder', 'activated'),
  internal_mid_campaign_activation: () => midCampaign('internal', 'activation'),

  /*
   * §16's fixed Creator payment (Phase 22b). §24.7 makes it its own stream:
   * no percentage, no sales tax, and Proovd is the merchant of record on the
   * funding charge — which is why the two Founder money messages carry a
   * seller and a descriptor and the Creator's does not (it is not a charge).
   */
  founder_fixed_payment_funding_request: () =>
    renderPlainNotice({
      subject: `Fund the Creator payment for ${CAMPAIGN}`,
      headline: 'One Creator payment is waiting to be funded.',
      facts: [
        { label: 'Campaign', value: CAMPAIGN },
        { label: 'Creator', value: '@rainmaker' },
        { label: 'Amount', value: 'US$1,500.00' },
        { label: 'Fund by', value: '2026-09-28 17:00 UTC' },
        { label: 'Who owns it', value: 'You' },
      ],
      paragraphs: [
        'This is the fixed payment you and this Creator agreed. It is separate from the campaign charges and from any commission — no percentage applies to it, and no sales tax is added.',
      ],
      action: { label: 'Fund the Creator payment', url: `${APP}/campaigns/c1/creator-readiness` },
      reference: REF,
      supportEmail: SUPPORT,
    }),

  founder_fixed_payment_funding_confirmation: () =>
    renderPlainNotice({
      subject: `Creator payment funded — ${CAMPAIGN}`,
      headline: 'Your Creator payment is funded.',
      facts: [
        { label: 'Campaign', value: CAMPAIGN },
        { label: 'Amount', value: 'US$1,500.00' },
        { label: 'Seller', value: 'Proovd LLC' },
        { label: 'Your statement shows', value: 'PROOVD CREATOR PAY' },
        { label: 'Status', value: 'Completed — received in full' },
      ],
      paragraphs: ['It reaches the Creator after their work is verified and the campaign closes.'],
      action: { label: 'View your Creators', url: `${APP}/campaigns/c1/creator-readiness` },
      reference: REF,
      supportEmail: SUPPORT,
    }),

  founder_fixed_payment_funding_failure: () =>
    renderPlainNotice({
      subject: `Creator payment not funded — ${CAMPAIGN}`,
      headline: 'That Creator payment did not go through.',
      facts: [
        { label: 'Campaign', value: CAMPAIGN },
        { label: 'Amount still owed', value: 'US$1,500.00' },
        { label: 'Status', value: 'Not funded — nothing was taken' },
        { label: 'Fund by', value: '2026-09-28 17:00 UTC' },
      ],
      paragraphs: [
        'Nothing was taken from your card. The payment has to be made in full and the exact amount.',
      ],
      action: { label: 'Try funding again', url: `${APP}/campaigns/c1/creator-readiness` },
      reference: REF,
      supportEmail: SUPPORT,
    }),

  affiliate_fixed_funding_complete: () =>
    renderPlainNotice({
      subject: `Your fixed payment is funded — ${CAMPAIGN}`,
      headline: 'The Founder has funded your fixed payment.',
      facts: [
        { label: 'Campaign', value: CAMPAIGN },
        { label: 'Amount', value: 'US$1,500.00' },
        { label: 'Status', value: 'Funded — not yet paid to you' },
        {
          label: 'Your readiness',
          value: 'Still checked separately — funding does not make you ready.',
        },
      ],
      paragraphs: ['Funded is not paid. The money is with Proovd until your work is verified.'],
      action: { label: 'Open your campaign', url: `${APP}/creator/campaigns/a1/partnership` },
      reference: REF,
      supportEmail: SUPPORT,
    }),

  internal_fixed_funding_received: () =>
    renderInternalNotice({
      subject: `Fixed Creator payment funded — ${CAMPAIGN} (US$1,500.00)`,
      headline: `Fixed Creator payment received — ${CAMPAIGN}`,
      facts: [
        { label: 'Campaign', value: CAMPAIGN },
        { label: 'Amount', value: 'US$1,500.00' },
        { label: 'Allocation state', value: 'funded — NOT paid (§16)' },
      ],
      action: { label: 'Open Creator readiness', url: `${APP}/admin/creator-readiness?campaignId=c1` },
      reference: REF,
      supportEmail: SUPPORT,
    }),

  internal_fixed_funding_failed: () =>
    renderInternalNotice({
      subject: `Fixed Creator payment failed — ${CAMPAIGN} (US$1,500.00)`,
      headline: `Fixed Creator payment failed — ${CAMPAIGN}`,
      facts: [
        { label: 'Campaign', value: CAMPAIGN },
        { label: 'Amount', value: 'US$1,500.00' },
        { label: 'Recorded reason', value: 'amount_mismatch' },
        { label: 'Deadline still running', value: '2026-09-28 17:00 UTC' },
      ],
      action: { label: 'Open Creator readiness', url: `${APP}/admin/creator-readiness?campaignId=c1` },
      reference: REF,
      supportEmail: SUPPORT,
    }),

  /* §15's review round (Phase 22b). All four dedup on the review row. */
  founder_submission_receipt: () =>
    renderPlainNotice({
      subject: `We have your campaign for review — ${CAMPAIGN}`,
      headline: 'Your campaign is with us.',
      facts: [
        { label: 'Campaign', value: CAMPAIGN },
        { label: 'Review round', value: '1' },
        { label: 'Who owns it now', value: 'Proovd' },
        {
          label: 'When you will hear',
          value: 'Within one business day, Monday to Friday, excluding U.S. federal holidays.',
        },
      ],
      action: { label: 'View your campaign', url: `${APP}/campaigns/c1/build` },
      reference: REF,
      supportEmail: SUPPORT,
    }),

  founder_changes_required: () =>
    renderPlainNotice({
      subject: `Changes needed before ${CAMPAIGN} can go live`,
      headline: 'We read your campaign and there are changes to make.',
      facts: [
        { label: 'Campaign', value: CAMPAIGN },
        { label: 'Who owns it now', value: 'You' },
        { label: 'Required before resubmitting', value: '2' },
        { label: 'Optional improvements', value: '1' },
      ],
      paragraphs: [
        'Everything you built is still there — your build, your Creator roster, and the terms they accepted. Nothing was reset.',
      ],
      action: { label: 'Open your campaign', url: `${APP}/campaigns/c1/build` },
      reference: REF,
      supportEmail: SUPPORT,
    }),

  founder_campaign_approved: () =>
    renderPlainNotice({
      subject: `${CAMPAIGN} is approved`,
      headline: 'Your campaign is approved.',
      facts: [
        { label: 'Campaign', value: CAMPAIGN },
        { label: 'Who owns the next step', value: 'Proovd' },
        { label: 'What you can do now', value: 'No action needed.' },
      ],
      paragraphs: ['Approved is not live yet. We keep an exact copy of what was approved.'],
      action: { label: 'View your campaign', url: `${APP}/campaigns/c1/build` },
      reference: REF,
      supportEmail: SUPPORT,
    }),

  internal_campaign_submitted: () =>
    renderInternalNotice({
      subject: `Campaign submitted for review — ${CAMPAIGN} (round 1)`,
      headline: `A campaign is waiting on Proovd — ${CAMPAIGN}`,
      facts: [
        { label: 'Campaign', value: CAMPAIGN },
        { label: 'Round', value: '1' },
        { label: 'Response promised', value: 'One business day (§27.8).' },
      ],
      action: { label: 'Open the review', url: `${APP}/admin/creator-readiness?campaignId=c1` },
      reference: REF,
      supportEmail: SUPPORT,
    }),

  /*
   * §27.7's three digests. The samples carry real activity because an empty
   * digest is never sent (`DIGEST_PROHIBITIONS.no_empty_send`) — rendering one
   * with no items would assert the contract against a message the product
   * cannot produce.
   */
  founder_activity_digest: () =>
    renderDigest({
      audience: 'founder',
      frequency: 'daily',
      items: [
        {
          campaignTitle: CAMPAIGN,
          headline: 'Backer 014 commented',
          occurredAt: new Date('2026-09-20T14:05:00Z'),
        },
        {
          campaignTitle: CAMPAIGN,
          headline: 'A Creator’s status changed',
          occurredAt: new Date('2026-09-20T09:40:00Z'),
        },
      ],
      preferencesUrl: `${APP}/settings/notifications`,
      supportEmail: SUPPORT,
      reference: REF,
    }),

  affiliate_activity_digest: () =>
    renderDigest({
      audience: 'affiliate',
      frequency: 'weekly',
      items: [
        {
          campaignTitle: CAMPAIGN,
          headline: 'Tooling is finished and the first run is scheduled',
          occurredAt: new Date('2026-09-18T11:20:00Z'),
        },
      ],
      preferencesUrl: `${APP}/creator/settings/notifications`,
      supportEmail: SUPPORT,
      reference: REF,
    }),

  /*
    The follow record's consent RECEIPT (campaign-page-v2 Session C — a
    recorded §1 rule 6 deviation). It is transactional: `optOutRule` stays
    `forbidden`, so it carries no opt-out language, and the one way out it
    names is a plain sentence in the body rather than an unsubscribe control.
    The thing consented to is `backer_campaign_update_digest` below, which
    already carries the route out.
  */
  backer_follow_confirmation: () =>
    renderPlainNotice({
      subject: `Confirm the summary for ${CAMPAIGN}`,
      headline: 'One click and the summary starts.',
      facts: [
        { label: 'Campaign', value: CAMPAIGN },
        { label: 'How often', value: 'Weekly' },
        {
          label: 'What this is not',
          value: 'Not a pre-order. Nothing is charged and no card is saved.',
        },
        {
          label: 'If you did not ask for this',
          value:
            'Nothing has started and nothing will. Ignore this email and no summary is ever sent.',
        },
      ],
      paragraphs: [
        `You are asking Proovd to email you a summary of what happens on ${CAMPAIGN}, weekly.`,
        `If you would rather not receive it after all: ${APP}/campaign/${REF}/follow/stop/sample`,
      ],
      action: { label: 'Confirm the summary', url: `${APP}/campaign/${REF}/follow/confirm/sample` },
      reference: REF,
      supportEmail: SUPPORT,
    }),

  backer_campaign_update_digest: () =>
    renderDigest({
      audience: 'backer',
      frequency: 'weekly',
      items: [
        {
          campaignTitle: CAMPAIGN,
          headline: 'Tooling is finished and the first run is scheduled',
          occurredAt: new Date('2026-09-18T11:20:00Z'),
        },
      ],
      preferencesUrl: `${APP}/backer`,
      supportEmail: SUPPORT,
      reference: REF,
    }),

  internal_day_14_due: () =>
    renderInternalNotice({
      subject: `Day 14 Progress Check due — ${CAMPAIGN}`,
      headline: `Day 14 Progress Check is due — ${CAMPAIGN}`,
      facts: [
        { label: 'Due', value: '2026-09-28T17:00:00.000 UTC' },
        {
          label: 'Consequence of failure',
          value: 'Product Campaign — blocks the unreleased remaining payment',
        },
      ],
      action: { label: 'Open the Day 14 queue', url: `${APP}/admin/fulfillment` },
      reference: REF,
      supportEmail: SUPPORT,
    }),

  internal_interview_changed: () =>
    renderInternalNotice({
      subject: `Interview rescheduled — ${CAMPAIGN}`,
      headline: 'A Founder moved their interview.',
      facts: [
        { label: 'Campaign', value: CAMPAIGN },
        { label: 'Change', value: 'Rescheduled' },
        { label: 'Was', value: '2026-08-11 16:00 UTC' },
        { label: 'Now', value: '2026-08-13 18:30 UTC' },
        { label: 'Reason given', value: 'Conflict with a supplier call' },
        {
          label: 'Listing fee',
          value:
            'Recalculated — the interview credit and the high-effort classification both moved',
        },
      ],
      paragraphs: [
        'The booking record is ours and has already been updated; this is the notice, not the change.',
      ],
      action: { label: 'Open the campaign', url: `${APP}/admin/campaigns/c1` },
      reference: REF,
      supportEmail: SUPPORT,
    }),

  internal_proposal_awaiting_response: () =>
    renderInternalNotice({
      subject: `Proposal v2 awaiting the Founder — ${CAMPAIGN}`,
      headline: 'A proposal version is open and waiting on the Founder.',
      facts: [
        { label: 'Campaign', value: CAMPAIGN },
        { label: 'Version', value: 'v2' },
        { label: 'Proposed by', value: 'Creator' },
        { label: 'Terms', value: '28% total commission' },
        { label: 'Waiting on', value: 'the Founder' },
        { label: 'Response deadline', value: '2026-08-12 09:00 UTC' },
      ],
      paragraphs: [
        'If no Creator and Founder mutually accept before the deadline, §14.6 refunds the listing payment in full and the campaign ends with no Creator.',
      ],
      action: { label: 'Open the roster', url: `${APP}/admin/campaigns/c1` },
      reference: REF,
      supportEmail: SUPPORT,
    }),

  /* ── Phase 21b (§22.9, §22.10, §31.8) ────────────────────────────────── */

  affiliate_work_again_request: () =>
    renderPlainNotice({
      subject: `A Founder would like to work with you again — ${CAMPAIGN}`,
      headline: 'You have a request to work together again.',
      facts: [
        { label: 'Campaign you completed', value: CAMPAIGN },
        { label: 'From', value: 'Ada' },
        { label: 'What they said', value: 'We are building a travel version and would love you on it.' },
        { label: 'Who owns it', value: 'You — there is no deadline on your answer' },
        { label: 'If you decline', value: WORK_AGAIN_NO_PENALTY },
      ],
      paragraphs: [
        'This is a request to talk about working together on something new. Accepting it does not commit you to terms — nothing has been agreed and no campaign exists yet.',
      ],
      action: { label: 'Open the request', url: `${APP}/creator/campaigns/a1/close` },
      reference: REF,
      supportEmail: SUPPORT,
    }),

  founder_work_again_response: () =>
    renderPlainNotice({
      subject: '@kettlehead is open to working again',
      headline: 'They are open to talking about something new.',
      facts: [
        { label: 'Campaign', value: CAMPAIGN },
        { label: 'Creator', value: '@kettlehead' },
        { label: 'Answer', value: 'Open to working again' },
        { label: 'What this changes', value: WORK_AGAIN_ACCEPTANCE_GRANTS_NOTHING.join(' ') },
      ],
      paragraphs: [
        'Your next campaign still goes through the same route as this one: the cooldown, and then an Admin readiness decision. This answer does not move either.',
      ],
      action: { label: 'Open your campaign', url: `${APP}/campaigns/c1/results` },
      reference: REF,
      supportEmail: SUPPORT,
    }),

  internal_work_again_request: () =>
    renderInternalNotice({
      subject: `Work-again request — ${CAMPAIGN}`,
      headline: 'A Founder asked a completed Creator to work again.',
      facts: [
        { label: 'Campaign', value: CAMPAIGN },
        { label: 'Creator', value: '@kettlehead' },
        { label: 'Status', value: 'requested' },
        { label: 'Message', value: 'We are building a travel version and would love you on it.' },
        {
          label: 'What it can do',
          value: 'Nothing on its own — no campaign, no cooldown change, no readiness approval.',
        },
      ],
      paragraphs: [
        '§22.9 routes this through Proovd rather than giving the two parties a channel. Nothing is owed here unless the request needs mediation.',
      ],
      action: { label: 'Open campaign operations', url: `${APP}/admin/campaign-operations` },
      reference: REF,
      supportEmail: SUPPORT,
    }),

  founder_ready_next_campaign: () =>
    renderPlainNotice({
      subject: 'You are ready for your next campaign',
      headline: 'Proovd has approved you for a next campaign.',
      facts: [
        { label: 'Previous campaign', value: CAMPAIGN },
        { label: 'Readiness decision', value: 'Ready' },
        {
          label: 'Why',
          value:
            'You delivered on time, answered the Day 14 check with evidence, and every Backer question was resolved.',
        },
        {
          label: 'The other gate',
          value: 'The three-month cooldown is separate. Your campaign page shows the exact date.',
        },
      ],
      paragraphs: [PREPARE_WITHOUT_OPENING],
      action: { label: 'Open your campaign', url: `${APP}/campaigns/c1/results` },
      reference: REF,
      supportEmail: SUPPORT,
    }),

  backer_satisfaction_survey: () =>
    renderPlainNotice({
      subject: `How did ${CAMPAIGN} go?`,
      headline: 'One question, one click.',
      facts: [
        { label: 'Campaign', value: CAMPAIGN },
        { label: 'What we are asking', value: 'Whether what you received was what you expected' },
        {
          label: 'How long it takes',
          value: 'One click. A reason is optional and you can skip it.',
        },
        {
          label: 'What it changes',
          value:
            'If something went wrong, a person at Proovd picks it up. Nothing about your order changes because you answered.',
        },
      ],
      paragraphs: [
        'You pre-ordered this and it has been delivered. We would like to know how it went — one click is a complete answer, and you can add a reason if you want to.',
      ],
      action: { label: 'Answer in one click', url: `${APP}/backer/sample-token` },
      reference: REF,
      supportEmail: SUPPORT,
    }),

  internal_post_verification_due: () =>
    renderInternalNotice({
      subject: `First post awaiting verification — ${CAMPAIGN}`,
      headline: 'A first post is waiting for verification.',
      facts: [
        { label: 'Campaign', value: CAMPAIGN },
        { label: 'Post', value: 'https://www.instagram.com/p/CxAbCdEfGhI/' },
        { label: 'Channel', value: 'Instagram' },
        { label: 'Kind', value: 'First submission' },
        { label: 'Who owns it', value: 'Proovd Admin' },
        { label: 'What is due', value: 'The seven §17 checks, against the submitted post' },
      ],
      paragraphs: [
        'Verification releases no money — §17 is explicit that a pass changes only whether later traffic may finalize.',
      ],
      action: {
        label: 'Open the campaign operations queue',
        url: `${APP}/admin/campaign-operations`,
      },
      reference: REF,
      supportEmail: SUPPORT,
    }),
};

/* ── Shared sample builders ────────────────────────────────────────────────── */

function interview(kind: 'confirmed' | 'reminder' | 'rescheduled' | 'canceled') {
  return renderInterviewEmail(kind, {
    founderName: 'Ada',
    productName: CAMPAIGN,
    localTime: 'Thursday 13 August 2026, 10:00 AM MDT',
    utcTime: '2026-08-13 16:00 UTC',
    timezone: 'America/Denver',
    meetingProvider: 'Google Meet',
    meetingLink: 'https://meet.example/abc-defg-hij',
    interviewer: 'Sam at Proovd',
    cancellationReason: kind === 'canceled' ? 'You cancelled from your workspace.' : null,
    nextUpdate: 'when your campaign moves to review',
    reference: REF,
    supportEmail: SUPPORT,
  });
}

function proposal() {
  return {
    recipientName: 'Jo',
    productName: CAMPAIGN,
    versionNumber: 2,
    termsSummary: '22% of the reward subtotal, plus a US$250.00 fixed Creator payment.',
    campaignUrl: `${APP}/creator/campaigns/a1/opportunity`,
    reference: REF,
    supportEmail: SUPPORT,
  };
}

function crossing() {
  return {
    founderName: 'Ada',
    productName: CAMPAIGN,
    campaignUrl: `${APP}/campaigns/c1/home`,
    uniqueActiveBackers: 41,
    threshold: 40,
    closeUtc: CLOSE_UTC,
    reference: REF,
    supportEmail: SUPPORT,
  };
}

function crossingNotice(direction: 'reached' | 'lost') {
  return renderInternalNotice({
    subject: `Threshold ${direction} — campaign c1`,
    headline: `Order threshold ${direction} — campaign c1`,
    facts: [
      { label: 'Unique active Backers', value: direction === 'reached' ? '41' : '39' },
      { label: 'Order threshold', value: '40' },
      { label: 'Measured again at close', value: CLOSE_UTC },
    ],
    paragraphs: [
      'A campaign may cross repeatedly; each crossing is its own recorded event and notifies once. Nothing about the charge decision changes until close, when the threshold is decided from the state at exactly that instant.',
    ],
    action: { label: 'Open campaign operations', url: `${APP}/admin/campaign-operations` },
    reference: REF,
    supportEmail: SUPPORT,
  });
}

function released(kindLabel: string) {
  return renderPaymentReleased({
    kindLabel,
    campaignTitle: CAMPAIGN,
    amount: 'US$1,281.96',
    shareAmount: 'US$3,204.90',
    scheduleLine:
      'This is your first payment — 40% of your eligible Founder share, scheduled Day 3 after close. The remaining payment follows the Day 14 schedule.',
    earlyLine: null,
    taxNote:
      'Sales tax collected from Backers is not part of your share and is remitted separately.',
    paymentsUrl: `${APP}/campaigns/c1/results`,
    reference: REF,
    supportEmail: SUPPORT,
  });
}

function accountStatus(role: 'founder' | 'affiliate') {
  return renderPlainNotice({
    subject: 'Action on your Proovd payout account — more information required',
    headline: 'Stripe needs more information before you can be paid.',
    facts: [
      { label: 'Status', value: 'More information required' },
      { label: 'Who owns it', value: 'You — Stripe collects it directly, and Proovd never sees it' },
      {
        label: 'What Stripe still needs',
        value: role === 'founder' ? 'company.tax_id, representative.dob' : 'individual.id_number',
      },
    ],
    paragraphs: [
      'Open your payout setup and supply what is listed below. It usually takes a few minutes.',
      'Stripe collects and holds the identity, tax, and bank details for this account. Proovd never asks for them and never stores them.',
    ],
    action: { label: 'Open payout setup', url: `${APP}/payouts` },
    reference: 'acct_1PxSampleAccount',
    supportEmail: SUPPORT,
  });
}

function payout() {
  return {
    campaignTitle: CAMPAIGN,
    moneyStatusBlock: 'Paid out — US$954.00 reached your bank account.',
    partnershipUrl: `${APP}/creator/campaigns/a1/close`,
    reference: REF,
    supportEmail: SUPPORT,
  };
}

function refund(status: 'started' | 'completed' | 'failed') {
  const word = status === 'started' ? 'started' : status === 'completed' ? 'completed' : 'failed';
  return renderRefundNotice({
    statusWord: word,
    campaignTitle: CAMPAIGN,
    noticeBody: [
      `Your refund is ${word}.`,
      '',
      'Amount: US$100.86',
      'Back to: the original payment method',
      'Started: 2026-09-20',
      'Banks typically take 5–10 business days. We cannot promise an exact date.',
      `Status: ${word}`,
    ].join('\n'),
    action: 'View your pre-order',
    actionUrl: `${APP}/backer/sample-token`,
    reference: 'RF-8H2K-4M9Q',
    supportEmail: SUPPORT,
  });
}

function enforcement(outcomeWord: string, audience: 'founder' | 'affiliate' | 'backer') {
  return renderEnforcementNotice({
    outcomeWord,
    campaignTitle: CAMPAIGN,
    explanation:
      'A recorded review found the campaign page described a delivery commitment the build never carried.',
    moneyFact:
      audience === 'backer'
        ? 'No money has been charged, and no charge will be attempted.'
        : 'Unreleased payments are restricted while this stands.',
    nextStep:
      audience === 'affiliate'
        ? 'You may appeal in writing within five business days, by 2026-09-25 23:59 UTC.'
        : 'Proovd owns the next step and will contact you with the outcome.',
    reference: REF,
    supportEmail: SUPPORT,
  });
}

/**
 * §20's ten mid-campaign messages, as representative renders.
 *
 * One builder rather than ten literals: they are the same four facts to three
 * audiences, and ten near-identical blocks here would be ten places for a
 * sample to drift from what the sender passes. The senders themselves are ten
 * distinct functions with distinct copy — this is the contract's fixture, not
 * a second copy of the templates.
 */
function midCampaign(
  audience: 'founder' | 'affiliate' | 'internal',
  moment: string,
): Promise<RenderedMessage> {
  const facts = [
    { label: 'Campaign', value: CAMPAIGN },
    { label: 'Time left when asked', value: '212 hours' },
    { label: 'Campaign closes', value: '2026-09-29 17:00 UTC' },
    { label: 'Status', value: moment },
  ];
  const action = {
    label: 'Open the campaign',
    url:
      audience === 'internal'
        ? `${APP}/admin/creators?campaignId=c1`
        : audience === 'founder'
          ? `${APP}/campaigns/c1/roster`
          : `${APP}/creator/campaigns/a1/partnership`,
  };
  const render = audience === 'internal' ? renderInternalNotice : renderPlainNotice;
  return render({
    subject: `Mid-campaign Creator ${moment} — ${CAMPAIGN}`,
    headline: `Mid-campaign Creator ${moment} — ${CAMPAIGN}`,
    facts,
    paragraphs: [
      'The terms above were fixed when the Creator was asked and are measured against the time that is left, not a full campaign.',
      'Clicks count from activation onward. Nothing is credited backwards.',
    ],
    action,
    reference: REF,
    supportEmail: SUPPORT,
  });
}

export const CATALOG_KEYS = Object.keys(NOTIFICATION_CATALOG) as NotificationEventKey[];
