/**
 * Reading and validating a stored setting value.
 *
 * The mirror of `parseSettingValue` in `shared/src/settings/registry.ts`, and
 * deliberately a second implementation rather than a shared one. Two reasons,
 * and the first is structural:
 *
 *  1. The backend cannot import `@proovd/shared` at runtime — it exports
 *     TypeScript source, the backend compiles under `rootDir: src`, and the
 *     production image ships only `backend/dist`. `db/schema/domain.ts`
 *     documents the same constraint for the state enums.
 *  2. §1.1 requires server-side authorization on every surface. A client that
 *     validated and a server that trusted it would be one bypassed fetch away
 *     from a listing fee of "-1". The shared parser gives the Admin surface
 *     immediate feedback; this one decides.
 *
 * Neither reads a register. Everything this needs — kind, bounds, the §6
 * citation for the refusal message — comes off the row being validated, and
 * `src/tests/admin-settings.test.ts` fails the suite if those columns ever
 * drift from the register they were seeded from.
 */

export type SettingKind =
  | 'money_cents'
  | 'percent'
  | 'count'
  | 'calendar_days'
  | 'business_days'
  | 'hours'
  | 'seconds'
  | 'months'
  | 'boolean'
  | 'text_list'
  | 'text';

export type SettingProvenance = 'specified' | 'operator' | 'derived';

export type SettingValue = bigint | number | boolean | string | readonly string[];

/** The columns validation reads. A row, not a register entry. */
export interface SettingConstraints {
  kind: SettingKind;
  minimum: number | null;
  maximum: number | null;
  specRef: string;
}

export type ParseResult =
  | { ok: true; value: SettingValue }
  /** Admin-facing. This is not the token surface — say what is wrong. */
  | { ok: false; message: string };

const INTEGER_KINDS: readonly SettingKind[] = [
  'percent',
  'count',
  'calendar_days',
  'business_days',
  'hours',
  'seconds',
  'months',
];

/**
 * Strict on purpose. `parseInt('48 hours')` is 48, and a settings surface that
 * accepts that has agreed to store whatever was typed and hope the next reader
 * reads it the same way.
 */
export function parseValue(constraints: SettingConstraints, raw: string): ParseResult {
  const text = raw.trim();

  if (constraints.kind === 'text') {
    if (!text) return { ok: false, message: 'This setting cannot be empty.' };
    return { ok: true, value: text };
  }

  if (constraints.kind === 'text_list') {
    const entries = text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    if (entries.length === 0) {
      return { ok: false, message: 'Enter at least one entry, one per line.' };
    }
    return { ok: true, value: entries };
  }

  if (constraints.kind === 'boolean') {
    if (text === 'true') return { ok: true, value: true };
    if (text === 'false') return { ok: true, value: false };
    return { ok: false, message: 'Enter true or false.' };
  }

  if (!/^\d+$/.test(text)) {
    return {
      ok: false,
      message:
        constraints.kind === 'money_cents'
          ? 'Enter a whole number of cents — 3500 for $35.00. Money is never a decimal here.'
          : 'Enter a whole number with no units or separators.',
    };
  }

  if (constraints.kind === 'money_cents') {
    const value = BigInt(text);
    const failure = checkBounds(constraints, Number(value));
    if (failure) return failure;
    return { ok: true, value };
  }

  if (INTEGER_KINDS.includes(constraints.kind)) {
    const value = Number(text);
    if (!Number.isSafeInteger(value)) {
      return { ok: false, message: 'That number is too large.' };
    }
    const failure = checkBounds(constraints, value);
    if (failure) return failure;
    return { ok: true, value };
  }

  return { ok: false, message: 'Unrecognised setting type.' };
}

function checkBounds(
  constraints: SettingConstraints,
  value: number,
): { ok: false; message: string } | null {
  if (constraints.minimum !== null && value < constraints.minimum) {
    return {
      ok: false,
      message: `${constraints.specRef} sets a floor of ${constraints.minimum}. This may be raised, never lowered below it.`,
    };
  }
  if (constraints.maximum !== null && value > constraints.maximum) {
    return { ok: false, message: `This value cannot exceed ${constraints.maximum}.` };
  }
  return null;
}

/**
 * The stored form of a parsed value. `'  3500 '` and `'3500'` are the same
 * value, and a history row that records a whitespace change as a
 * commercial-rule change is noise in the one log that has to stay readable.
 */
export function canonicalise(value: SettingValue): string {
  if (Array.isArray(value)) return value.join('\n');
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value).trim();
}
