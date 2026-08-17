/**
 * Edit Founder — the record's one bulk-edit surface. Built Session B
 * (2026-08-17) to the reference's dark right-hand "EDIT AND VERSION" sheet.
 *
 * ── What it carries, and what it refuses ────────────────────────────────────
 * Exactly `FOUNDER_EDITABLE_FIELDS`' profile group — the editable core. The
 * reference's sheet also asks for PROBLEM, SOLUTION, and FOUNDER STORY
 * textareas (the three standing refusals: §9's answers have no editable key,
 * and the Story's completing act is the Founder's own approval), a FOUNDER /
 * ACCOUNT STATUS picker (the account state is derived from three records and
 * stored in none — a picker would mint a stored status), a POTENTIAL AUDIENCE
 * box (the Founder's own closed-list answer, 0042), and a socials repeater
 * (§12's social profiles are the Founder's workspace content). None of those
 * renders here, and the suite asserts the absences.
 *
 * ── One reason, applied to every change ─────────────────────────────────────
 * The reference ends the sheet in a required REASON / CONTEXT box, which is
 * §25.6's rule exactly where the server already enforces it: once the account
 * is claimed, a profile edit requires a stated reason (`editReasonRequired`).
 * The sheet mirrors that rule as a courtesy and the server re-decides — an
 * unclaimed record's prep data saves without one, and the copy says which
 * case the Admin is in.
 *
 * ── Only what changed is written ────────────────────────────────────────────
 * Each changed field goes through the existing `PUT /fields/:key` — the same
 * route the per-row dialogs use, with the same audit shape. A field left
 * untouched sends nothing (§9's autosave rule). A refusal mid-way is reported
 * with what had already saved, because pretending an atomic batch exists
 * would claim an outcome the server does not offer.
 */

import { useLayoutEffect, useRef, useState } from 'react';
import { Dialog } from 'radix-ui';
import {
  FOUNDER_EDITABLE_FIELDS,
  editReasonRequired,
  type FounderEditableFieldKey,
} from '@proovd/shared';
import { Button, Field, Input, Textarea, useToast } from '../../../../components/index.js';
import { animateDrawerClose, animateDrawerOpen } from '../../../../components/anim.js';
import { useProovdMotion } from '../../../../motion/MotionProvider.js';
import {
  AdminRequestError,
  updateFounderField,
  type FounderWorkspaceDetail,
} from '../../api.js';

const PROFILE_FIELDS = FOUNDER_EDITABLE_FIELDS.filter((field) => field.group === 'profile');

interface EditFounderSheetProps {
  detail: FounderWorkspaceDetail;
  trigger: HTMLElement | null;
  /** Called after at least one field saved; the workspace re-reads itself. */
  onSaved: () => Promise<void>;
  onClose: () => void;
}

export function EditFounderSheet({ detail, trigger, onSaved, onClose }: EditFounderSheetProps) {
  const toast = useToast();
  const [open, setOpen] = useState(true);
  const sheetRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const closing = useRef(false);
  const restoreTo = useRef<HTMLElement | null>(
    trigger ?? (document.activeElement as HTMLElement | null),
  );

  useProovdMotion(sheetRef, []);

  useLayoutEffect(() => {
    if (sheetRef.current) animateDrawerOpen(sheetRef.current, overlayRef.current, []);
    // Mounted once per opening, so the entrance plays once by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* The current stored values, from the details pane the server composed. */
  const stored = new Map<string, string>();
  for (const field of [
    ...detail.details.personal,
    ...detail.details.business,
    ...detail.details.preferences,
  ]) {
    stored.set(field.key, field.value ?? '');
  }

  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(PROFILE_FIELDS.map((field) => [field.key, stored.get(field.key) ?? ''])),
  );
  const [reason, setReason] = useState('');
  const [evidence, setEvidence] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const claimed = detail.overview.accountCreatedAt !== null;
  const reasonRequired = editReasonRequired('profile', claimed);
  const who = detail.header.preferredName;

  const changed = PROFILE_FIELDS.filter(
    (field) => (values[field.key] ?? '') !== (stored.get(field.key) ?? ''),
  );

  const requestClose = () => {
    if (closing.current) return;
    if (!sheetRef.current) {
      setOpen(false);
      onClose();
      return;
    }
    closing.current = true;
    animateDrawerClose(sheetRef.current, overlayRef.current, () => {
      closing.current = false;
      setOpen(false);
      onClose();
    });
  };

  async function save() {
    setFailure(null);
    if (changed.length === 0) {
      setFailure('Nothing has changed — every field still holds its stored value.');
      return;
    }
    if (reasonRequired && !reason.trim()) {
      setFailure(
        `${who} owns this account, so changing their record needs a stated reason (§25.6). Nothing was saved.`,
      );
      return;
    }

    setBusy(true);
    const saved: string[] = [];
    for (const field of changed) {
      try {
        await updateFounderField(detail.header.prospectId, field.key as FounderEditableFieldKey, {
          value: (values[field.key] ?? '').trim(),
          ...(reason.trim() ? { reason: reason.trim() } : {}),
          ...(evidence.trim() ? { evidence: evidence.trim() } : {}),
        });
        saved.push(field.label);
      } catch (error) {
        // What saved, saved — each field is its own recorded change, and
        // claiming the batch rolled back would claim an outcome the server
        // does not offer. The failure names both halves.
        const refusal =
          error instanceof AdminRequestError
            ? [error.detail.title, error.detail.whatHappened].filter(Boolean).join(' ')
            : 'The save failed without an explanation.';
        setFailure(
          saved.length > 0
            ? `Saved: ${saved.join(', ')}. Then ${field.label} was refused — ${refusal}`
            : `${field.label} was refused — ${refusal}`,
        );
        setBusy(false);
        if (saved.length > 0) await onSaved();
        return;
      }
    }

    await onSaved();
    toast('Saved', { sub: `${saved.length} field${saved.length === 1 ? '' : 's'} updated.` });
    requestClose();
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) requestClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay asChild>
          <div ref={overlayRef} className="scrim" />
        </Dialog.Overlay>
        <Dialog.Content
          asChild
          onCloseAutoFocus={(event) => {
            const target = restoreTo.current;
            if (!target || !target.isConnected) return;
            event.preventDefault();
            target.focus();
          }}
        >
          <div ref={sheetRef} className="fsheet" aria-label="Edit Founder">
            <div className="fsheet__head">
              <div>
                <span className="kicker">Edit and version</span>
                <Dialog.Title asChild>
                  <h2 className="h2">Edit Founder</h2>
                </Dialog.Title>
                <Dialog.Description asChild>
                  <p className="grey">
                    {claimed
                      ? `Every surface that auto-fills from the profile updates. Sent, accepted, approved, and paid records keep the wording they used.`
                      : `${who} hasn’t claimed an account yet — prep data can be corrected freely.`}
                  </p>
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <Button tier="tertiary" small aria-label="Close">
                  ×
                </Button>
              </Dialog.Close>
            </div>

            <div className="fsheet__body">
              {PROFILE_FIELDS.map((field) => (
                <Field
                  key={field.key}
                  id={`efs-${field.key}`}
                  label={field.label}
                  hint={'helper' in field ? field.helper : undefined}
                >
                  <Input
                    value={values[field.key] ?? ''}
                    onChange={(event) =>
                      setValues((prev) => ({ ...prev, [field.key]: event.target.value }))
                    }
                  />
                </Field>
              ))}

              <p className="helper">
                The §9 setup answers, the Story, the audience range, the social profiles, and
                the account status are not on this sheet: each is the Founder’s own or derived
                from the record, and none has an Admin edit path.
              </p>

              <Field
                id="efs-reason"
                label="Reason / context"
                hint={
                  reasonRequired
                    ? 'Required — this is somebody else’s record now (§25.6).'
                    : 'Optional before the claim — this is Proovd’s own prep.'
                }
              >
                <Textarea
                  rows={3}
                  placeholder="What changed, why, and what should happen next?"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              </Field>
              <Field id="efs-evidence" label="Evidence" hint="A ticket, a call, a message — when one exists.">
                <Input value={evidence} onChange={(event) => setEvidence(event.target.value)} />
              </Field>

              {failure ? (
                <p className="field-error" role="alert">
                  {failure}
                </p>
              ) : null}
            </div>

            <div className="fsheet__foot">
              <Dialog.Close asChild>
                <Button tier="tertiary">Back</Button>
              </Dialog.Close>
              <Button tier="primary" disabled={busy} onClick={() => void save()}>
                {busy ? 'Saving…' : 'Save new version'}
              </Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
