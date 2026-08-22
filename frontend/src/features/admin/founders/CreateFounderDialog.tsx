/**
 * Create Founder — Spec §7's first act.
 *
 * The reference's own dialog, field for field and string for string: name,
 * email, business, phone, location (the fifty states plus Washington, DC),
 * expected campaign path, owner.
 *
 * ── The client check is a courtesy, never the gate ──────────────────────────
 * `POST /api/admin/founders` requires `legalName` and `email` and refuses
 * either blank by name. This form additionally requires a business, because the
 * reference does — and that requirement has no server behind it, so it is
 * enforced here in the open and named as such in the report, rather than
 * pretended to be a rule the record keeps. §1.1's rule holds either way: the
 * frontend decides what to render, the server decides what is allowed.
 *
 * ── Two fields the create route does not carry ──────────────────────────────
 * §7 splits into two acts and this route is the first: writing down a person
 * somebody met off-platform. Business and location belong to the profile, so
 * they are written straight after through the §25.6 field route, which records
 * actor, prior value, new value and time for each. The campaign path belongs to
 * the DRAFT, not the person, and §9 keeps it changeable until vetting is
 * submitted — a third subject, and a third route.
 *
 * ── The owner is free text, and the reference's roster is not reproduced ────
 * `founder_prospects.internal_owner` is free text (the 2026-08-16 decision) and
 * no roster endpoint exists. The reference offers `Sarah` and `Omar`, which are
 * its fixture's two names; shipping them would put two people who do not exist
 * into a real record. The control keeps its name, its grid position and its
 * label, and says what it actually is.
 */

import { useState, type FormEvent } from 'react';
import { AdminRequestError } from './api.js';
import { US_LOCATIONS } from './us-locations.js';
import { Overlay } from './dialogs/Overlay.js';

/** The reference's own `wg` check, verbatim. */
const EMAIL = /^\S+@\S+\.\S+$/;

export interface CreateFounderValues {
  name: string;
  email: string;
  company: string;
  phone: string;
  location: string;
  campaign: string;
  owner: string;
}

interface Props {
  onSubmit: (values: CreateFounderValues) => Promise<void>;
  onClose: () => void;
  /** The reference's `$("Name, business and a valid email are required")`. */
  onRefuse: (message: string) => void;
}

export function CreateFounderDialog({ onSubmit, onClose, onRefuse }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AdminRequestError | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    const form = new FormData(event.currentTarget);
    const read = (key: string) => String(form.get(key) ?? '').trim();

    const values: CreateFounderValues = {
      name: read('name'),
      email: read('email'),
      company: read('company'),
      phone: read('phone'),
      location: read('location'),
      campaign: read('campaign'),
      owner: read('owner'),
    };

    if (!values.name || !values.company || !EMAIL.test(values.email)) {
      onRefuse('Name, business and a valid email are required');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await onSubmit(values);
    } catch (caught: unknown) {
      // The server already answers §27.1's six questions; rendering its own
      // words rather than a paraphrase is the rule this panel follows.
      if (caught instanceof AdminRequestError) setError(caught);
      else throw caught;
      setBusy(false);
    }
  }

  return (
    <Overlay label="Create Founder" onClose={onClose}>
      <form className="create-founder-form" onSubmit={handleSubmit}>
        <p className="dialog-kicker">New Founder</p>
        <h2>Create Founder</h2>

        <div className="form-grid">
          <label>
            <span>Founder name</span>
            <input required placeholder="Maya Hassan" name="name" />
          </label>
          <label>
            <span>Email</span>
            <input required placeholder="maya@example.com" type="email" name="email" />
          </label>
          <label>
            <span>Business</span>
            <input required placeholder="Maya Labs" name="company" />
          </label>
          <label>
            <span>Phone</span>
            <input placeholder="+1 212 555 0148" name="phone" />
          </label>
          <label>
            <span>Location</span>
            <input
              list="us-state-options"
              autoComplete="off"
              placeholder="Start typing a city or state"
              name="location"
            />
            <datalist id="us-state-options">
              {US_LOCATIONS.map((location) => (
                <option key={location} value={location} />
              ))}
            </datalist>
          </label>
          <label>
            <span>Expected campaign path</span>
            <select name="campaign" defaultValue="Idea Campaign">
              <option>Idea Campaign</option>
              <option>Product Campaign</option>
            </select>
            <small>The Founder still confirms the final choice.</small>
          </label>
          <label>
            <span>Owner</span>
            <input name="owner" placeholder="Who owns this record" />
            <small>There is no owner roster; this is recorded as free text.</small>
          </label>
        </div>

        <p className="form-note">
          A separate campaign record opens in Invite. Nothing is prefilled beyond the exact allowed
          fields.
        </p>

        {error ? (
          <p className="form-note" role="alert">
            <strong>{error.detail.title}</strong>
            {error.detail.whatHappened ? ` ${error.detail.whatHappened}` : ''}
            {error.detail.next ? ` ${error.detail.next}` : ''}
          </p>
        ) : null}

        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" type="submit" disabled={busy}>
            Create Founder
          </button>
        </div>
      </form>
    </Overlay>
  );
}
