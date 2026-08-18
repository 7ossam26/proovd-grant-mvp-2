/**
 * Drawer / Sheet — the Explore surface (DNA §5.2). Radix Dialog for the modal
 * behaviour/ARIA; proovd.css `.drawer` + `.mode-drawer` (darker green) for the
 * panel; GSAP for the slide — a side panel from the right on desktop, a bottom
 * sheet on phone (DNA §8). Tabs stagger in behind the panel.
 *
 * Controlled so the exit slides out before unmount. Explore is always reachable
 * and never the landing state — that composition rule is the caller's.
 */
import {
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Dialog } from 'radix-ui';
import { animateDrawerClose, animateDrawerOpen } from './anim.js';
import { useProovdMotion } from '../motion/MotionProvider.js';

interface DrawerProps {
  trigger: ReactElement;
  title: ReactNode;
  /**
   * A small line above the title — the reference's `STEP 1 OF 2`.
   *
   * Deliberately NOT a replacement for `title`: `Dialog.Title` is the dialog's
   * accessible name, and a screen reader announcing "step 1 of 2" instead of
   * what the dialog is for would be a worse dialog that looked like a better
   * one. It is decorative and marked so.
   */
  eyebrow?: ReactNode;
  children: ReactNode;
}

export function Drawer({ trigger, title, eyebrow, children }: DrawerProps) {
  const [open, setOpen] = useState(false);
  const closing = useRef(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  useProovdMotion(contentRef, [open]);

  useLayoutEffect(() => {
    if (open && contentRef.current) {
      const tabs = Array.from(contentRef.current.querySelectorAll('.tab'));
      animateDrawerOpen(contentRef.current, overlayRef.current, tabs);
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
    animateDrawerClose(contentRef.current, overlayRef.current, () => {
      closing.current = false;
      setOpen(false);
    });
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay asChild>
          <div ref={overlayRef} className="scrim" />
        </Dialog.Overlay>
        <Dialog.Content asChild>
          <div ref={contentRef} className="drawer mode-drawer">
            {eyebrow ? (
              <p className="drawer__eyebrow" aria-hidden="true">
                {eyebrow}
              </p>
            ) : null}
            <Dialog.Title className="h2">{title}</Dialog.Title>
            {children}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
