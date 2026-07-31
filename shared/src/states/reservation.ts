/**
 * Reservation machine — Spec §23.5 (11 states). Naming (§3): `reservation`
 * is internal only; the customer-facing word is "Pre-order".
 *
 * Edges follow the §21 close batch and §24.8 refund contract. The reversals
 * §23.5 forbids are structurally absent: every no-charge terminal
 * (`reserved_canceled`, `threshold_not_met_no_charge`, `killed_no_charge`,
 * `capture_failed_dropped`) has zero outgoing edges, so "charge after valid
 * cancellation" (§24.9) cannot be expressed as a transition — it can only be
 * a new refund case. A successful SetupIntent stays historical even after
 * cancellation; history rows are append-only and never rewritten (§23.5,
 * §29.7).
 */

import { defineMachine } from './machine.js';

export const RESERVATION_STATUSES = [
  'reserved_active',
  'reserved_canceled',
  'threshold_not_met_no_charge',
  'pending_capture',
  'capture_failed_retrying',
  'capture_failed_dropped',
  'captured',
  'refunded',
  'reversed',
  'disputed',
  'killed_no_charge',
] as const;

export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export const reservationMachine = defineMachine<ReservationStatus>(
  'reservation',
  RESERVATION_STATUSES,
  {
    // §18: Backer cancellation ends at close; §21 step 5: Idea threshold miss;
    // §21 step 6: eligible reservations lock to pending_capture; §29.7/§33.9.8:
    // pre-charge kill closes without charge.
    reserved_active: [
      'reserved_canceled',
      'threshold_not_met_no_charge',
      'pending_capture',
      'killed_no_charge',
    ],
    // §21 step 6: capture succeeds, fails retryably, or is dropped without a
    // PaymentIntent (unusable tax calculation). A kill during the batch is
    // still pre-charge for an uncharged reservation.
    pending_capture: ['captured', 'capture_failed_retrying', 'capture_failed_dropped', 'killed_no_charge'],
    // §21: fixed 48-hour window → captured or dropped; an uncharged retrying
    // reservation on a killed campaign is never charged (§29.7).
    capture_failed_retrying: ['captured', 'capture_failed_dropped', 'killed_no_charge'],
    // §24.8 after charge: refund, reversal, or dispute.
    captured: ['refunded', 'reversed', 'disputed'],
    // §24.8/§24.11: a dispute resolves to money returned (refunded/reversed)
    // or, when won on evidence, the charge stands again.
    disputed: ['captured', 'refunded', 'reversed'],
    // Terminal. §23.5/§24.9: no path out of a no-charge or money-returned state.
    reserved_canceled: [],
    threshold_not_met_no_charge: [],
    capture_failed_dropped: [],
    refunded: [],
    reversed: [],
    killed_no_charge: [],
  },
);
