/**
 * State-machine core — Spec §23, tech-stack §4.2.
 *
 * A machine is an explicit legal-transition map plus guard functions. An
 * illegal transition THROWS; it never silently no-ops (phase-03 scope rule).
 * Every DB transition also writes an append-only history row — that side
 * lives in the backend; this module is the single source of truth for what
 * is legal.
 */

export class IllegalTransitionError extends Error {
  constructor(
    public readonly machine: string,
    public readonly from: string,
    public readonly to: string,
  ) {
    super(`illegal ${machine} transition: ${from} → ${to}`);
    this.name = 'IllegalTransitionError';
  }
}

export interface StateMachine<S extends string> {
  readonly name: string;
  readonly states: readonly S[];
  readonly transitions: Readonly<Record<S, readonly S[]>>;
  canTransition(from: S, to: S): boolean;
  /** Throws IllegalTransitionError unless `from → to` is in the map. */
  assertTransition(from: S, to: S): void;
  /** States with no outgoing edges. Mirrored by DB terminal-state triggers. */
  terminalStates(): readonly S[];
}

export function defineMachine<S extends string>(
  name: string,
  states: readonly S[],
  transitions: Readonly<Record<S, readonly S[]>>,
): StateMachine<S> {
  // Fail at module load, not at first use, if the map references an unknown
  // state — a typo here would otherwise become a silently-unreachable state.
  const known = new Set<string>(states);
  for (const [from, targets] of Object.entries<readonly S[]>(transitions)) {
    if (!known.has(from)) {
      throw new Error(`${name}: transition map source '${from}' is not a declared state`);
    }
    for (const to of targets) {
      if (!known.has(to)) {
        throw new Error(`${name}: transition target '${from} → ${to}' is not a declared state`);
      }
      if (to === from) {
        throw new Error(`${name}: self-transition '${from} → ${to}' is not a transition`);
      }
    }
  }
  for (const s of states) {
    if (!(s in transitions)) {
      throw new Error(`${name}: state '${s}' missing from transition map (use [] for terminal)`);
    }
  }

  return {
    name,
    states,
    transitions,
    canTransition(from, to) {
      return (transitions[from] ?? []).includes(to);
    },
    assertTransition(from, to) {
      if (!known.has(from) || !known.has(to)) {
        throw new IllegalTransitionError(name, String(from), String(to));
      }
      if (!this.canTransition(from, to)) {
        throw new IllegalTransitionError(name, from, to);
      }
    },
    terminalStates() {
      return states.filter((s) => transitions[s].length === 0);
    },
  };
}
