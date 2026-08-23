# Proovd outbound email map

This map covers the 132 email events that currently have senders. The typed registry contains 135 events. Three are deliberate non-sends: `founder_email_verification`, `internal_failed_payment_spike`, and `internal_risk_flag`.

Every actual delivery passes through `backend/src/notifications/send.ts`. That layer owns deduplication, provider delivery, audit recording, and the product-wide rule that removes em dashes from the subject, HTML, and plain-text body before delivery.

## Canonical design

All email families now use the visual language from the supplied invite and confirmation-code references:

- Gray `#F1F3F2` canvas
- White `#FAFAFA` 600px message card
- Satoshi with Arial and Helvetica fallbacks
- Forest `#012D10` headings and `#013F17` body copy
- Bright green `#41ED98` rules and primary actions
- One-pixel corners and generous 44px desktop padding
- Quiet `#A2AFA8` support, reference, and legal copy

The founder invitation and founder confirmation-code emails are dedicated implementations because their composition is unique. The remaining emails share the same presentation through their template families.

## Founder email families, 49 active events

| Family | Events and trigger | Renderer |
|---|---|---|
| Invitation | `founder_invitation`, sent or resent by Admin for a founder draft | `founder-invitation.tsx` |
| Email confirmation | `founder_email_code`, requested during invited founder onboarding | `vetting/email-code.tsx` |
| Account access | `founder_password_reset`, requested from the account access flow | `plain.tsx` |
| Interview | Confirmed, reminder, rescheduled, and canceled when the booking lifecycle changes | `founder-interview.tsx` |
| Connected account | `founder_connected_account_status`, when payout account requirements change | `plain.tsx` |
| Listing payment | Receipt and full refund when listing payment state changes | `listing-fee.tsx` |
| Application review | Received, information needed, changes requested, approved, and rejected when Admin records a review transition | `plain.tsx` |
| Campaign review | Submission receipt, changes required, and approval when campaign review transitions | `plain.tsx` |
| Creator matching | Response window, roster update, Creator proposals, proposal revisions, decisions, and three mid-campaign Creator stages | `decisions.tsx` and `plain.tsx` |
| Fixed Creator funding | Request, confirmation, and failure when a fixed-payment funding operation changes state | `plain.tsx` |
| Launch and live | Campaign live, discovery opened, Idea threshold reached or lost, campaign ended, and results ready | `launch.tsx`, `close.tsx`, and `plain.tsx` |
| Founder payments | W-9 prompt or block, single, first, or remaining payment release, payment block, Day 14 result, and early remaining request or result | `founder-payments.tsx` and `fulfillment.tsx` |
| Enforcement and completion | Campaign suspended or killed, work-again response, and next-campaign readiness | `enforcement.tsx` and `plain.tsx` |
| Digest | `founder_activity_digest`, sent only when the Founder enables it | `digest.tsx` |

## Creator email families, 38 active events

| Family | Events and trigger | Renderer |
|---|---|---|
| Recruitment | Campaign-specific invitation, password reset, correction request, signup confirmation, and founder-signup-complete notice | `affiliate-invitation.tsx`, `affiliate-signup-confirmed.tsx`, `affiliate-preparing-available.tsx`, and `plain.tsx` |
| Opportunity | Formal opportunity available, proposal submitted, founder revision, founder decision, proposal expiry, accept confirmation, and decline confirmation | `affiliate-formal-opportunity.tsx` and `decisions.tsx` |
| Readiness and launch | Disclosure and tracking available, fixed funding complete, first-post pass, correction or rejection, completion decision, campaign live, and campaign closed | `launch.tsx`, `earnings.tsx`, and `plain.tsx` |
| Mid-campaign | Invitation, readiness, and activation when a Creator is added after launch | `plain.tsx` |
| Earnings | Commission finalized, transfer created, transfer failure, transfer reversal, transfer update, payout paid, payout failed, and connected-account information required | `earnings.tsx` and `plain.tsx` |
| Safety and policy | Warning, suspension, and policy reacceptance when Admin records an enforcement transition | `enforcement.tsx` and `plain.tsx` |
| Founder signals | Work-again request, mediated meeting request, and founder post acknowledgement | `plain.tsx` |
| Digest | `affiliate_activity_digest`, sent only when the Creator enables it | `digest.tsx` |

## Backer email families, 21 active events

| Family | Events and trigger | Renderer |
|---|---|---|
| Pre-order | Confirmation, pre-charge reminder, and cancellation confirmation | `backer-preorder.tsx`, `backer-precharge-reminder.tsx`, and `backer-cancellation.tsx` |
| Charge lifecycle | Threshold miss with no charge, charge receipt, failed charge, retry success, and retry dropped | `close.tsx` and `plain.tsx` |
| Refunds | Refund started, completed, and failed when the refund provider state changes | `backer-refund.tsx` |
| Support | Request received, founder response, and support follow-up | `plain.tsx` |
| Campaign following | Follow confirmation and campaign update digest | `plain.tsx` and `digest.tsx` |
| Delivery and feedback | Delivery notice and satisfaction survey | `fulfillment.tsx` and `plain.tsx` |
| Enforcement | Campaign suspended or killed | `enforcement.tsx` |
| Access | Magic-link reissue | `plain.tsx` |

## Internal email families, 24 active events

| Family | Events and trigger | Renderer |
|---|---|---|
| Founder intake | Invitation claimed, interview changed, listing paid deadline started, campaign submitted, and founder application submitted | `plain.tsx` |
| Matching operations | Proposal awaiting response and four mid-campaign Creator operations | `plain.tsx` |
| Funding and verification | Fixed funding received or failed, post verification due, and deliverable verification due | `plain.tsx` |
| Campaign operations | Threshold reached or lost, charge batch result, retry reconciliation complete, and money decisions due | `plain.tsx` |
| Payment and compliance | Missing W-9 and Day 14 due | `plain.tsx` |
| Support and safety | Dispute opened, support SLA breach, and work-again request | `plain.tsx` |

## Exact subject and preview requirements

| Email | Subject | Preview |
|---|---|---|
| Founder invitation | `[Founder name], [Company name]'s first campaign is set up, come claim it` | `We filled it in from our call, read it over, fix what we got wrong, and it’s yours.` |
| Founder confirmation code | `Your proovd confirmation code` | `Type it in to confirm it's you it expires in 10 minutes.` |

## Source-of-truth files

- Event inventory: `shared/src/notifications/registry.ts`
- Active event constants: `backend/src/notifications/events.ts`
- Deliberate non-sends: `backend/src/notifications/unsent.ts`
- Sample render catalog: `backend/src/notifications/catalog.ts`
- Delivery and deduplication: `backend/src/notifications/send.ts`
- Template families: `backend/src/notifications/templates/`
