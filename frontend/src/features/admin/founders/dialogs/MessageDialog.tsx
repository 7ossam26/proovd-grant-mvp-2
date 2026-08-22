/**
 * The Founder conversation — rendered, and honestly inert.
 *
 * ── Why there is nothing behind it ──────────────────────────────────────────
 * §30 defers direct Founder–Creator and Founder–Admin messaging, and no table,
 * route or notification key exists for a message sent from here. The reference
 * keeps a mock thread in memory; this cannot, and pretending otherwise would be
 * the exact failure §1.4 names — a polished surface implying a capability that
 * does not exist.
 *
 * So the sheet renders: its kicker, the Founder's name, the thread (which is
 * genuinely empty, not "loading"), and the writing surface — with the writing
 * surface marked read-only and the reason standing where `Send message` would
 * be. A disabled Send button was the alternative and is worse: a disabled
 * control invites somebody to work out how to enable it, while an absence with
 * its reason beside it says what is true.
 *
 * The recovery is real and named: a support case is recorded, reaches the
 * Founder, and has an owner and a due time.
 */

import { Overlay } from './Overlay.js';

interface Props {
  founderName: string;
  onClose: () => void;
}

export function MessageDialog({ founderName, onClose }: Props) {
  const firstName = founderName.split(' ')[0] ?? founderName;

  return (
    <Overlay label={`Conversation with ${founderName}`} onClose={onClose}>
      <p className="dialog-kicker">Conversation</p>
      <h2>{founderName}</h2>
      <p className="dialog-lead">
        There is no Founder message store, so this conversation holds no history and cannot send.
        Every message to a Founder today is a support case, which is recorded, owned, and has a
        response time.
      </p>
      <div className="message-thread" />
      <textarea readOnly placeholder={`Message ${firstName}`} aria-describedby="message-inert" />
      <div className="dialog-actions">
        <button type="button" onClick={onClose}>
          Cancel
        </button>
        <small id="message-inert">Sending is not built. Open a support case instead.</small>
      </div>
    </Overlay>
  );
}
