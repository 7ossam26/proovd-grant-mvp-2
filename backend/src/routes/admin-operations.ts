/**
 * The §26.5, §26.6, §31.7, §31.9, and §33.12.4 Admin routes (Phase 16a, 23b).
 *
 * ── The four reads came back on 2026-08-19 ──────────────────────────────────
 * The ledger, the money controls, the risk panel, and the §31.9 scoreboard were
 * deleted with the old dashboard (`2f7aeed`) — not merely unmounted: their
 * SERVICES went too, and `backend/src/tests/measurement.test.ts` with them. That
 * suite is the integration half of §33.12.6 and §33.12.7, two of the 131 named
 * acceptance tests, so from that commit until this one they were not run at all.
 * They are restored here with the Explore screens that read them.
 *
 * ── Which routes take the freshness gate ────────────────────────────────────
 * §5.1 names the category: "money movement, refund, connected-account, campaign
 * kill/suspend, and other high-impact actions". Reading the ledger, the money
 * controls, or the risk panel is *looking*, and making an Admin reauthenticate
 * to look teaches them to reauthenticate reflexively, which is how the gate
 * stops meaning anything (the reasoning `admin.ts` already records for
 * settings).
 *
 * So: every read is `admin` only. Recording a §31.7 seller tax readiness and
 * executing a §33.12.4 override both take `fresh` — the first gates live tax
 * collection, the second is §26.6's high-impact action by definition.
 *
 * The *preview* also takes `fresh`. It writes a row and it is the step that
 * makes the override possible; letting it run on a stale session would mean the
 * reauthentication happened after the Admin had already decided.
 */

import { Router, type RequestHandler } from 'express';
import express from 'express';
import type { Database } from '../db/client.js';
import type { Auth } from '../auth/auth.js';
import { requireAdmin, requireFreshSession } from '../auth/guards.js';
import { readAdminReauthWindowSeconds } from '../settings/service.js';
import {
  listLedger,
  exportLedger,
  countBackersAndTransactions,
  type LedgerFilters,
  type ReservationStatusFilter,
} from '../admin/ledger.js';
import { readMoneyControls } from '../admin/money-controls.js';
import { readRiskPanel, readSellerTaxReadiness, recordSellerTaxReadiness } from '../admin/risk.js';
import { readScoreboard } from '../measurement/service.js';
import {
  previewHighImpactAction,
  recordOverride,
  listOverrides,
  AUTO_POPULATED_FIELDS,
} from '../admin/high-impact.js';
import { OVERRIDABLE_FIELDS, LEDGER_DIMENSION_KEYS, RISK_SIGNAL_KEYS } from '../admin/logic.js';

export const ADMIN_OPS_BASE_PATH = '/api/admin';

export interface AdminOperationsRouterDeps {
  db: Database;
  auth: Auth;
  /** `test` | `live`. Readiness and risk are mode-scoped (§32.2). */
  mode: string;
}

function actorOf(req: express.Request): string {
  return `user:${req.authUser?.id ?? 'unknown'}`;
}

function securityContext(req: express.Request): { mfaContext: string; reauthContext: string } {
  const session = req.authSession;
  return {
    mfaContext: 'password_session_admin_role_verified',
    reauthContext: session
      ? `session_established_at=${session.createdAt.toISOString()}`
      : 'session_unavailable',
  };
}

/** Query-string parsing kept in one place so the screen and the export agree. */
function filtersFrom(query: express.Request['query']): LedgerFilters {
  const str = (k: string): string | undefined => {
    const v = query[k];
    return typeof v === 'string' && v.length > 0 ? v : undefined;
  };
  const bool = (k: string): boolean | undefined => {
    const v = str(k);
    return v === undefined ? undefined : v === 'true';
  };
  const date = (k: string): Date | undefined => {
    const v = str(k);
    if (!v) return undefined;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? undefined : d;
  };
  const cents = (k: string): bigint | undefined => {
    const v = str(k);
    if (!v || !/^\d+$/.test(v)) return undefined;
    return BigInt(v);
  };

  const statusesRaw = str('statuses');
  const statuses = statusesRaw
    ? (statusesRaw.split(',').filter(Boolean) as ReservationStatusFilter[])
    : undefined;

  const filters: LedgerFilters = {};
  const assign = <K extends keyof LedgerFilters>(k: K, v: LedgerFilters[K]) => {
    if (v !== undefined) filters[k] = v;
  };

  assign('campaignId', str('campaignId'));
  assign('founderUserId', str('founderUserId'));
  assign('source', str('source') as LedgerFilters['source']);
  assign('associationId', str('associationId'));
  assign('reservedFrom', date('reservedFrom'));
  assign('reservedTo', date('reservedTo'));
  assign('statuses', statuses);
  assign('hasSetupIntent', bool('hasSetupIntent'));
  assign('refundDispute', str('refundDispute') as LedgerFilters['refundDispute']);
  assign('consentVersion', str('consentVersion'));
  assign('consentAppendix', str('consentAppendix'));
  assign('founderMarketingConsent', bool('founderMarketingConsent'));
  assign('newsletterConsent', bool('newsletterConsent'));
  assign('duplicateCaseStatus', str('duplicateCaseStatus') as LedgerFilters['duplicateCaseStatus']);
  assign('minSubtotalCents', cents('minSubtotalCents'));
  assign('maxSubtotalCents', cents('maxSubtotalCents'));
  assign('taxUsableAtClose', bool('taxUsableAtClose'));
  assign('taxExpiredBefore', date('taxExpiredBefore'));
  assign('taxabilityReason', str('taxabilityReason'));
  assign('attributionStatus', str('attributionStatus'));
  assign('linkActivated', bool('linkActivated'));
  assign('capResult', str('capResult') as LedgerFilters['capResult']);

  const limit = str('limit');
  if (limit && /^\d+$/.test(limit)) filters.limit = Number(limit);
  const offset = str('offset');
  if (offset && /^\d+$/.test(offset)) filters.offset = Number(offset);

  return filters;
}

export function createAdminOperationsRouter({
  db,
  auth,
  mode,
}: AdminOperationsRouterDeps): Router {
  const router = Router();
  const admin = requireAdmin(auth);
  const fresh = requireFreshSession(auth, () => readAdminReauthWindowSeconds(db));
  const json: RequestHandler = express.json({ limit: '64kb' });

  /* ── §26.5 reservation and charge ledger ───────────────────────────────── */

  router.get(`${ADMIN_OPS_BASE_PATH}/ledger`, admin, async (req, res) => {
    const page = await listLedger(db, filtersFrom(req.query));
    res.json({
      // The dimensions travel with the data so the surface renders the §26.5
      // filter set from the register rather than from a hand-kept copy.
      dimensions: LEDGER_DIMENSION_KEYS,
      ...page,
    });
  });

  /**
   * §25.7's permitted export.
   *
   * The withheld columns are named in the response rather than silently
   * dropped: an Admin who cannot find a Backer's email in the file should be
   * told it was withheld and why, not left to conclude the data is missing.
   */
  router.get(`${ADMIN_OPS_BASE_PATH}/ledger/export`, admin, async (req, res) => {
    const result = await exportLedger(db, filtersFrom(req.query));

    if (req.query['format'] === 'csv') {
      res.setHeader('content-type', 'text/csv; charset=utf-8');
      res.setHeader('content-disposition', 'attachment; filename="proovd-ledger.csv"');
      res.send(result.csv);
      return;
    }

    res.json({
      columns: result.columns,
      rows: result.rows,
      withheldColumns: result.withheldColumns,
      withheldReason:
        '§25.7 limits what Admin may hand out, not only what Admin may see. These columns are visible in the ledger and are never written into an export.',
    });
  });

  router.get(`${ADMIN_OPS_BASE_PATH}/ledger/:campaignId/counts`, admin, async (req, res) => {
    const counts = await countBackersAndTransactions(db, req.params['campaignId'] as string);
    res.json({
      ...counts,
      note: 'On a Product Campaign one person may hold several transactions (§4.1), so these are two different numbers.',
    });
  });

  /* ── §26.6 money controls ──────────────────────────────────────────────── */

  router.get(`${ADMIN_OPS_BASE_PATH}/money/:campaignId`, admin, async (req, res) => {
    const panel = await readMoneyControls(db, req.params['campaignId'] as string);
    if (!panel) {
      res.status(404).json({ error: 'not_found', title: 'No such campaign' });
      return;
    }
    res.json(panel);
  });

  /* ── §31.9 first-cohort measurement (Phase 23b) ────────────────────────── */

  /**
   * A read, so `admin` only — the same reasoning the ledger and the risk panel
   * record. There is deliberately no write route here at all: §33.12.6 forbids
   * an invented baseline, and the surest way to have none is to leave nowhere
   * to record one. Every number is computed on the request from records other
   * phases already keep.
   */
  router.get(`${ADMIN_OPS_BASE_PATH}/measurement`, admin, async (_req, res) => {
    res.json(await readScoreboard(db));
  });

  /* ── §31.7 risk-control inventory ──────────────────────────────────────── */

  router.get(`${ADMIN_OPS_BASE_PATH}/risk`, admin, async (req, res) => {
    const campaignId = typeof req.query['campaignId'] === 'string' ? req.query['campaignId'] : undefined;
    const panel = await readRiskPanel(db, { ...(campaignId ? { campaignId } : {}), mode });
    res.json({ signalKeys: RISK_SIGNAL_KEYS, ...panel });
  });

  router.get(
    `${ADMIN_OPS_BASE_PATH}/risk/:campaignId/seller-tax-readiness`,
    admin,
    async (req, res) => {
      const state = await readSellerTaxReadiness(db, req.params['campaignId'] as string, mode);
      res.json(state);
    },
  );

  router.post(
    `${ADMIN_OPS_BASE_PATH}/risk/:campaignId/seller-tax-readiness`,
    admin,
    fresh,
    json,
    async (req, res) => {
      const body = req.body as Record<string, unknown>;
      const str = (k: string) => (typeof body[k] === 'string' ? (body[k] as string) : undefined);

      const result = await recordSellerTaxReadiness(db, {
        campaignId: req.params['campaignId'] as string,
        mode,
        headOfficeLocationDetail: str('headOfficeLocationDetail'),
        productTaxCodeDetail: str('productTaxCodeDetail'),
        registrationDetail: str('registrationDetail'),
        providerTaxSettingsDetail: str('providerTaxSettingsDetail'),
        recordedBy: str('recordedBy') ?? actorOf(req),
        evidenceReference: str('evidenceReference') ?? '',
      });

      if (!result.ok) {
        res.status(422).json({
          error: 'readiness_rejected',
          title: 'That could not be recorded',
          whatHappened: result.message,
          next: 'Add what is missing and record it again. Nothing has changed.',
        });
        return;
      }

      res.status(201).json(result);
    },
  );

  /* ── §26.6 / §33.12.4 high-impact actions and overrides ────────────────── */

  router.get(`${ADMIN_OPS_BASE_PATH}/overrides/fields`, admin, (_req, res) => {
    res.json({
      overridable: OVERRIDABLE_FIELDS,
      // §26.2's other half, stated rather than implied: these have no write path
      // anywhere, and saying so is what makes the absence legible (§33.12.4).
      autoPopulated: AUTO_POPULATED_FIELDS,
      autoPopulatedNote:
        'User and provider data auto-populates. Admin adds only review, decision, evidence, and override data (§26.2). There is no route that writes an auto-populated field.',
    });
  });

  router.get(
    `${ADMIN_OPS_BASE_PATH}/overrides/:targetType/:targetId`,
    admin,
    async (req, res) => {
      const rows = await listOverrides(
        db,
        req.params['targetType'] as string,
        req.params['targetId'] as string,
      );
      res.json({ overrides: rows });
    },
  );

  /** §26.6 step 1: compute the consequences before anything moves. */
  router.post(`${ADMIN_OPS_BASE_PATH}/overrides/preview`, admin, fresh, json, async (req, res) => {
    const body = req.body as { fieldKey?: unknown; targetId?: unknown; newValue?: unknown };

    if (typeof body?.fieldKey !== 'string' || typeof body?.targetId !== 'string') {
      res.status(400).json({
        error: 'invalid_request',
        title: 'That preview could not be produced',
        whatHappened: 'A field and a target are both required.',
        next: 'Choose what you are changing, then preview it again.',
      });
      return;
    }

    const result = await previewHighImpactAction(db, {
      fieldKey: body.fieldKey,
      targetId: body.targetId,
      newValue: body.newValue,
      issuedBy: actorOf(req),
    });

    if (!result.ok) {
      res.status(result.code === 'not_found' ? 404 : 422).json({
        error: result.code,
        title: 'That preview could not be produced',
        whatHappened: result.message,
        next: 'Nothing has changed.',
      });
      return;
    }

    res.status(201).json(result.preview);
  });

  /** §26.6 step 2: execute, citing the preview that was read. */
  router.post(`${ADMIN_OPS_BASE_PATH}/overrides`, admin, fresh, json, async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const str = (k: string) => (typeof body[k] === 'string' ? (body[k] as string) : '');

    if (!str('fieldKey') || !str('targetId')) {
      res.status(400).json({
        error: 'invalid_request',
        title: 'That override could not be recorded',
        whatHappened: 'A field and a target are both required.',
        next: 'Nothing has changed.',
      });
      return;
    }

    const result = await recordOverride(db, {
      fieldKey: str('fieldKey'),
      targetId: str('targetId'),
      newValue: body['newValue'],
      internalReason: str('internalReason'),
      customerExplanation: str('customerExplanation'),
      previewId: str('previewId'),
      actor: actorOf(req),
      ...securityContext(req),
      evidenceLinks:
        body['evidenceLinks'] && typeof body['evidenceLinks'] === 'object'
          ? (body['evidenceLinks'] as Record<string, unknown>)
          : undefined,
    });

    if (!result.ok) {
      res.status(result.code === 'not_found' ? 404 : 422).json({
        error: result.code,
        title: 'That override could not be recorded',
        whatHappened: result.message,
        next: 'Nothing has changed.',
      });
      return;
    }

    res.status(201).json(result);
  });

  return router;
}
