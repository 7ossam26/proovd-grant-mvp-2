/**
 * §7's first act: writing down somebody Proovd met off-platform.
 *
 * ── Why this asks for less than the reference does ──────────────────────────
 * The reference collects fifteen fields in one form. §7 describes two separate
 * things — creating a prospect after a discovery call, and *then* composing the
 * invitation — and this repo split them for a reason worth not re-litigating:
 * requiring the whole list at intake did not make the record more complete, it
 * made an Admin type something into `invitationSource` to get past a form, and
 * an invented value is a worse record than an honestly missing one. So this
 * asks for what a discovery call actually produces, and everything else —
 * business type, legal entity, state, and the invitation's own content — is
 * filled in on the workspace beside the message it feeds.
 *
 * Nothing here is a promise. §7 forbids Proovd promising acceptance, results,
 * reward pricing, or a named Creator's participation, so the body says so and
 * there is no field that could imply otherwise.
 *
 * ── Two calls, and a partial record is the safe half ────────────────────────
 * `createProspect` writes the person; `updateProspect` writes the rest against
 * the draft it returns. If the second fails the first still stands, and every
 * one of its fields is editable afterwards — the opposite ordering would lose
 * the person entirely over an optional phone number.
 */

import { useRef } from 'react';
import { createProspect, updateProspect, type UpdateProspectBody } from '../../api.js';
import { ConfirmDialog, type DialogSpec, type DialogValues } from './ConfirmDialog.js';

const FIELD = {
  legal: 'af-legal',
  preferred: 'af-preferred',
  email: 'af-email',
  phone: 'af-phone',
  product: 'af-product',
  website: 'af-website',
  source: 'af-source',
  lastContact: 'af-lastcontact',
  notes: 'af-notes',
} as const;

const SPEC: DialogSpec = {
  kicker: 'New founder prospect',
  title: 'Add founder',
  body: (
    <>
      <p>
        Fill in what you know — everything stays editable afterward. Nothing here
        promises acceptance, results, or any specific Creator.
      </p>
      <p className="helper">
        Business details and the invitation’s own wording are filled in on the Founder
        workspace, beside the message they feed.
      </p>
    </>
  ),
  fields: [
    { id: FIELD.legal, label: 'Legal name', required: true, placeholder: 'Full legal name' },
    {
      id: FIELD.preferred,
      label: 'Preferred name',
      placeholder: 'Defaults to their first name',
    },
    {
      id: FIELD.email,
      label: 'Email',
      required: true,
      inputType: 'email',
      placeholder: 'name@product.com',
    },
    { id: FIELD.phone, label: 'Phone', inputType: 'tel', placeholder: '+1 …' },
    { id: FIELD.product, label: 'Product / startup name', required: true },
    { id: FIELD.website, label: 'Website', placeholder: 'product.com' },
    {
      id: FIELD.source,
      label: 'How we found this Founder',
      placeholder: 'Proovd research · Referral · Founder outreach · Event',
    },
    {
      id: FIELD.lastContact,
      label: 'When we last spoke',
      inputType: 'date',
      hint: 'A record of a conversation. Nothing schedules a follow-up from it.',
    },
    {
      id: FIELD.notes,
      label: 'Internal notes',
      textarea: true,
      hint: 'What the discovery call produced. Never shown to the Founder.',
    },
  ],
  primary: 'Add founder',
};

interface AddFounderDialogProps {
  trigger: HTMLElement | null;
  onClose: () => void;
  /** Called after the panel has closed, with the new person's id. */
  onCreated: (prospectId: string) => void;
}

export function AddFounderDialog({ trigger, onClose, onCreated }: AddFounderDialogProps) {
  const created = useRef<string | null>(null);

  async function submit(values: DialogValues) {
    const result = await createProspect({
      legalName: values[FIELD.legal] ?? '',
      email: values[FIELD.email] ?? '',
      productName: values[FIELD.product] || undefined,
      lastContactAt: values[FIELD.lastContact] || undefined,
      adminNotes: values[FIELD.notes] || undefined,
    });

    // A key left out writes nothing (§9's autosave rule), so only what was
    // actually typed is sent — a blank box must not blank a stored value.
    const rest: UpdateProspectBody = {};
    if (values[FIELD.preferred]) rest.preferredName = values[FIELD.preferred];
    if (values[FIELD.phone]) rest.phone = values[FIELD.phone];
    if (values[FIELD.website]) rest.productUrl = values[FIELD.website];
    if (values[FIELD.source]) rest.invitationSource = values[FIELD.source];
    if (Object.keys(rest).length > 0) {
      await updateProspect(result.draftId, rest);
    }

    created.current = result.prospectId;
  }

  return (
    <ConfirmDialog
      spec={SPEC}
      trigger={trigger}
      onSubmit={submit}
      onClose={() => {
        const id = created.current;
        created.current = null;
        onClose();
        if (id) onCreated(id);
      }}
    />
  );
}
