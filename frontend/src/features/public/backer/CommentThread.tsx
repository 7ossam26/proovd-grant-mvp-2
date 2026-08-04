/**
 * The Backer's comment thread — Spec §18, §20 (Phase 17b).
 *
 * The last piece of §18, and it waited for the Backer identity and magic-link
 * session Phase 15 mints. It renders on the magic-link page, which is the only
 * place a Backer is authenticated at all — §18 says only a magic-link-
 * authenticated Backer may post, so a comment box on the public campaign page
 * would be a box nobody could use.
 *
 * ── The server owns every rule; this surface renders its answers ────────────
 * Whether comments are open, whether a display name is acceptable, and what a
 * Backer is called are all decided server-side and reported here in plain words.
 * The one thing this file must get right is not *pretending*: when the thread is
 * closed it says so and why, rather than showing a disabled box that looks like
 * a bug (§27.1's six questions, applied to a small surface).
 *
 * ── Flagging says what actually happens ─────────────────────────────────────
 * §1.4: never imply an automation that does not exist. Reporting a comment does
 * not hide it, so the confirmation says a person will read it and that the
 * comment stays up until they decide. A surface that made it disappear would be
 * describing moderation the product does not do.
 */

import { useEffect, useState } from 'react';
import { Button, Card, Field, Input, Textarea } from '../../../components/index.js';
import {
  fetchComments,
  flagComment,
  postComment,
  type BackerComment,
  type CommentThread as ThreadData,
} from './api.js';

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

interface Props {
  token: string;
  /** Omitted for the general thread; set for one update's thread (§18). */
  updateId?: string | undefined;
  heading?: string;
}

export function CommentThread({ token, updateId, heading = 'Comments' }: Props) {
  const [thread, setThread] = useState<ThreadData | null>(null);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<{ whatHappened: string; next: string } | null>(null);
  const [reported, setReported] = useState<Record<string, string>>({});

  async function load() {
    setLoading(true);
    setThread(await fetchComments(token, updateId));
    setLoading(false);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, updateId]);

  async function submit() {
    setPosting(true);
    setError(null);
    const result = await postComment(token, {
      body,
      ...(updateId ? { updateId } : {}),
      ...(displayName.trim() ? { displayName } : {}),
    });
    if (result.ok) {
      setBody('');
      await load();
    } else {
      setError({ whatHappened: result.whatHappened, next: result.next });
    }
    setPosting(false);
  }

  async function report(comment: BackerComment) {
    const reason = window.prompt('What is wrong with this comment?')?.trim();
    if (!reason) return;
    const result = await flagComment(token, comment.id, reason);
    setReported((prior) => ({
      ...prior,
      [comment.id]:
        result.next ??
        'Someone at Proovd will read it. The comment stays up until they decide.',
    }));
  }

  if (loading) {
    return (
      <Card>
        <h2>{heading}</h2>
        <p className="quiet">Loading the thread.</p>
      </Card>
    );
  }

  if (!thread) {
    return (
      <Card>
        <h2>{heading}</h2>
        <p className="quiet">The thread could not be loaded. Reload the page to try again.</p>
      </Card>
    );
  }

  return (
    <Card>
      <h2>{heading}</h2>

      {thread.comments.length === 0 ? (
        <p className="quiet">No comments yet.</p>
      ) : (
        <ul className="comment-list">
          {thread.comments.map((comment) => (
            <li key={comment.id} className="comment">
              <p className="comment__meta">
                <strong>{comment.authorDisplay}</strong>
                {comment.mine ? ' (you)' : ''} · {when(comment.postedAt)}
              </p>
              <p className="comment__body">{comment.body}</p>
              {reported[comment.id] ? (
                // §1.4: say what actually happens, which is a person reading it.
                <p className="quiet">{reported[comment.id]}</p>
              ) : comment.mine ? null : (
                <Button tier="tertiary" onClick={() => void report(comment)}>
                  Report this comment
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {thread.open ? (
        <div>
          <Field label="Your comment" id="comment-body">
            <Textarea value={body} onChange={(event) => setBody(event.target.value)} rows={4} />
          </Field>
          <Field
            label="Display name (optional)"
            id="comment-name"
            hint="Leave this blank and you will show as a Backer number. This thread is public."
          >
            <Input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </Field>
          {error ? (
            <p className="notice">
              {error.whatHappened} {error.next}
            </p>
          ) : null}
          <Button tier="primary" onClick={() => void submit()} disabled={posting || !body.trim()}>
            {posting ? 'Posting…' : 'Post comment'}
          </Button>
        </div>
      ) : (
        // §18 forbids one generic ended message; the server composes this one.
        <p className="notice">{thread.closedReason}</p>
      )}
    </Card>
  );
}
