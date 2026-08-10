/**
 * The stub server the §33.11 sweep renders every principal flow against —
 * Phase 23a.
 *
 * §33.11.1 asks that *full* flows pass, and a surface showing its error state
 * is not the flow. So each principal flow is given a populated response for
 * every read it performs, and anything unstubbed is recorded rather than
 * quietly answered: `unmatchedRequests()` is asserted empty by the sweep, which
 * is what stops a surface from silently falling back to an empty state and
 * passing axe because there was nothing on the page.
 *
 * The fixtures are typed against the api modules' own exported interfaces, so a
 * shape that drifts fails `npm run typecheck` rather than producing a surface
 * that renders half its content.
 */

import { vi } from 'vitest';

export interface StubRoute {
  /** Matched against the request URL, in order; first match wins. */
  match: RegExp;
  method?: string;
  status?: number;
  /**
   * The response, or a function returning it.
   *
   * A function exists for exactly one fixture: the session read. Every Founder
   * and Creator address is behind a role guard, so the answer to "who is signed
   * in?" has to match the flow being rendered — a Creator surface rendered
   * against a Founder session renders a refusal and would then pass axe with
   * nothing on the page, which is the §33.11.1 trap this harness exists to
   * avoid.
   */
  body: unknown | (() => unknown);
}

let routes: StubRoute[] = [];
let unmatched: string[] = [];

export function unmatchedRequests(): string[] {
  return [...unmatched];
}

/**
 * Which role the session fixture reports. Set from the address being rendered
 * rather than fixed per file, so adding a flow cannot silently render it
 * against the wrong role.
 */
export type QaSessionRole = 'founder' | 'affiliate' | 'admin';
let sessionRole: QaSessionRole = 'founder';

export function setQaSessionRoleForPath(path: string): void {
  sessionRole = path.startsWith('/admin')
    ? 'admin'
    : path.startsWith('/creator')
      ? 'affiliate'
      : 'founder';
}

export function qaSessionRole(): QaSessionRole {
  return sessionRole;
}

function respond(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

/**
 * Installs the stub. Every flow's routes are registered together rather than
 * per test, because a surface that quietly calls another flow's endpoint is
 * something the sweep should render, not something it should 404.
 */
export function installQaServer(stubs: StubRoute[]): void {
  routes = stubs;
  unmatched = [];
  vi.stubGlobal('fetch', async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    for (const route of routes) {
      if (!route.match.test(url)) continue;
      if (route.method && route.method.toUpperCase() !== method) continue;
      return respond(
        route.status ?? 200,
        typeof route.body === 'function' ? (route.body as () => unknown)() : route.body,
      );
    }
    unmatched.push(`${method} ${url}`);
    return respond(404, {
      error: 'not_stubbed',
      title: 'No fixture for this request',
      whatHappened: `The QA sweep has no fixture for ${method} ${url}.`,
      next: 'Add one to frontend/src/features/qa/fixtures.ts.',
    });
  });
}
