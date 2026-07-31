/**
 * Text input, textarea, and the Field wrapper that wires a label and error to
 * a control (DNA §7.1, Spec §28.5).
 *
 * Inputs are the ONLY grey-bordered tappable, and never a silent box: a
 * placeholder or a label is required. Focus morphs the border to brand — bound
 * by the runtime from the `.input` class, no motion code here.
 *
 * `Field` guarantees programmatic error association: the error is linked via
 * `aria-describedby`, `aria-invalid` is set, and the message carries
 * `role="alert"` so it is announced. Errors are conveyed by text, never colour
 * alone (the palette has no error hue — inventing one is out, DNA §1).
 */
import {
  Children,
  cloneElement,
  isValidElement,
  useId,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import { cn } from './cn.js';

type InputProps = InputHTMLAttributes<HTMLInputElement> & { hero?: boolean };

export function Input({ hero, className, ...rest }: InputProps) {
  return (
    <input className={cn('input', hero && 'input--hero', className)} {...rest} />
  );
}

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export function Textarea({ className, rows = 4, ...rest }: TextareaProps) {
  return <textarea className={cn('input', className)} rows={rows} {...rest} />;
}

interface FieldProps {
  label: ReactNode;
  /** The control — a single `<Input>` / `<Textarea>` element. */
  children: ReactElement<{
    id?: string;
    'aria-describedby'?: string;
    'aria-invalid'?: boolean;
  }>;
  /** Present ⇒ the field is invalid and this message is announced. */
  error?: ReactNode;
  /** Optional quiet helper line, only when it changes what the user does. */
  hint?: ReactNode;
  id?: string;
}

export function Field({ label, children, error, hint, id }: FieldProps) {
  const auto = useId();
  const fieldId = id ?? auto;
  const errorId = `${fieldId}-error`;
  const hintId = `${fieldId}-hint`;
  const describedBy =
    [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') ||
    undefined;

  const control = Children.only(children);
  const wired = isValidElement(control)
    ? cloneElement(control, {
        id: fieldId,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : undefined,
      })
    : control;

  return (
    <div className="field">
      <label className="field-label" htmlFor={fieldId}>
        {label}
      </label>
      {hint ? (
        <p className="field-hint" id={hintId}>
          {hint}
        </p>
      ) : null}
      {wired}
      {error ? (
        <p className="field-error" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
