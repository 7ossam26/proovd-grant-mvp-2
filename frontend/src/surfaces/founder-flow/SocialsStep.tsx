/**
 * Screen 14 — socials — Founder Flow v2, Session D.
 *
 * §12: "at least one valid, accessible, public Founder/product social profile
 * controlled by the Founder is supplied." Three separate facts, and the server
 * decides two of them: `checkSocialUrl` resolves the host before connecting,
 * refuses every private, loopback, link-local and unique-local address, and
 * re-applies the whole test to each redirect rather than handing the follow to
 * the runtime. It reads a status code and nothing else — no body is fetched,
 * stored, or returned.
 *
 * ── The third fact is a statement, and it is its own control ────────────────
 * Proovd cannot prove somebody controls a profile; there is no OAuth handshake
 * and inventing one would be §1 rule 6. So it is recorded as what it is — the
 * Founder's own confirmation — and §28.4 forbids bundling it into the Add, so
 * it is unchecked and separate.
 *
 * ── Four rows, because the reference draws four, and they are one record ────
 * Instagram, X, Discord and a website are four PLACEHOLDERS over one
 * `campaign_social_profiles` table; the platform is derived from the URL by the
 * server, not chosen here. A per-platform column would make "at least one
 * profile" a question about which four we happened to name.
 */

import { useState } from 'react';
import { useParams } from 'react-router';
import { Button, Field, Input, Option, Tag } from '../../components/index.js';
import {
  addSocial,
  confirmSocialControl,
  recheckSocial,
  removeSocial,
} from '../founder/api.js';
import { AnswerPage, rejectionText } from './AnswerPage.js';

/** What the reference's four rows ask for. The record is one table. */
const SLOTS = [
  { id: 'instagram', label: 'Instagram', placeholder: 'instagram.com/yourhandle' },
  { id: 'x', label: 'X', placeholder: 'x.com/yourhandle' },
  { id: 'discord', label: 'Discord', placeholder: 'discord.gg/yourinvite' },
  { id: 'website', label: 'Website', placeholder: 'yourproduct.com' },
];

export function SocialsStep() {
  const { campaignId = '' } = useParams();

  return (
    <AnswerPage pageId="socials" itemKey="socials">
      {({ state, refresh }) => (
        <>
          <ul className="ff-social-list">
            {state.socials.map((profile) => (
              <li className="ff-social" key={profile.id}>
                <span className="ff-social__name">{profile.handle ?? profile.url}</span>
                <span className="ff-social__note">
                  {profile.accessible === true ? (
                    <>
                      <Tag variant="moss">Opens</Tag> We checked it and it loaded.
                    </>
                  ) : profile.rejection ? (
                    <>
                      <Tag>Does not count</Tag> {rejectionText(profile.rejection)}
                    </>
                  ) : (
                    <>
                      <Tag>Not checked</Tag> We have not been able to look at this one yet.
                    </>
                  )}
                </span>
                {/* §28.4: the claim of control is its own control, never folded
                    into adding the address. */}
                <Option
                  label="I control this profile"
                  checked={profile.controlsConfirmed}
                  disabled={state.listingPaid}
                  onCheckedChange={(confirmed) =>
                    void refresh(confirmSocialControl(campaignId, profile.id, confirmed))
                  }
                />
                <Button
                  tier="tertiary"
                  small
                  disabled={state.listingPaid}
                  onClick={() => void refresh(recheckSocial(campaignId, profile.id))}
                >
                  Check this one again
                </Button>
                <Button
                  tier="tertiary"
                  small
                  disabled={state.listingPaid}
                  onClick={() => void refresh(removeSocial(campaignId, profile.id))}
                >
                  Remove this profile
                </Button>
              </li>
            ))}
          </ul>

          <SocialSlots
            disabled={state.listingPaid}
            onAdd={(url, controlsConfirmed) =>
              refresh(addSocial(campaignId, { url, controlsConfirmed }))
            }
          />
        </>
      )}
    </AnswerPage>
  );
}

function SocialSlots({
  disabled,
  onAdd,
}: {
  disabled: boolean;
  onAdd: (url: string, controlsConfirmed: boolean) => Promise<void>;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [controls, setControls] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);

  return (
    <div className="ff-social-slots">
      {SLOTS.map((slot) => {
        const value = values[slot.id] ?? '';
        return (
          <div className="ff-social-slot" key={slot.id}>
            <Field label={slot.label} id={`ff-social-${slot.id}`}>
              <Input
                type="url"
                value={value}
                disabled={disabled || busy === slot.id}
                placeholder={slot.placeholder}
                onChange={(event) =>
                  setValues((current) => ({ ...current, [slot.id]: event.target.value }))
                }
              />
            </Field>
            <Option
              label={`I control this ${slot.label} profile`}
              checked={controls[slot.id] === true}
              disabled={disabled}
              onCheckedChange={(on) =>
                setControls((current) => ({ ...current, [slot.id]: on }))
              }
            />
            <Button
              tier="secondary"
              disabled={disabled || busy === slot.id || !value.trim()}
              onClick={() => {
                setBusy(slot.id);
                void onAdd(value.trim(), controls[slot.id] === true)
                  .then(() => {
                    setValues((current) => ({ ...current, [slot.id]: '' }));
                    setControls((current) => ({ ...current, [slot.id]: false }));
                  })
                  .finally(() => setBusy(null));
              }}
            >
              {busy === slot.id ? 'Checking…' : `Add this ${slot.label} profile`}
            </Button>
          </div>
        );
      })}
    </div>
  );
}
