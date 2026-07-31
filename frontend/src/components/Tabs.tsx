/**
 * Tabs — Radix Tabs for behaviour/ARIA (tablist/tab/tabpanel roles, roving
 * focus, arrow keys), proovd.css for looks, GSAP to slide + resize the
 * underline to the active tab (DNA §6.5, the Flip.fit recipe).
 *
 * The active tab is conveyed by `aria-selected` and an ink shift, never colour
 * alone — so the underline is a pure motion enhancement that's safe to drop
 * when GSAP is unavailable.
 */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Tabs as RadixTabs } from 'radix-ui';
import { cn } from './cn.js';
import { moveTabUnderline } from './anim.js';

export interface TabEntry {
  value: string;
  label: ReactNode;
  content: ReactNode;
}

interface TabsProps {
  items: TabEntry[];
  defaultValue?: string;
  /** Accessible name for the tab list. */
  label: string;
}

export function Tabs({ items, defaultValue, label }: TabsProps) {
  const [value, setValue] = useState(defaultValue ?? items[0]?.value ?? '');
  const listRef = useRef<HTMLDivElement>(null);
  const underlineRef = useRef<HTMLSpanElement>(null);
  const first = useRef(true);

  function park(animate: boolean) {
    const list = listRef.current;
    const underline = underlineRef.current;
    if (!list || !underline) return;
    moveTabUnderline(underline, list.querySelector<HTMLElement>('.tab.is-active'), animate);
  }

  useLayoutEffect(() => {
    park(!first.current);
    first.current = false;
  }, [value]);

  useEffect(() => {
    const onResize = () => park(false);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return (
    <RadixTabs.Root value={value} onValueChange={setValue} className="tabs">
      <RadixTabs.List asChild aria-label={label}>
        <div ref={listRef} className="tablist">
          {items.map((item) => (
            <RadixTabs.Trigger key={item.value} asChild value={item.value}>
              <button
                type="button"
                className={cn('tab', value === item.value && 'is-active')}
              >
                {item.label}
              </button>
            </RadixTabs.Trigger>
          ))}
          <span ref={underlineRef} className="tab-underline" aria-hidden="true" />
        </div>
      </RadixTabs.List>
      {items.map((item) => (
        <RadixTabs.Content key={item.value} asChild value={item.value}>
          <div className="tabpanel">{item.content}</div>
        </RadixTabs.Content>
      ))}
    </RadixTabs.Root>
  );
}
