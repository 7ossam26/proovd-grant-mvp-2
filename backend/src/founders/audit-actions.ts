/**
 * The §25.6 action names the Founder workspace writes, and the shape of what it
 * writes under them.
 *
 * They live in their own module because two files need them and neither may
 * import the other: `mutations.ts` writes the rows, `history.ts` reads them
 * back, and `workspace.ts` composes both. A string literal repeated in two
 * files is a feed that silently loses a category the day one of them is
 * renamed.
 *
 * ── Why the payload is a declared shape ─────────────────────────────────────
 * §25.6 wants prior and new value preserved, and §33.12.4 wants the before read
 * from the record rather than supplied by the caller. `audit_events.prior_value`
 * and `new_value` are `jsonb`, so "preserved" is only true if something can
 * read them back into the same shape — otherwise the history surface has to
 * guess, and a guess renders an internal column name to an Admin (§3.1).
 */

/** An Admin changed one registered field on a Founder's record. */
export const FOUNDER_FIELD_UPDATED = 'founder.field_updated' as const;

/** An Admin set or cleared a per-invitation override of a profile value (§7). */
export const FOUNDER_OVERRIDE_SET = 'founder.invitation_override_set' as const;
export const FOUNDER_OVERRIDE_CLEARED = 'founder.invitation_override_cleared' as const;

/** §7's named Proovd sender and reply route, recorded from the session. */
export const FOUNDER_SENDER_RECORDED = 'founder.invitation_sender_recorded' as const;

/** §26.7 person-level access, and §25.8's account-closure request and review. */
export const FOUNDER_ACCESS_RECORDED = 'founder.access_action_recorded' as const;
export const FOUNDER_DELETION_REQUESTED = 'founder.deletion_requested' as const;
export const FOUNDER_DELETION_REVIEWED = 'founder.deletion_reviewed' as const;

/** §7's discovery record grew an entry: a meeting note (0047) or research. */
export const FOUNDER_MEETING_NOTE_RECORDED = 'founder.meeting_note_recorded' as const;
export const FOUNDER_RESEARCH_RECORDED = 'founder.research_recorded' as const;

/**
 * What a field edit stores on both sides of the audit row.
 *
 * `label` rather than the column name: the audit row is read back onto a
 * surface an Admin quotes on a support call, and `business_entity_type` is
 * exactly the internal vocabulary §3.1 keeps off one.
 */
export interface FieldEditAuditValue {
  key: string;
  label: string;
  value: string | null;
}

export function isFieldEditAuditValue(value: unknown): value is FieldEditAuditValue {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate['key'] === 'string' && typeof candidate['label'] === 'string';
}
