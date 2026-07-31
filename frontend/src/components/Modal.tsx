/**
 * Modal — Radix Dialog for behaviour/ARIA (focus trap, Esc, outside-click,
 * aria-modal, labelling), proovd.css for the brand-ringed panel, GSAP for the
 * grow-from-trigger motion (DNA §6.5 — never a fade from a centred void).
 *
 * Open state is controlled so the exit can animate before unmount: on a close
 * request the panel plays its exit tween, then unmounts. Motion targets the
 * portalled content directly (the §portal trap in the phase notes) and
 * `useProovdMotion` re-binds any declarative motion inside it.
 */
import {
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Dialog } from 'radix-ui';
import { Button } from './Button.js';
import { animateModalClose, animateModalOpen } from './anim.js';
import { useProovdMotion } from '../motion/MotionProvider.js';

interface ModalProps {
  /** The element that opens the modal — the panel grows from its position. */
  trigger: ReactElement;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** Label for the built-in close button. Default "Close". */
  closeLabel?: string;
}

export function Modal({
  trigger,
  title,
  description,
  children,
  closeLabel = 'Close',
}: ModalProps) {
  const [open, setOpen] = useState(false);
  const closing = useRef(false);
  const triggerRef = useRef<HTMLElement | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  useProovdMotion(contentRef, [open]);

  useLayoutEffect(() => {
    if (open && contentRef.current) {
      animateModalOpen(contentRef.current, overlayRef.current, triggerRef.current);
    }
  }, [open]);

  function handleOpenChange(next: boolean) {
    if (next) {
      closing.current = false;
      setOpen(true);
      return;
    }
    if (closing.current) return;
    if (!contentRef.current) {
      setOpen(false);
      return;
    }
    closing.current = true;
    animateModalClose(contentRef.current, overlayRef.current, () => {
      closing.current = false;
      setOpen(false);
    });
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Trigger
        asChild
        ref={(node: HTMLElement | null) => {
          triggerRef.current = node;
        }}
      >
        {trigger}
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay asChild>
          <div ref={overlayRef} className="scrim" />
        </Dialog.Overlay>
        <Dialog.Content asChild>
          <div ref={contentRef} className="modal">
            <Dialog.Title className="h2">{title}</Dialog.Title>
            {description ? (
              <Dialog.Description className="lede">{description}</Dialog.Description>
            ) : null}
            {children}
            <div className="flow__nav">
              <Dialog.Close asChild>
                <Button tier="secondary">{closeLabel}</Button>
              </Dialog.Close>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
