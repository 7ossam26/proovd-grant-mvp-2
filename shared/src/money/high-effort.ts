/**
 * High-effort classification — Spec §12.
 *
 * `high_effort = true` only when ALL THREE are absent at calculation time:
 * no completed Visuals, no completed Branding, no scheduled/confirmed
 * interview. High-effort controls only whether an Affiliate can bid a
 * percentage above the base; it does not control fixed-payment availability.
 *
 * §12 requires storing the three inputs, the result, the calculation time,
 * and the actor. This function returns the full record so the caller persists
 * exactly what was classified — the kernel does not invent its own clock or
 * actor.
 */

export interface HighEffortInputs {
  visualsCompleted: boolean;
  brandingCompleted: boolean;
  /** True when an interview is scheduled or confirmed (§12 wording). */
  interviewScheduledOrConfirmed: boolean;
}

export interface HighEffortClassification {
  inputs: HighEffortInputs;
  highEffort: boolean;
  calculatedAt: Date;
  /** Who/what triggered the calculation — e.g. 'system:listing_fee_preview', 'admin:<id>'. */
  actor: string;
}

export function classifyHighEffort(
  inputs: HighEffortInputs,
  calculatedAt: Date,
  actor: string,
): HighEffortClassification {
  const highEffort =
    !inputs.visualsCompleted &&
    !inputs.brandingCompleted &&
    !inputs.interviewScheduledOrConfirmed;

  return { inputs: { ...inputs }, highEffort, calculatedAt, actor };
}
