/**
 * Founder Flow v2, Session A — the record, the reversions, and the order.
 *
 * The flow's twenty-six screens are Sessions B–F. What Session A owns is the
 * half of the work that has no pixels: four reversions to §9 and §10 as
 * written, one new record family, and the guarantees under both.
 *
 * §33.1.4 through §33.1.9 live in `vetting.test.ts` and pass there. This file
 * is what those tests cannot reach: the database's own refusals on the one new
 * table, the two registers staying in step across the reversion, and the
 * absences the brief requires to stay absent.
 *
 * ── The openness record is a recorded §1 rule 6 deviation ──────────────────
 * Built by explicit product direction, and narrow by construction rather than
 * by intention. Every test below is about something it CANNOT do: hold an
 * amount, exist on an Idea campaign, be edited, or be written twice.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startHarness, type Harness } from './app-harness.js';
import {
  VETTING_STEPS as BACKEND_VETTING_STEPS,
  VETTING_ANSWER_STEPS,
  VETTING_RESUME_POSITIONS,
  VIEWS_RANGES,
} from '../vetting/service.js';
import {
  VETTING_STEP_IDS,
  VETTING_ANSWER_STEP_IDS,
  VIEWS_RANGE_IDS,
  VIEWS_NOT_COLLECTED_LABEL,
  POSSIBLE_CREATOR_RESULT_DISCLOSURES,
  CAMPAIGN_TYPE_LOCK_WARNING,
} from '@proovd/shared';

let h: Harness;

beforeAll(async () => {
  h = await startHarness({}, 'founderflowv2');
}, 120_000);

afterAll(async () => {
  await h?.stop();
});

/** A campaign with its §9 type locked, which is what the openness row needs. */
async function campaignOfType(type: 'pre_build' | 'pre_launch'): Promise<string> {
  const id = randomUUID();
  await h.pool.query(
    `INSERT INTO campaigns (id, status, type, type_locked_at) VALUES ($1, 'vetting_submitted', $2, now())`,
    [id, type],
  );
  return id;
}

const insertOpenness = (campaignId: string, stance: string, type: string) =>
  h.pool.query(
    `INSERT INTO founder_fixed_payment_openness (campaign_id, stance, campaign_type, recorded_by)
     VALUES ($1, $2, $3, 'user:test')`,
    [campaignId, stance, type],
  );

/* ══════════════════════════════════════════════════════════════════════════
   The fixed-payment openness record (§14.2, §14.3, §16 — deviation 3)
   ══════════════════════════════════════════════════════════════════════════ */

describe('the Founder fixed-payment openness record binds nothing', () => {
  it('records a stance on a Product campaign', async () => {
    const campaignId = await campaignOfType('pre_launch');
    await insertOpenness(campaignId, 'open', 'pre_launch');

    const { rows } = await h.pool.query(
      `SELECT stance, campaign_type, superseded_at FROM founder_fixed_payment_openness
        WHERE campaign_id = $1`,
      [campaignId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].stance).toBe('open');
    expect(rows[0].superseded_at).toBeNull();
  });

  // §14.3 prohibits the fixed payment on an Idea Campaign outright, so an
  // openness record for one is unrepresentable rather than merely unused —
  // the 0017/0019 arrangement, which already refuses the same thing at the
  // proposal version, the agreement, and the allocation.
  it('cannot exist for an Idea campaign, by any statement', async () => {
    const campaignId = await campaignOfType('pre_build');

    // Honestly declared: the CHECK refuses it.
    await expect(insertOpenness(campaignId, 'open', 'pre_build')).rejects.toThrow();

    // Lied about: the shape trigger refuses it. Without the trigger the CHECK
    // would read as enforcement and enforce nothing, because 'pre_launch' is a
    // string anybody can type.
    await expect(insertOpenness(campaignId, 'open', 'pre_launch')).rejects.toThrow(
      /answered against/i,
    );

    const { rows } = await h.pool.query(
      `SELECT 1 FROM founder_fixed_payment_openness WHERE campaign_id = $1`,
      [campaignId],
    );
    expect(rows).toHaveLength(0);
  });

  // §9 locks the type at submission. A stance recorded before that could later
  // find itself attached to an Idea campaign, which is exactly what the CHECK
  // above exists to prevent.
  it('cannot exist before the campaign type is locked', async () => {
    const id = randomUUID();
    await h.pool.query(`INSERT INTO campaigns (id, status) VALUES ($1, 'invited_draft')`, [id]);
    await expect(insertOpenness(id, 'open', 'pre_launch')).rejects.toThrow(/not locked/i);
  });

  it('admits three stances and no fourth', async () => {
    for (const stance of ['open', 'not_open', 'undecided']) {
      const campaignId = await campaignOfType('pre_launch');
      await insertOpenness(campaignId, stance, 'pre_launch');
    }
    const campaignId = await campaignOfType('pre_launch');
    await expect(insertOpenness(campaignId, 'probably', 'pre_launch')).rejects.toThrow();
  });

  it('allows one live answer per campaign, and supersession is what makes room', async () => {
    const campaignId = await campaignOfType('pre_launch');
    await insertOpenness(campaignId, 'open', 'pre_launch');
    await expect(insertOpenness(campaignId, 'not_open', 'pre_launch')).rejects.toThrow();

    await h.pool.query(
      `UPDATE founder_fixed_payment_openness SET superseded_at = now() WHERE campaign_id = $1`,
      [campaignId],
    );
    await insertOpenness(campaignId, 'not_open', 'pre_launch');

    const { rows } = await h.pool.query(
      `SELECT stance FROM founder_fixed_payment_openness
        WHERE campaign_id = $1 ORDER BY recorded_at`,
      [campaignId],
    );
    // Two facts, not one edited fact: which answer was live when a Creator was
    // approached is a question somebody may have to answer.
    expect(rows.map((r: { stance: string }) => r.stance)).toEqual(['open', 'not_open']);
  });

  it('refuses to be edited, and refuses to be un-superseded', async () => {
    const campaignId = await campaignOfType('pre_launch');
    await insertOpenness(campaignId, 'open', 'pre_launch');

    await expect(
      h.pool.query(
        `UPDATE founder_fixed_payment_openness SET stance = 'not_open' WHERE campaign_id = $1`,
        [campaignId],
      ),
    ).rejects.toThrow(/immutable/i);

    await h.pool.query(
      `UPDATE founder_fixed_payment_openness SET superseded_at = now() WHERE campaign_id = $1`,
      [campaignId],
    );
    await expect(
      h.pool.query(
        `UPDATE founder_fixed_payment_openness SET superseded_at = NULL WHERE campaign_id = $1`,
        [campaignId],
      ),
    ).rejects.toThrow(/already been superseded/i);
  });

  // The whole of what keeps this out of §14.2's bilateral negotiation. A number
  // here would be the proposal §14.2 says only a Creator may make; a rate would
  // be a fourth answer to §14.3's three §6 settings.
  it('has no column that could hold an amount, a percentage, or a proposal', async () => {
    const { rows } = await h.pool.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'founder_fixed_payment_openness'`,
    );
    const columns = rows.map((r: { column_name: string }) => r.column_name).sort();
    expect(columns).toEqual([
      'campaign_id',
      'campaign_type',
      'id',
      'recorded_at',
      'recorded_by',
      'stance',
      'superseded_at',
    ]);
    for (const forbidden of ['amount', 'cents', 'percent', 'rate', 'proposal', 'version']) {
      expect(columns.some((c: string) => c.includes(forbidden))).toBe(false);
    }
  });

  // §30, and the `relationship_touches` arrangement: the strongest form of
  // "nothing chases anybody" is having nowhere to record a cadence.
  it('has no schedule-shaped column', async () => {
    const { rows } = await h.pool.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'founder_fixed_payment_openness'`,
    );
    const columns = rows.map((r: { column_name: string }) => r.column_name);
    for (const shape of [
      'remind_at',
      'notify_at',
      'recurrence',
      'repeat_interval',
      'next_send_at',
      'cadence',
      'escalate_at',
      'snooze_until',
    ]) {
      expect(columns).not.toContain(shape);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   The four reversions, as registers
   ══════════════════════════════════════════════════════════════════════════ */

describe('the §9 reversion is stated once and restated once', () => {
  it('asks §9 three answers, in §9 order', () => {
    expect([...VETTING_STEP_IDS]).toEqual(['problem', 'solution', 'competition']);
    expect([...BACKEND_VETTING_STEPS]).toEqual([...VETTING_STEP_IDS]);
    expect([...VETTING_ANSWER_STEPS]).toEqual([...VETTING_ANSWER_STEP_IDS]);
  });

  // A position is not an answer. The campaign path has a stored value and no
  // text, and keeping the two lists apart is what lets a Founder who stopped on
  // the path screen resume THERE — the failure the 2026-08-10 mapping produced
  // the moment that screen came back.
  it('separates where a Founder can be from what they answer', () => {
    expect([...VETTING_RESUME_POSITIONS]).toEqual([
      'campaign_path',
      'problem',
      'solution',
      'competition',
    ]);
    expect(VETTING_RESUME_POSITIONS).toContain('campaign_path');
    expect([...VETTING_ANSWER_STEPS]).not.toContain('campaign_path');
  });

  // Retired from COLLECTION only. Records made before 2026-08-18 keep their
  // answer, the CHECK keeps admitting it, and Admin keeps reading it.
  it('keeps the views register in step, and names its absence rather than blanking it', () => {
    expect([...VIEWS_RANGES]).toEqual([...VIEWS_RANGE_IDS]);
    expect(VIEWS_NOT_COLLECTED_LABEL).toMatch(/not collected/i);
    // §16a: not yet populated is not zero — and here it is not even a gap, it
    // is a question nobody was asked. The label has to say which.
    expect(VIEWS_NOT_COLLECTED_LABEL).toMatch(/never asked/i);
  });

  it('states §10 constraints as sentences that render beside the number', () => {
    expect(POSSIBLE_CREATOR_RESULT_DISCLOSURES.length).toBeGreaterThanOrEqual(5);
    const all = POSSIBLE_CREATOR_RESULT_DISCLOSURES.join(' ');
    // §10's own limits: a relevance signal, naming nobody, not the roster,
    // guaranteeing nothing, recruitment possibly under way.
    expect(all).toMatch(/relevance signal/i);
    expect(all).toMatch(/names no Creator/i);
    expect(all).toMatch(/not the list of Creators recruited/i);
    expect(all).toMatch(/guarantees neither/i);
    expect(all).toMatch(/under way/i);
    // §3.1: `affiliate` never reaches a Founder, and a Founder is a customer.
    expect(all).not.toMatch(/\baffiliate/i);
  });

  it('warns that the campaign type is permanent, and locates the lock at submission', () => {
    expect(CAMPAIGN_TYPE_LOCK_WARNING).toMatch(/permanent/i);
    expect(CAMPAIGN_TYPE_LOCK_WARNING).toMatch(/when you submit/i);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   The absences Session A must leave in place
   ══════════════════════════════════════════════════════════════════════════ */

describe('what Session A deliberately did not build', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const backendSrc = path.resolve(here, '..');

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.tsx?$/.test(full)) out.push(full);
    }
    return out;
  }

  // §9's three answers and §12's five optional items are two registers, and
  // they stay two. The flow PRESENTS them as one sequence; merging the storage
  // would quietly turn §12's derived completion into a Founder assertion.
  it('has no table merging the §9 answers with the §12 optional items', async () => {
    const { rows } = await h.pool.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name IN
          ('vetting_answers','founder_answers','onboarding_answers','answers')`,
    );
    expect(rows).toHaveLength(0);
  });

  // Session C owns the six-digit code, and it lands with its screens. A code
  // stored before its screens exists is a mechanism nobody is verifying.
  it('has no storage for a verification code yet', async () => {
    const { rows } = await h.pool.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'secure_tokens' AND column_name LIKE '%code%'`,
    );
    expect(rows).toHaveLength(0);
  });

  // §14.4 caps neither rewards nor voice words, and a cap is a commercial rule
  // (§1 rule 6). The reference's three-card pager is a layout.
  it('has no voice-adjective table beside `campaign_build.brand_voice`', async () => {
    const { rows } = await h.pool.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name IN
          ('campaign_voice_words','campaign_brand_voice_words','voice_words')`,
    );
    expect(rows).toHaveLength(0);
  });

  // §30: nothing chases anybody. No job may read the one new table.
  it('has no job that reads the openness record', () => {
    const jobs = walk(path.join(backendSrc, 'jobs'));
    for (const file of jobs) {
      expect(readFileSync(file, 'utf8')).not.toMatch(/founder_fixed_payment_openness|Openness/);
    }
  });

  // §33.1.8's guardrail, restated at the point the new mechanism could drift
  // onto a phone number. The code Session C adds goes to an EMAIL address.
  it('still has nowhere to record a verified phone', async () => {
    const { rows } = await h.pool.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'founder_claim_profiles' AND column_name LIKE '%verif%'`,
    );
    expect(rows).toHaveLength(0);
  });
});
