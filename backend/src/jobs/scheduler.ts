/**
 * Scheduled work — pg-boss on the same Postgres (tech-stack §13).
 *
 * One job so far: the §25.8 unclaimed-draft retention sweep. Later phases add
 * the close batch, capture retries, and the reminder jobs, and they all land
 * here rather than in a second scheduler.
 *
 * ── Why pg-boss and not a cron container ────────────────────────────────────
 * The work is transactional and the transactions are on this database. A job
 * runner that lives in the same Postgres cannot drift out of step with the
 * data it is operating on, cannot run while a migration is half-applied, and
 * leaves its own audit trail in tables the same backups cover.
 *
 * ── The sweep is safe to run twice ──────────────────────────────────────────
 * An anonymised draft no longer matches `findDueDrafts`, and the database
 * refuses to un-anonymise one regardless (migration 0005). So a duplicate
 * delivery, an overlapping schedule, or a crash mid-run are all recoverable by
 * running it again — which is the §28.3 property every job in this system has
 * to have.
 *
 * ── Failing to start is not a reason to serve traffic without jobs ──────────
 * `startScheduler` throws if pg-boss will not start. A deployment whose
 * retention sweep never runs is one that quietly keeps personal data past the
 * window §25.8 sets, and it should fail visibly at boot instead.
 */

import { PgBoss } from 'pg-boss';
import type { Database } from '../db/client.js';
import type { TokenService } from '../auth/token-service.js';
import { createAuditWriter } from '../auth/audit.js';
import { sweepUnclaimedDrafts } from '../invitations/retention.js';
import {
  sendDueReminders,
  sweepAbandonedBookings,
  reconcilePendingBookings,
} from '../interviews/jobs.js';
import {
  sweepListingDeadlines,
  type DeadlineEvaluationDeps,
} from '../payments/listing-clocks.js';
import { sweepScheduledLaunches } from '../launch/launch.js';
import { sweepCreatorReplacementDeadlines } from '../launch/creator-failure.js';
import { notifyCampaignLive, type LaunchNotificationContext } from '../launch/notifications.js';
import { sweepDiscovery } from '../campaign/discovery.js';
import { notifyListingRefund } from '../payments/listing-notifications.js';
import { sweepPrechargeReminders } from '../reservations/reminder.js';
import { sweepThresholdCrossings } from '../live/thresholds.js';
import { sweepCampaignCloses } from '../close/close-batch.js';
import { sweepRetryWindowEnds } from '../close/retry.js';
import { sweepTransferRetries } from '../close/earnings.js';
import type { Scheduler as SchedulerPort } from '../interviews/calcom.js';
import type { Notifier } from '../notifications/send.js';
import type { InterviewNotificationContext } from '../interviews/notifications.js';

/**
 * §3 bans `Day 30` as a name anywhere, including job names. The window is 30
 * calendar days; the job is named for what it does.
 */
export const UNCLAIMED_DRAFT_RETENTION_JOB = 'unclaimed-draft-retention';

/**
 * Daily. The window is 30 calendar days, so an hourly sweep would buy hours of
 * precision on a month-long deadline in exchange for 24× the churn. Stated in
 * UTC because the schedule is operational, not a customer-facing deadline —
 * §29.6's business-day rules govern the latter and this is not one.
 */
export const RETENTION_SCHEDULE_CRON = '0 3 * * *';

/**
 * §12's interview jobs, added Phase 09b.
 *
 * `interview-reminders` sends §27.3's reminder for every confirmed booking
 * inside the §6 lead window, and does nothing at all while that setting is
 * unset. `interview-reconciliation` asks the provider about bookings we may
 * have missed a webhook for, and marks a never-confirmed slot that has now
 * passed as abandoned.
 *
 * Both are safe to run twice — the reminder's dedup swallows a repeat and the
 * abandonment sweep's conditional UPDATE matches nothing on a second pass —
 * which is the §28.3 property every job here has to have.
 */
export const INTERVIEW_REMINDER_JOB = 'interview-reminders';
export const INTERVIEW_RECONCILIATION_JOB = 'interview-reconciliation';

/**
 * Phase 11's two §6 clocks — the 72-hour response deadline (§14.6) and the
 * 48-hour free-cancellation window (§31.6). The deadlines themselves were
 * computed at payment and stored (§29.6); the sweep only notices them, exactly
 * once each, and routes the reached deadline to Admin until Phase 12's
 * evaluation exists. Safe to run twice: each firing pivots on
 * `idempotency_keys`.
 */
export const LISTING_DEADLINE_JOB = 'listing-deadlines';

/**
 * Phase 14a's two §17/§29.6 jobs.
 *
 * `campaign-launch` runs the idempotent five-step activation for every campaign
 * whose scheduled `campaign_live_at` has arrived; each launch is independently
 * idempotent, so a sweep that runs twice launches each once (§33.4.6).
 * `creator-replacement-deadline` fails a §29.6 replacement window that passed
 * with no ready replacement — refunding the full listing total through Phase 11's
 * one path — and is likewise safe to run twice.
 */
export const CAMPAIGN_LAUNCH_JOB = 'campaign-launch';
export const CREATOR_REPLACEMENT_JOB = 'creator-replacement-deadline';

/**
 * Phase 14b's §18 discovery sweep. Opens Day 8 browse/index eligibility for
 * every live campaign whose seventh day has passed, and sends each Founder the
 * one factual notice. Safe to run twice: the open is a conditional UPDATE and
 * the notice dedups on the campaign.
 */
export const CAMPAIGN_DISCOVERY_JOB = 'campaign-discovery';

/**
 * Phase 15b's §20 pre-charge reminder. Runs on the shared 15-minute tick; the
 * ~24-hour window means minute-level accuracy is not needed, and the reminder
 * dedups on the reservation so a repeated tick sends nothing twice.
 */
export const PRECHARGE_REMINDER_JOB = 'precharge-reminder';

/**
 * Phase 17a's §20 threshold reconciliation.
 *
 * **Not** a scheduled engagement email (§33.6.11). It sends nothing unless a
 * campaign genuinely crossed its threshold since the last evaluation — the
 * crossing is deduplicated by state transition, so a run with no crossing writes
 * nothing and sends nothing. Its purpose is to catch count changes that did not
 * go through a Backer action, such as §26.7's kill closing active pre-orders.
 *
 * It is a safety net, not the primary path: a campaign that crossed up and back
 * down between two runs owes two notices this could never send, which is why
 * every mutation site calls `evaluateAndNotifyThreshold` directly.
 */
export const THRESHOLD_RECONCILIATION_JOB = 'threshold-reconciliation';

/**
 * Phase 18a's §21 close batch.
 *
 * Closes every live campaign whose `campaign_close_at` has arrived and resumes
 * every batch left incomplete (§33.7.12). Independently idempotent all the way
 * down — a sweep that runs twice, overlaps itself, or dies mid-run charges
 * nothing twice (§33.7.7). Its own tighter cron: the anchor itself gates
 * cancellation and joining, but a card should be charged close to the minute
 * the consent named, and fifteen minutes of drift is more than five buys.
 */
export const CAMPAIGN_CLOSE_JOB = 'campaign-close';
export const CAMPAIGN_CLOSE_CRON = '*/5 * * * *';

/**
 * Phase 19a's §33.8.4 Transfer retry.
 *
 * A Transfer creation failure is a synchronous API error with no
 * `transfer.failed` webhook behind it (§32.3), so a sweep is the recovery
 * path: every `failed` row and every stale `initiated` claim (a crash between
 * claim and confirmation) is re-driven through the same service under the SAME
 * stable key — the retry is the same Transfer at Stripe, never a second.
 */
export const AFFILIATE_TRANSFER_RETRY_JOB = 'affiliate-transfer-retry';
export const AFFILIATE_TRANSFER_RETRY_CRON = '*/15 * * * *';

/**
 * Every fifteen minutes. §6 states the lead time in hours, so the reminder only
 * has to be accurate to well inside an hour; a minutely job would buy nothing
 * and quadruple the churn. The reconciliation runs on the same tick because a
 * missed webhook and an unsent reminder are noticed by the same person.
 */
export const INTERVIEW_SCHEDULE_CRON = '*/15 * * * *';

export interface SchedulerDeps {
  db: Database;
  tokens: TokenService;
  connectionString: string;
  /** Structured log sink. Job outcomes belong in the operational record. */
  log: (message: string, detail?: Record<string, unknown>) => void;
  /** §12's interview jobs. Phase 09b. */
  interviews: {
    scheduler: SchedulerPort;
    notifier: Notifier;
    context: InterviewNotificationContext;
  };
  /** The §14.6 evaluation's needs (Phase 12a). Optional: without a gateway the
      sweep still records reached deadlines and the evaluation waits. */
  listing?: DeadlineEvaluationDeps;
  /** Phase 14a. The launch-live notifications; without it the launch sweep still
      moves state, it just sends no confirmation. The §29.6 replacement refund
      reuses `listing.gateway`. */
  launch?: {
    notifier: Notifier;
    context: LaunchNotificationContext;
  };
  /** Phase 15b. The §20 pre-charge reminder; without it the reminder does not
      send (an unconfigured transport would refuse loudly anyway). */
  backer?: {
    notifier: Notifier;
    fromAddress: string;
    appBaseUrl: string;
  };
}

export interface Scheduler {
  boss: PgBoss;
  /** Runs the sweep now, outside the schedule. Used by tests and by Admin. */
  runRetentionNow: () => Promise<void>;
  /** Runs the §12 interview jobs now. Used by tests and by Admin. */
  runInterviewJobsNow: () => Promise<void>;
  /** Runs the §14.6/§31.6 deadline sweep now. Used by tests and by Admin. */
  runListingDeadlinesNow: () => Promise<void>;
  /** Runs the §17 launch sweep and §29.6 replacement sweep now. */
  runLaunchJobsNow: () => Promise<void>;
  /** Runs the §18 Day 8 discovery sweep now. Used by tests and by Admin. */
  runDiscoveryNow: () => Promise<void>;
  /** Runs the §20 pre-charge reminder sweep now. Used by tests and by Admin. */
  runPrechargeRemindersNow: () => Promise<void>;
  /** Runs the §20 threshold reconciliation now. Used by tests and by Admin. */
  runThresholdReconciliationNow: () => Promise<void>;
  /** Runs the §21 close batch sweep now. Used by tests and by Admin. */
  runCampaignCloseNow: () => Promise<void>;
  /** Runs the §33.8.4 Transfer retry sweep now. Used by tests and by Admin. */
  runTransferRetriesNow: () => Promise<void>;
  stop: () => Promise<void>;
}

export async function startScheduler({
  db,
  tokens,
  connectionString,
  log,
  interviews,
  listing,
  launch,
  backer,
}: SchedulerDeps): Promise<Scheduler> {
  const boss = new PgBoss({ connectionString, schema: 'pgboss' });

  boss.on('error', (error: unknown) => {
    log('job runner error', { error: error instanceof Error ? error.message : String(error) });
  });

  await boss.start();
  await boss.createQueue(UNCLAIMED_DRAFT_RETENTION_JOB);

  await boss.work(UNCLAIMED_DRAFT_RETENTION_JOB, async () => {
    const result = await sweepUnclaimedDrafts(db, tokens);
    // Counts only. The whole point of the sweep is that this content stops
    // existing, so naming what it removed in a log would defeat it (§28.1's
    // rule about raw tokens is the same instinct applied to a different value).
    log('unclaimed draft retention sweep complete', {
      draftsAnonymised: result.draftIds.length,
      prospectsAnonymised: result.prospectIds.length,
      tokensRevoked: result.tokensRevoked,
    });
  });

  await boss.schedule(UNCLAIMED_DRAFT_RETENTION_JOB, RETENTION_SCHEDULE_CRON, undefined, {
    tz: 'UTC',
  });

  /* ── §12's interview jobs (Phase 09b) ─────────────────────────────────── */

  await boss.createQueue(INTERVIEW_REMINDER_JOB);
  await boss.work(INTERVIEW_REMINDER_JOB, async () => {
    const result = await sendDueReminders(db, interviews.notifier, interviews.context);
    if (result.leadHours === null) {
      // §6 names the lead time and fixes no value. Saying so every run is how
      // an operator finds out that no reminders are going anywhere — a silent
      // no-op would look identical to "nothing was due" (§1.4).
      log('interview reminders skipped: §6 lead time is not configured');
      return;
    }
    log('interview reminders complete', {
      leadHours: result.leadHours,
      considered: result.considered,
      sent: result.sent,
      duplicates: result.duplicates,
      skipped: result.skipped,
    });
  });

  await boss.createQueue(INTERVIEW_RECONCILIATION_JOB);
  await boss.work(INTERVIEW_RECONCILIATION_JOB, async () => {
    const abandoned = await sweepAbandonedBookings(db);
    const reconciled = await reconcilePendingBookings(
      db,
      interviews.scheduler,
      interviews.notifier,
      interviews.context,
    );
    log('interview reconciliation complete', {
      abandoned: abandoned.abandoned.length,
      checked: reconciled.checked,
      confirmed: reconciled.confirmed.length,
      canceled: reconciled.canceled.length,
      providerUnavailable: reconciled.unavailable,
    });
  });

  await boss.schedule(INTERVIEW_REMINDER_JOB, INTERVIEW_SCHEDULE_CRON, undefined, { tz: 'UTC' });
  await boss.schedule(INTERVIEW_RECONCILIATION_JOB, INTERVIEW_SCHEDULE_CRON, undefined, {
    tz: 'UTC',
  });

  /* ── Phase 11's listing-deadline clocks (§14.6, §31.6) ─────────────────── */

  const audit = createAuditWriter(db);
  await boss.createQueue(LISTING_DEADLINE_JOB);
  await boss.work(LISTING_DEADLINE_JOB, async () => {
    const result = await sweepListingDeadlines(db, audit, new Date(), listing);
    // Every run says what it noticed — a quiet run and a dead job must not
    // look alike when the thing being watched is a refund promise (§1.4).
    log('listing deadline sweep complete', {
      responseDeadlinesReached: result.responseDeadlinesReached.length,
      freeWindowsClosed: result.freeWindowsClosed.length,
      evaluations: result.evaluations.map(({ campaignId, result: r }) => ({
        campaignId,
        status: r.status,
        outcome: r.status === 'evaluated' ? r.outcome : undefined,
      })),
    });
  });
  await boss.schedule(LISTING_DEADLINE_JOB, INTERVIEW_SCHEDULE_CRON, undefined, { tz: 'UTC' });

  /* ── Phase 14a's launch and §29.6 replacement sweeps ───────────────────── */

  await boss.createQueue(CAMPAIGN_LAUNCH_JOB);
  await boss.work(CAMPAIGN_LAUNCH_JOB, async () => {
    const { result, launches } = await sweepScheduledLaunches(db, { audit });
    if (launch) {
      for (const outcome of launches) {
        if (outcome.status === 'launched') {
          await notifyCampaignLive(db, launch.notifier, launch.context, {
            campaignId: outcome.campaignId,
            activatedAssociationIds: outcome.activatedAssociationIds,
            campaignCloseAt: outcome.campaignCloseAt,
          });
        }
      }
    }
    log('campaign launch sweep complete', {
      launched: result.launched.length,
      alreadyLive: result.alreadyLive.length,
    });
  });
  await boss.schedule(CAMPAIGN_LAUNCH_JOB, INTERVIEW_SCHEDULE_CRON, undefined, { tz: 'UTC' });

  await boss.createQueue(CREATOR_REPLACEMENT_JOB);
  await boss.work(CREATOR_REPLACEMENT_JOB, async () => {
    // The §29.6 miss path refunds the full listing total, so it needs a gateway.
    // Reuse the listing deps; without them the sweep cannot refund and does not run.
    if (!listing) {
      log('creator replacement sweep skipped: no Stripe gateway configured');
      return;
    }
    const { result, outcomes } = await sweepCreatorReplacementDeadlines(
      { db, gateway: listing.gateway, audit },
      new Date(),
    );
    if (listing.notifier && listing.notificationContext) {
      for (const outcome of outcomes) {
        if (outcome.status === 'failed') {
          await notifyListingRefund(db, listing.notifier, listing.notificationContext, {
            campaignId: outcome.failure.campaignId,
          });
        }
      }
    }
    log('creator replacement sweep complete', {
      failed: result.failed.length,
      refundsRetried: result.refundsRetried.length,
    });
  });
  await boss.schedule(CREATOR_REPLACEMENT_JOB, INTERVIEW_SCHEDULE_CRON, undefined, { tz: 'UTC' });

  /* ── Phase 14b's §18 discovery sweep ───────────────────────────────────── */

  await boss.createQueue(CAMPAIGN_DISCOVERY_JOB);
  await boss.work(CAMPAIGN_DISCOVERY_JOB, async () => {
    // The §18 notice reuses the launch notifier/context; without it the switch
    // still opens (the page stops being noindex) and sends no email.
    const { opened } = await sweepDiscovery(
      db,
      {
        audit,
        ...(launch ? { notifier: launch.notifier, context: launch.context } : {}),
      },
      new Date(),
    );
    log('discovery sweep complete', { opened: opened.length });
  });
  await boss.schedule(CAMPAIGN_DISCOVERY_JOB, INTERVIEW_SCHEDULE_CRON, undefined, { tz: 'UTC' });

  /* ── Phase 15b's §20 pre-charge reminder ───────────────────────────────── */

  await boss.createQueue(PRECHARGE_REMINDER_JOB);
  await boss.work(PRECHARGE_REMINDER_JOB, async () => {
    if (!backer) {
      log('pre-charge reminder skipped: no notifier configured');
      return;
    }
    const result = await sweepPrechargeReminders({
      db,
      notifier: backer.notifier,
      tokenService: tokens,
      fromAddress: backer.fromAddress,
      appBaseUrl: backer.appBaseUrl,
    });
    log('pre-charge reminder sweep complete', { claimed: result.claimed, sent: result.sent });
  });
  await boss.schedule(PRECHARGE_REMINDER_JOB, INTERVIEW_SCHEDULE_CRON, undefined, { tz: 'UTC' });

  /* ── Phase 17a's §20 threshold reconciliation ──────────────────────────── */

  await boss.createQueue(THRESHOLD_RECONCILIATION_JOB);
  await boss.work(THRESHOLD_RECONCILIATION_JOB, async () => {
    const result = await sweepThresholdCrossings(db, {
      audit,
      ...(launch ? { notifier: launch.notifier, context: launch.context } : {}),
    });
    log('threshold reconciliation complete', {
      evaluated: result.evaluated,
      crossings: result.crossings,
    });
  });
  await boss.schedule(THRESHOLD_RECONCILIATION_JOB, INTERVIEW_SCHEDULE_CRON, undefined, {
    tz: 'UTC',
  });

  /* ── Phase 18a's §21 close batch ───────────────────────────────────────── */

  await boss.createQueue(CAMPAIGN_CLOSE_JOB);
  await boss.work(CAMPAIGN_CLOSE_JOB, async () => {
    // The batch creates PaymentIntents, so it needs the gateway; without one
    // the sweep says so loudly rather than quietly closing nothing (§1.4).
    if (!listing) {
      log('campaign close sweep skipped: no Stripe gateway configured');
      return;
    }
    const closeSweepDeps = {
      db,
      gateway: listing.gateway,
      audit,
      ...(launch ? { notifier: launch.notifier, context: launch.context } : {}),
      tokens,
    };
    const { result, batches } = await sweepCampaignCloses(closeSweepDeps, new Date());
    // Phase 18b (§21): the same tick ends every retry window whose stored
    // deadline has passed — recoveries stay captured, the rest drop at US$0,
    // and the campaign enters closed_reconciling. Independently idempotent.
    const windowEnds = await sweepRetryWindowEnds(closeSweepDeps, new Date());
    log('campaign close sweep complete', {
      started: result.started.length,
      resumed: result.resumed.length,
      complete: result.complete.length,
      waitingOnDedup: result.waiting.length,
      batches: batches.map((b) => ({
        campaignId: b.campaignId,
        status: b.status,
        captured: b.captured,
        failed: b.failed,
        dropped: b.dropped,
        errored: b.errored,
      })),
      retryWindowsEnded: windowEnds.map((w) => ({
        campaignId: w.campaignId,
        status: w.status,
        recovered: w.recovered,
        dropped: w.dropped,
        unresolved: w.unresolved,
      })),
    });
  });
  await boss.schedule(CAMPAIGN_CLOSE_JOB, CAMPAIGN_CLOSE_CRON, undefined, { tz: 'UTC' });

  /* ── Phase 19a's §33.8.4 Transfer retry ────────────────────────────────── */

  await boss.createQueue(AFFILIATE_TRANSFER_RETRY_JOB);
  await boss.work(AFFILIATE_TRANSFER_RETRY_JOB, async () => {
    if (!listing) {
      log('affiliate transfer retry sweep skipped: no Stripe gateway configured');
      return;
    }
    const result = await sweepTransferRetries(
      {
        db,
        gateway: listing.gateway,
        audit,
        ...(launch ? { notifier: launch.notifier, context: launch.context } : {}),
      },
      new Date(),
    );
    log('affiliate transfer retry sweep complete', {
      retried: result.retried,
      created: result.created,
    });
  });
  await boss.schedule(AFFILIATE_TRANSFER_RETRY_JOB, AFFILIATE_TRANSFER_RETRY_CRON, undefined, {
    tz: 'UTC',
  });

  return {
    boss,
    runRetentionNow: async () => {
      await boss.send(UNCLAIMED_DRAFT_RETENTION_JOB, {});
    },
    runInterviewJobsNow: async () => {
      await boss.send(INTERVIEW_REMINDER_JOB, {});
      await boss.send(INTERVIEW_RECONCILIATION_JOB, {});
    },
    runListingDeadlinesNow: async () => {
      await boss.send(LISTING_DEADLINE_JOB, {});
    },
    runLaunchJobsNow: async () => {
      await boss.send(CAMPAIGN_LAUNCH_JOB, {});
      await boss.send(CREATOR_REPLACEMENT_JOB, {});
    },
    runDiscoveryNow: async () => {
      await boss.send(CAMPAIGN_DISCOVERY_JOB, {});
    },
    runPrechargeRemindersNow: async () => {
      await boss.send(PRECHARGE_REMINDER_JOB, {});
    },
    runThresholdReconciliationNow: async () => {
      await boss.send(THRESHOLD_RECONCILIATION_JOB, {});
    },
    runCampaignCloseNow: async () => {
      await boss.send(CAMPAIGN_CLOSE_JOB, {});
    },
    runTransferRetriesNow: async () => {
      await boss.send(AFFILIATE_TRANSFER_RETRY_JOB, {});
    },
    stop: async () => {
      await boss.stop({ graceful: true });
    },
  };
}
