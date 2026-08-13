/**
 * The panel every Founder-workspace decision opens in, and the decision form
 * that fills it.
 *
 * ── Why this is not the shared `Modal` ──────────────────────────────────────
 * `components/Modal.tsx` opens from a `trigger` element it renders itself. Every
 * decision here is opened from somewhere else — a `•••` menu item, a row's Edit
 * button, an attention box — so the panel has to be openable programmatically
 * while still growing from whatever was pressed (DNA §6.5 forbids a fade from a
 * centred void). Rather than widen the shared component for one caller, this is
 * Radix `Dialog` with the same `.modal` / `.scrim` classes and the same
 * `animateModalOpen` / `animateModalClose` tweens, so there is one look and one
 * motion even though there are two mounts.
 *
 * Radix still owns the behaviour that is easy to get wrong: the focus trap,
 * Escape, the outside click, and `aria-modal`.
 *
 * ── Except the one thing having no `Dialog.Trigger` costs ───────────────────
 * Radix's modal content restores focus by calling `preventDefault()` on the
 * close-autofocus event and focusing its own `Dialog.Trigger`. This dialog has
 * no trigger to render — that is the whole reason it exists — so that restore
 * targets `null` while still cancelling the FocusScope's fallback, and the
 * panel closes having dropped focus on `<body>`. A keyboard Admin who opens a
 * decision from the `•••` menu and then cancels is returned to the top of the
 * document with no position (§28.5, §33.11). So the restore is done here,
 * against the element that opened it — the same element the panel grows from.
 *
 * ── The dialog refuses nothing ──────────────────────────────────────────────
 * A blank required field is caught here only so the Admin is not made to wait
 * for a round trip to be told. Everything else — whether this Founder may be
 * banned, whether the session is fresh enough, whether the invitation is
 * sendable — is the server's answer, and its refusal is what gets rendered
 * (§1.1: a disabled button is not authorization).
 *
 * ── The "reauthentication" step, and where it deviates ──────────────────────
 * The reference gates the ban's primary button behind a `Reauthenticate` button
 * that only flips a local flag. Nothing in this product re-authenticates from a
 * dialog — `requireFreshSession` is satisfied by signing in again — so a control
 * with that label would claim a capability that does not exist (§1.4). The step
 * is kept, because a permanent sanction should take two deliberate acts, and it
 * is labelled as what it actually is. The box states the real rule beside it:
 * the server checks the session on submit and refuses a stale one having
 * changed nothing.
 */

import {
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Dialog } from 'radix-ui';
import {
  Button,
  Field,
  Input,
  Textarea,
  useButtonProgress,
  useToast,
} from '../../../../components/index.js';
import { animateModalClose, animateModalOpen } from '../../../../components/anim.js';
import { useProovdMotion } from '../../../../motion/MotionProvider.js';
import { AdminRequestError } from '../../api.js';

/* ── The panel ──────────────────────────────────────────────────────────────*/

interface DialogShellProps {
  /** `Legal name · Product` — who this is about. */
  kicker: string;
  title: string;
  /** Radix uses this for `aria-describedby`; never omit it. */
  description: ReactNode;
  /** The element that opened it — the panel grows from there (DNA §6.5). */
  trigger: HTMLElement | null;
  onClose: () => void;
  /** Receives the close callback, so a form can dismiss itself on success. */
  children: (close: () => void) => ReactNode;
}

export function DialogShell({
  kicker,
  title,
  description,
  trigger,
  onClose,
  children,
}: DialogShellProps) {
  const [open, setOpen] = useState(true);
  const contentRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const closing = useRef(false);
  /**
   * Where focus goes when this closes.
   *
   * The pressed control where there was one, and otherwise whatever was focused
   * at the moment the panel mounted — which is what Radix's FocusScope would
   * have used, captured here because its fallback never runs (see the header).
   * Read once: by the time the panel closes the Admin may have moved focus
   * inside it, and returning them to where they were *inside* a panel that no
   * longer exists is not a position.
   */
  const restoreTo = useRef<HTMLElement | null>(
    trigger ?? (document.activeElement as HTMLElement | null),
  );

  useProovdMotion(contentRef, [title]);

  useLayoutEffect(() => {
    if (contentRef.current) {
      animateModalOpen(contentRef.current, overlayRef.current, trigger);
    }
    // Mounted once per decision, so the entrance plays once by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const requestClose = useCallback(() => {
    if (closing.current) return;
    if (!contentRef.current) {
      setOpen(false);
      onClose();
      return;
    }
    closing.current = true;
    animateModalClose(contentRef.current, overlayRef.current, () => {
      closing.current = false;
      setOpen(false);
      onClose();
    });
  }, [onClose]);

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
            // Only claim the restore when there is somewhere real to go. A node
            // React has since removed — the trigger of a row a re-read
            // replaced — would focus nothing, so Radix's own handling is left
            // to run rather than being cancelled for no gain.
            if (!target || !target.isConnected) return;
            event.preventDefault();
            target.focus();
          }}
        >
          {/*
            `modal--form` is the wider, scrollable variant. The base `.modal` has
            no max-height, and these panels carry real forms — Add founder has
            twelve fields, a §22.7 ban has six — so on a short viewport the
            primary action ends up below the fold with no way to reach it. A
            confirm dialog you cannot confirm is worse than no dialog.
          */}
          <div ref={contentRef} className="modal modal--form">
            <span className="kicker">{kicker}</span>
            <Dialog.Title asChild>
              <h2 className="h2">{title}</h2>
            </Dialog.Title>
            <Dialog.Description asChild>
              <div>{description}</div>
            </Dialog.Description>
            {children(requestClose)}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/* ── The decision form ──────────────────────────────────────────────────────*/

/** One control inside a decision dialog. */
export interface DialogField {
  id: string;
  label: string;
  required?: boolean;
  textarea?: boolean;
  select?: boolean;
  /**
   * A closed list. Plain strings where the value IS the label; `{value,label}`
   * where the server needs a key the Admin should never have to read — §22.7's
   * ban triggers are stored as `failed_day_14` and shown as the sentence.
   */
  options?: readonly (string | { value: string; label: string })[];
  /**
   * Native input type where the value has one — a date, an address, a number.
   *
   * `datetime-local` was added for the Support workspace: §27.8's promised
   * checkpoint and §26.8's expected-response time are INSTANTS, and a date
   * picker with no time would have an Admin promising "some time on Thursday"
   * and the queue reporting the breach at midnight. Additive — no existing
   * caller changes behaviour.
   */
  inputType?: 'text' | 'email' | 'tel' | 'url' | 'date' | 'datetime-local';
  placeholder?: string;
  value?: string;
  /** A quiet line under the label, when it changes what the Admin types. */
  hint?: ReactNode;
}

/** Everything a decision dialog renders. Copy lives with the decision. */
export interface DialogSpec {
  kicker: string;
  title: string;
  body: ReactNode;
  fields: DialogField[];
  /**
   * A deliberate second act before the primary enables. Used only by the one
   * permanent sanction — see the file header for why it is not a login.
   */
  reauth?: boolean;
  primary: string;
  secondary?: string;
}

export type DialogValues = Record<string, string>;

interface ConfirmDialogProps {
  spec: DialogSpec;
  trigger: HTMLElement | null;
  /** Throw to keep the dialog open and show the failure. */
  onSubmit: (values: DialogValues) => Promise<void>;
  onClose: () => void;
}

const ACKNOWLEDGEMENT_LABEL = 'Acknowledge — a permanent ban cannot be lifted';

export function ConfirmDialog({ spec, trigger, onSubmit, onClose }: ConfirmDialogProps) {
  const uid = useId();
  const [values, setValues] = useState<DialogValues>(() =>
    Object.fromEntries(spec.fields.map((field) => [field.id, field.value ?? ''])),
  );
  const [invalid, setInvalid] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const primaryRef = useRef<HTMLButtonElement>(null);

  const toast = useToast();
  const withProgress = useButtonProgress();

  const domId = useCallback((fieldId: string) => `${uid}-${fieldId}`, [uid]);

  const set = (fieldId: string, value: string) =>
    setValues((prev) => ({ ...prev, [fieldId]: value }));

  async function submit(close: () => void) {
    setFailure(null);
    for (const field of spec.fields) {
      if (!field.required) continue;
      if (values[field.id]?.trim()) continue;
      setInvalid(field.id);
      document.getElementById(domId(field.id))?.focus();
      toast('This field is required', {
        sub: 'Manual decisions record a reason — actor, time, before and after.',
      });
      return;
    }
    setInvalid(null);

    const trimmed: DialogValues = Object.fromEntries(
      Object.entries(values).map(([key, value]) => [key, value.trim()]),
    );

    /*
     * The runtime's progress morph swallows a rejected `work` — it restores the
     * button and resolves — so the refusal has to be caught inside the callback
     * and read afterwards. A held object rather than a `let`, because a value a
     * nested function assigns is not one the checker can follow.
     */
    const outcome: { refusal: string | null } = { refusal: null };
    await withProgress(primaryRef, async () => {
      try {
        await onSubmit(trimmed);
      } catch (error) {
        outcome.refusal =
          error instanceof AdminRequestError
            ? [error.detail.title, error.detail.whatHappened, error.detail.next]
                .filter(Boolean)
                .join(' ')
            : 'Nothing was recorded, and it is not certain why. Reload this page to see the stored values before trying again.';
      }
    });

    if (outcome.refusal !== null) {
      setFailure(outcome.refusal);
      return;
    }
    close();
  }

  const blocked = spec.reauth === true && !acknowledged;

  return (
    <DialogShell
      kicker={spec.kicker}
      title={spec.title}
      description={spec.body}
      trigger={trigger}
      onClose={onClose}
    >
      {(close) => (
        <>
          {spec.fields.map((field) => (
            <Field
              key={field.id}
              id={domId(field.id)}
              label={field.label}
              hint={field.hint}
              error={invalid === field.id ? 'This field is required.' : undefined}
            >
              {field.select ? (
                <select
                  className="input"
                  value={values[field.id] ?? ''}
                  onChange={(event) => set(field.id, event.target.value)}
                >
                  {(field.options ?? []).map((option) => {
                    const value = typeof option === 'string' ? option : option.value;
                    const label = typeof option === 'string' ? option : option.label;
                    return (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    );
                  })}
                </select>
              ) : field.textarea ? (
                <Textarea
                  rows={3}
                  placeholder={field.placeholder}
                  value={values[field.id] ?? ''}
                  onChange={(event) => set(field.id, event.target.value)}
                />
              ) : (
                <Input
                  type={field.inputType}
                  placeholder={field.placeholder}
                  value={values[field.id] ?? ''}
                  onChange={(event) => set(field.id, event.target.value)}
                />
              )}
            </Field>
          ))}

          {spec.reauth ? (
            <div className="reauth-box">
              <p>
                <b>Recent reauthentication required</b>
              </p>
              <p className="helper">
                High-impact actions need a recent sign-in. Proovd checks the session when
                this is submitted — a stale one is refused, and nothing changes.
              </p>
              {acknowledged ? (
                <p className="helper" role="status">
                  Acknowledged. This ban is permanent and there is no lift.
                </p>
              ) : (
                <Button tier="secondary" small onClick={() => setAcknowledged(true)}>
                  {ACKNOWLEDGEMENT_LABEL}
                </Button>
              )}
            </div>
          ) : null}

          {failure ? (
            <p className="field-error" role="alert">
              {failure}
            </p>
          ) : null}

          <div className="case-actions">
            {/*
              A raw `.btn` rather than the `Button` primitive: the progress morph
              needs the element itself and `Button` takes no ref. The markup it
              renders is identical.
            */}
            <button
              ref={primaryRef}
              type="button"
              className="btn btn--primary"
              disabled={blocked}
              onClick={() => void submit(close)}
            >
              <span className="btn__label">{spec.primary}</span>
            </button>
            <Dialog.Close asChild>
              <Button tier="tertiary">{spec.secondary ?? 'Cancel'}</Button>
            </Dialog.Close>
          </div>
        </>
      )}
    </DialogShell>
  );
}
