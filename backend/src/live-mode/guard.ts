/**
 * The gate as code — Spec §34 (Phase 24).
 *
 * The phase's last trap is one sentence: "The gate is code. A checklist
 * someone can proceed past is not a gate." This file is the difference. §34's
 * eleven conditions are recorded in `gate.ts`; here they stop money.
 *
 * ── Two layers, doing two different jobs ────────────────────────────────────
 *
 * **Layer one — the gateway decorator.** Every money-or-card operation in the
 * product goes through one `StripeGateway` object, constructed once at boot.
 * Wrapping it means a service written in a later phase inherits the refusal
 * without knowing this file exists, which is the only form of "checked at
 * every money-touching entry point" that survives a phase that forgets.
 *
 * **Layer two — the pilot scope.** Once the gate opens, §6 and §2.2 still
 * allow exactly one named pilot campaign. The gateway does not know which
 * campaign a call belongs to and must not guess: a campaign id read out of
 * provider metadata is a value somebody chose, which is the mistake 09b
 * documented for Cal.com bookings. So the campaign-scoped check lives at the
 * services that already hold the campaign, against a register the suite walks.
 *
 * ── Why the decorator refuses to construct on an unknown method ─────────────
 * The partition is built from `GATEWAY_DISPOSITION`, not from a list of method
 * names written here. If the gateway carries a callable member the register
 * does not mention, this throws at boot. A new money method added without
 * deciding its disposition therefore stops the application from starting,
 * rather than shipping an ungated path that looks exactly like a gated one.
 * That is 23b's `UNGATED_ADMIN_WRITES` arrangement, with a louder failure
 * because the subject is money rather than a route.
 *
 * ── Why nothing is cached ───────────────────────────────────────────────────
 * The gate is read on every blocked call. A cached gate is a rollback that
 * does not take effect, and §34 asks for a rollback owner precisely because
 * somebody may need it to take effect in seconds. One read on a path that is
 * already making a network call to Stripe is the cheapest thing here.
 */

import type { Database } from '../db/client.js';
import type { StripeGateway } from '../payments/stripe-client.js';
import { readLiveModeGate, type LiveModeEnvironment } from './gate.js';
import { readLivePilot } from './pilot.js';
import {
  GATEWAY_DISPOSITION,
  LIVE_MODE_BLOCKED_MESSAGE,
  NOT_THE_PILOT_MESSAGE,
} from './logic.js';

/**
 * Thrown when a live money operation is attempted through a closed gate.
 *
 * An error rather than a returned refusal, deliberately, and it is the one
 * place in this codebase that reaches for one. Every caller of the gateway
 * treats a thrown error as "the provider call did not happen" and retries
 * under the same idempotency key — which is exactly the truth here. Returning
 * a normalized failure result instead would look to `close-batch.ts` like a
 * decline, and a decline enters the retry window, tells a Backer their card
 * failed, and starts a 48-hour clock over a charge nobody ever attempted.
 */
export class LiveModeBlockedError extends Error {
  readonly code = 'live_mode_blocked';
  constructor(
    message: string,
    readonly operation: string,
    readonly blockingConditions: readonly string[],
  ) {
    super(message);
    this.name = 'LiveModeBlockedError';
  }
}

export interface LiveGuardDeps {
  db: Database;
  environment: LiveModeEnvironment;
}

/**
 * Wraps the gateway so no live money moves through a closed §34 gate.
 *
 * In **test mode the gateway is returned unchanged**, and that is not a
 * loophole — it is §34's own first list. "Test-mode engineering" is explicitly
 * permitted while the gate is closed, and it has to be: every one of the
 * conditions is verified by a product that runs. A decorator that blocked test
 * mode would block the work that opens the gate.
 */
/**
 * The environment facts, set once at boot.
 *
 * Module state, deliberately, and the one place in this codebase that reaches
 * for it. These are process configuration in the same sense `env.ts` is — read
 * from the validated environment at startup, never mutated, and identical for
 * every request. The alternative was threading one more field through eleven
 * router deps objects to reach thirteen services, and a field that has to be
 * remembered at thirteen call sites is a field that will be missed at one.
 *
 * Unset is not "test". `checkLiveMoneyPermitted` refuses a live-mode call when
 * this is null, because a gate nobody configured is a gate nobody configured.
 */
let configuredEnvironment: LiveModeEnvironment | null = null;

export function configureLiveMode(environment: LiveModeEnvironment): void {
  configuredEnvironment = environment;
}

/** Test-only. The suite drives both a configured and an unconfigured process. */
export function resetLiveModeConfiguration(): void {
  configuredEnvironment = null;
}

export function guardLiveMoneyGateway(
  gateway: StripeGateway,
  deps: LiveGuardDeps,
): StripeGateway {
  assertPartitionCoversGateway(gateway);
  configureLiveMode(deps.environment);

  if (gateway.mode !== 'live') return gateway;

  const guarded = Object.create(gateway) as Record<string, unknown> & StripeGateway;

  for (const [method, disposition] of Object.entries(GATEWAY_DISPOSITION)) {
    if (disposition !== 'blocked_while_closed') continue;
    const original = (gateway as unknown as Record<string, unknown>)[method];
    if (typeof original !== 'function') continue;

    guarded[method] = async (...args: unknown[]) => {
      const gate = await readLiveModeGate(deps.db, deps.environment);
      if (!gate.open) {
        throw new LiveModeBlockedError(LIVE_MODE_BLOCKED_MESSAGE, method, gate.blockingKeys);
      }
      // The gate being open is not enough. §6 limits the first enablement to
      // one named pilot campaign, and no enablement at all means no campaign
      // is the pilot — so an open gate with nothing enabled still moves no
      // money. Which campaign this call belongs to is layer two's question.
      const pilot = await readLivePilot(deps.db);
      if (!pilot) {
        throw new LiveModeBlockedError(
          'The §34 conditions are satisfied but no pilot campaign has been enabled. §6 limits live money to one named pilot with monitoring and rollback owners.',
          method,
          [],
        );
      }
      return (original as (...a: unknown[]) => unknown).apply(gateway, args);
    };
  }

  /**
   * The raw SDK is not carried across.
   *
   * `client` is the one member that would let a caller reach Stripe around
   * every refusal above. Nothing in `backend/src` reads it — the suite asserts
   * that — so withholding it costs nothing and closes the only hole a
   * decorator over an object can have.
   */
  Object.defineProperty(guarded, 'client', { value: null, enumerable: true });

  return guarded;
}

/**
 * Every callable member of the gateway has a recorded disposition.
 *
 * Walks the object rather than the interface, because the interface is erased
 * at runtime and the object is what services actually call. Throws — at boot,
 * before the server listens — so the failure is a deployment that does not
 * start rather than a money path that is quietly ungated.
 */
export function assertPartitionCoversGateway(gateway: StripeGateway): void {
  // A test double declares its scaffolding by name. The real gateway declares
  // nothing, so in production this exempts nothing — and a control added to
  // the double without being declared fails the partition rather than slipping
  // through, which is the safe direction for an exemption list.
  const testControls = new Set(
    (gateway as unknown as { __testControls?: readonly string[] }).__testControls ?? [],
  );

  const callable: string[] = [];
  for (
    let proto: object | null = gateway;
    proto && proto !== Object.prototype;
    proto = Object.getPrototypeOf(proto) as object | null
  ) {
    for (const key of Object.getOwnPropertyNames(proto)) {
      if (key === 'constructor' || key === 'client') continue;
      const descriptor = Object.getOwnPropertyDescriptor(proto, key);
      // Read through the descriptor: touching a getter here would invoke it,
      // and one of them is the raw SDK.
      if (descriptor?.get) continue;
      if (typeof descriptor?.value === 'function' && !callable.includes(key)) {
        callable.push(key);
      }
    }
  }

  const undecided = callable.filter(
    (m) => !(m in GATEWAY_DISPOSITION) && !testControls.has(m),
  );
  if (undecided.length > 0) {
    throw new Error(
      `The Stripe gateway carries operations with no §34 disposition: ${undecided.join(', ')}. ` +
        'Every money-or-card operation is blocked or permitted while the live-mode gate is closed, ' +
        'against one of §34\'s two lists. Decide it in shared/src/live-mode and backend/src/live-mode/logic.ts ' +
        'before this ships — an undecided operation is an ungated money path that looks exactly like a gated one.',
    );
  }
}

/* ── Layer two: the pilot scope ────────────────────────────────────────────── */

export type LiveMoneyDecision =
  | { permitted: true }
  | {
      permitted: false;
      code: 'gate_closed' | 'no_pilot_enabled' | 'not_the_pilot';
      message: string;
    };

/**
 * May live money move for this campaign?
 *
 * Called by the campaign-scoped money entry points listed in
 * `MONEY_ENTRY_POINTS`. In test mode the answer is always yes — §34 permits
 * test-mode engineering, and every phase suite in this repository depends on
 * that being true.
 *
 * Refuses by name with three distinct answers, because they are three
 * different facts and collapsing them would tell an operator the gate was shut
 * when it was open. "The gate is closed", "the gate is open and nothing is
 * enabled", and "something is enabled and it is not you" lead to three
 * different next actions.
 */
/**
 * The mode this process is running in, for the money paths that have no
 * gateway to ask.
 *
 * §22.3's Founder payment is the case: under the approved direct-charge
 * configuration the captured funds already sit on the Founder's account, so
 * the release is Proovd's recorded decision and there is no provider call and
 * no `StripeGateway` in its deps. It is still money — §34's blocked list ends
 * with "any payout promise" — so it is still gated, and the mode comes from
 * the boot configuration instead.
 *
 * Unconfigured reads as `test`. Every production boot calls
 * `guardLiveMoneyGateway`, which configures this before the server listens; a
 * process where it never ran is a test harness, and the ones in this
 * repository construct services directly with a memory gateway. The safety
 * here is not this default — it is that a live process without the decorator
 * has no gate at all, which is a deployment that cannot happen rather than a
 * default to tune.
 */
export function configuredStripeMode(): 'test' | 'live' {
  return configuredEnvironment?.stripeMode ?? 'test';
}

export async function checkLiveMoneyPermitted(
  db: Database,
  mode: 'test' | 'live',
  campaignId: string,
): Promise<LiveMoneyDecision> {
  if (mode !== 'live') return { permitted: true };

  const environment = configuredEnvironment;
  if (!environment) {
    return {
      permitted: false,
      code: 'gate_closed',
      message:
        'Live mode is running but the §34 gate was never configured for this process, so its conditions cannot be read. Nothing moves until it can.',
    };
  }

  const gate = await readLiveModeGate(db, environment);
  if (!gate.open) {
    return { permitted: false, code: 'gate_closed', message: LIVE_MODE_BLOCKED_MESSAGE };
  }

  const pilot = await readLivePilot(db);
  if (!pilot) {
    return {
      permitted: false,
      code: 'no_pilot_enabled',
      message:
        'The §34 conditions are satisfied but no pilot campaign has been enabled. §6 limits live money to one named pilot with monitoring and rollback owners.',
    };
  }

  if (pilot.campaignId !== campaignId) {
    return { permitted: false, code: 'not_the_pilot', message: NOT_THE_PILOT_MESSAGE };
  }

  return { permitted: true };
}
