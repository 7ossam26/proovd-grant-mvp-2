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
import { sweepUnclaimedDrafts } from '../invitations/retention.js';

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

export interface SchedulerDeps {
  db: Database;
  tokens: TokenService;
  connectionString: string;
  /** Structured log sink. Job outcomes belong in the operational record. */
  log: (message: string, detail?: Record<string, unknown>) => void;
}

export interface Scheduler {
  boss: PgBoss;
  /** Runs the sweep now, outside the schedule. Used by tests and by Admin. */
  runRetentionNow: () => Promise<void>;
  stop: () => Promise<void>;
}

export async function startScheduler({
  db,
  tokens,
  connectionString,
  log,
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

  return {
    boss,
    runRetentionNow: async () => {
      await boss.send(UNCLAIMED_DRAFT_RETENTION_JOB, {});
    },
    stop: async () => {
      await boss.stop({ graceful: true });
    },
  };
}
