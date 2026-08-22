/**
 * One record, read in full — the reference's `detail` sheet.
 *
 * It is what a ⌘K result and a support case open into, and it renders its body
 * in a `<pre class="detail-copy">` on purpose: the body is composed text with
 * meaningful line breaks (a case's description above its status and owner), and
 * a `<p>` would run the lines together. The stylesheet gives `.detail-copy`
 * wrapping, so nothing here scrolls sideways.
 *
 * It reads and does nothing else, so its only action is `Done`.
 */

import { Overlay } from './Overlay.js';

interface Props {
  title: string;
  body: string;
  onClose: () => void;
}

export function DetailDialog({ title, body, onClose }: Props) {
  return (
    <Overlay label={title} onClose={onClose}>
      <p className="dialog-kicker">Record</p>
      <h2>{title}</h2>
      <pre className="detail-copy">{body}</pre>
      <div className="dialog-actions">
        <button className="primary" type="button" onClick={onClose}>
          Done
        </button>
      </div>
    </Overlay>
  );
}
