/**
 * One value an invitation may say differently from the Founder profile.
 *
 * ── Why this edits in place instead of opening a dialog ─────────────────────
 * The five override fields are read as a set — the Admin is checking that the
 * message is addressed to the right person, about the right product, at the
 * right address. Sending each correction through a modal would hide the other
 * four behind it at the moment they are being compared. So the row becomes its
 * own form and everything around it stays on screen.
 *
 * ── Typing the profile value back is a reset, not an override ───────────────
 * An override that happens to equal the profile is a difference the record now
 * has to carry forever, and the helper beneath it would say a value "still
 * says" what it already says. So a save that matches the profile clears the
 * override instead — the same answer, with nothing stored to explain later.
 *
 * The profile itself is never touched from here. That is the whole point of the
 * two columns (§26.2), and the helper sentence says so in the Founder's own
 * name so an Admin cannot mistake which record they just changed.
 */

import { useCallback, useEffect, useState } from 'react';
import { OVERRIDE_EDIT_HELPER } from '@proovd/shared';
import { Button, Input, useToast } from '../../../../components/index.js';
import { AdminRequestError, type OverrideField } from '../../api.js';

interface OverrideEditProps {
  field: OverrideField;
  preferredName: string;
  /** Store a value for this invitation only. */
  onSave: (value: string) => Promise<void>;
  /** Go back to whatever the Founder profile says. */
  onClear: () => Promise<void>;
}

export function OverrideEdit({
  field,
  preferredName,
  onSave,
  onClear,
}: OverrideEditProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(field.value);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const toast = useToast();

  const inputId = `ov-input-${field.key}`;

  // The `Input` primitive takes no ref, so the control is reached by the id it
  // was given — the same way the decision dialog focuses a blank required field.
  const focusInput = useCallback(() => {
    document.getElementById(inputId)?.focus();
  }, [inputId]);

  useEffect(() => {
    if (editing) focusInput();
  }, [editing, focusInput]);

  function refuse(error: unknown) {
    setFailure(
      error instanceof AdminRequestError
        ? [error.detail.title, error.detail.whatHappened].filter(Boolean).join(' ')
        : 'Nothing was changed, and it is not certain why. Reload this page to see the stored value.',
    );
  }

  async function save() {
    const value = draft.trim();
    if (!value) {
      toast('Enter a value or cancel');
      focusInput();
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      if (value === field.profileValue) {
        await onClear();
        toast('Back to the Founder profile value');
      } else {
        await onSave(value);
        toast('Saved for this invitation only', {
          sub: `${preferredName}’s Founder profile is unchanged.`,
        });
      }
      setEditing(false);
    } catch (error) {
      refuse(error);
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    setBusy(true);
    setFailure(null);
    try {
      await onClear();
      toast('Back to the Founder profile value');
    } catch (error) {
      refuse(error);
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <div className="frow ovfield">
        <dt>
          <label className="field-label" htmlFor={inputId}>
            {field.label}
          </label>
        </dt>
        <dd>
          <Input
            id={inputId}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <p className="helper">{OVERRIDE_EDIT_HELPER(preferredName)}</p>
          {failure ? (
            <p className="field-error" role="alert">
              {failure}
            </p>
          ) : null}
          <div className="case-actions">
            <Button tier="secondary" small disabled={busy} onClick={() => void save()}>
              Save for this invitation
            </Button>
            <Button
              tier="tertiary"
              small
              disabled={busy}
              onClick={() => {
                setDraft(field.value);
                setFailure(null);
                setEditing(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </dd>
      </div>
    );
  }

  return (
    <div className="frow ovfield">
      <dt>{field.label}</dt>
      <dd>
        <span className="ovval">{field.value}</span>
        <p className="helper">{field.helper}</p>
        {failure ? (
          <p className="field-error" role="alert">
            {failure}
          </p>
        ) : null}
        {field.overridden ? (
          <Button tier="secondary" small disabled={busy} onClick={() => void reset()}>
            Use Founder profile value
          </Button>
        ) : (
          <Button
            tier="secondary"
            small
            disabled={busy}
            onClick={() => {
              setDraft(field.value);
              setEditing(true);
            }}
          >
            Change for this invitation
          </Button>
        )}
      </dd>
    </div>
  );
}
