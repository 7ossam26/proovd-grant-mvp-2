/**
 * Menu — Radix DropdownMenu for behaviour/ARIA (roving focus, type-ahead,
 * Esc, outside-click), proovd.css `.menu` for the panel, GSAP for the scaleY
 * unfold + item stagger (DNA §6.5).
 *
 * The unfold animates an inner element, never the Radix content node itself —
 * that node carries Popper's positioning transform, and animating it would
 * fight the placement. Controlled open so the exit plays before unmount.
 */
import {
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import { DropdownMenu } from 'radix-ui';
import { animateMenuClose, animateMenuOpen } from './anim.js';

export interface MenuItem {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
}

interface MenuProps {
  trigger: ReactElement;
  items: MenuItem[];
  /** Accessible name for the menu surface. */
  label: string;
}

export function Menu({ trigger, items, label }: MenuProps) {
  const [open, setOpen] = useState(false);
  const closing = useRef(false);
  const innerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (open && innerRef.current) animateMenuOpen(innerRef.current);
  }, [open]);

  function handleOpenChange(next: boolean) {
    if (next) {
      closing.current = false;
      setOpen(true);
      return;
    }
    if (closing.current) return;
    if (!innerRef.current) {
      setOpen(false);
      return;
    }
    closing.current = true;
    animateMenuClose(innerRef.current, () => {
      closing.current = false;
      setOpen(false);
    });
  }

  return (
    <DropdownMenu.Root open={open} onOpenChange={handleOpenChange}>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content sideOffset={8} align="start" aria-label={label}>
          {/* Radix positions this node; the visible panel is the inner div so
              the unfold tween never fights Popper's transform. */}
          <div ref={innerRef} className="menu">
            {items.map((item) => (
              <DropdownMenu.Item
                key={item.label}
                asChild
                disabled={item.disabled}
                onSelect={item.onSelect}
              >
                <button type="button">{item.label}</button>
              </DropdownMenu.Item>
            ))}
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
