/**
 * The backend's runtime copy of Session G's settings registers (§5.2).
 *
 * The backend cannot import `@proovd/shared` at runtime — it exports TypeScript
 * source, this package compiles under `rootDir: src`, and the production image
 * ships only `backend/dist`. So what a route validates against is restated
 * here and drift-tested against shared, the arrangement the state enums, the §6
 * settings, and every register since have used.
 *
 * Only what a REFUSAL depends on is restated. The labels, the help text, the
 * absence register and the pinned sentences are not: those are imported through
 * Vite by the surface, and a second copy of a paragraph is how two versions of
 * one sentence begin to disagree.
 */

/** §5.2's eleven item ids, in the Spec's own order. */
export const FOUNDER_SETTINGS_ITEM_KEYS = [
  'name',
  'email',
  'phone',
  'profile_photo',
  'password',
  'business',
  'connected_account',
  'kyc',
  'notifications',
  'w9',
  'delete_account',
] as const;

/** The freely correctable fields, and the column each writes. */
export const FOUNDER_SETTINGS_COLUMNS: Readonly<Record<string, string>> = {
  preferred_name: 'preferred_name',
  phone: 'phone',
  business_name: 'business_name',
  business_entity_type: 'business_entity_type',
};

/**
 * The two §5.2 names that are not free edits. Same shape, same reason
 * required — the difference is a consequence stated before the change, which
 * is the surface's job rather than a refusal.
 */
export const FOUNDER_SETTINGS_GUARDED_COLUMNS: Readonly<Record<string, string>> = {
  legal_name: 'legal_name',
  email: 'email',
};

/** Every id a correction route may accept. Nothing else is a field. */
export const FOUNDER_CORRECTABLE_FIELD_IDS: readonly string[] = [
  ...Object.keys(FOUNDER_SETTINGS_COLUMNS),
  ...Object.keys(FOUNDER_SETTINGS_GUARDED_COLUMNS),
];

export function founderSettingsColumn(fieldId: string): string | null {
  return (
    FOUNDER_SETTINGS_COLUMNS[fieldId] ?? FOUNDER_SETTINGS_GUARDED_COLUMNS[fieldId] ?? null
  );
}

export function isGuardedSettingsField(fieldId: string): boolean {
  return fieldId in FOUNDER_SETTINGS_GUARDED_COLUMNS;
}

/**
 * What 0040's `received_via` records for a request the Founder filed themselves.
 *
 * Restated because the INSERT depends on it: that column is what distinguishes
 * a Founder-filed request from one an Admin transcribed off a call, which is
 * the whole reason it is NOT NULL.
 */
export const FOUNDER_DELETION_VIA = 'Founder settings screen';

/* ── §25.6 action names ───────────────────────────────────────────────────── */

/**
 * A Founder corrected their own record.
 *
 * Its own action rather than `founder.field_updated`, which is what an ADMIN
 * correcting somebody else's record writes. The actor string distinguishes them
 * too, but a history surface reading the action name is what decides the label
 * a support person quotes, and "Proovd corrected this" and "they corrected it
 * themselves" are two different facts about the same column.
 */
export const FOUNDER_SELF_CORRECTED = 'founder.self_corrected' as const;

/** A Founder changed their own password from the settings page (§5.2, §28.2). */
export const FOUNDER_PASSWORD_CHANGED = 'founder.password_changed' as const;
