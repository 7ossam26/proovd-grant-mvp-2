/**
 * Accordion — Radix Accordion for behaviour/ARIA (aria-expanded, region
 * labelling, arrow-key nav between headers), proovd.css for looks, GSAP for the
 * height morph + 45° chevron rotate (DNA §6.5).
 *
 * Radix's Collapsible sets `hidden` the instant a panel closes, which would
 * jump-cut the collapse. So the open value is controlled and a *close* is
 * deferred: the panel plays its height tween while still mounted, then the
 * value flips and Radix unmounts it. Opening animates 0→auto on mount. Text
 * inside is only ever read when its panel is actually open (no forceMount).
 */
import {
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Accordion as RadixAccordion } from 'radix-ui';
import { animateAccordion } from './anim.js';
import { ChevronDownIcon } from './icons.js';

export interface AccordionEntry {
  value: string;
  head: ReactNode;
  body: ReactNode;
}

interface AccordionProps {
  items: AccordionEntry[];
  /** Value open on first render. */
  defaultValue?: string;
}

export function Accordion({ items, defaultValue = '' }: AccordionProps) {
  const [openValue, setOpenValue] = useState(defaultValue);
  const bodies = useRef<Record<string, HTMLDivElement | null>>({});
  const chevs = useRef<Record<string, HTMLSpanElement | null>>({});
  const closing = useRef(false);

  function handleValueChange(next: string) {
    if (closing.current) return;
    if (next) {
      setOpenValue(next); // enter animates in the item's effect
      return;
    }
    // collapse the currently-open panel, then let Radix unmount it
    const body = bodies.current[openValue];
    const chev = chevs.current[openValue];
    if (!body) {
      setOpenValue('');
      return;
    }
    closing.current = true;
    animateAccordion(body, chev, false, true, () => {
      closing.current = false;
      setOpenValue('');
    });
  }

  return (
    <RadixAccordion.Root
      type="single"
      collapsible
      value={openValue}
      onValueChange={handleValueChange}
    >
      {items.map((item) => (
        <AccordionItem
          key={item.value}
          item={item}
          open={openValue === item.value}
          registerBody={(node) => (bodies.current[item.value] = node)}
          registerChev={(node) => (chevs.current[item.value] = node)}
        />
      ))}
    </RadixAccordion.Root>
  );
}

interface ItemProps {
  item: AccordionEntry;
  open: boolean;
  registerBody: (node: HTMLDivElement | null) => void;
  registerChev: (node: HTMLSpanElement | null) => void;
}

function AccordionItem({ item, open, registerBody, registerChev }: ItemProps) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const chevRef = useRef<HTMLSpanElement | null>(null);

  // Enter only — the collapse is driven by the parent before unmount.
  useLayoutEffect(() => {
    if (open && bodyRef.current) {
      animateAccordion(bodyRef.current, chevRef.current, true, true);
    }
  }, [open]);

  return (
    <RadixAccordion.Item className="accordion" value={item.value}>
      <RadixAccordion.Header asChild>
        <h3 className="accordion__header">
          <RadixAccordion.Trigger asChild>
            <button type="button" className="accordion__head">
              <span>{item.head}</span>
              <span
                className="accordion__chev"
                aria-hidden="true"
                ref={(node) => {
                  chevRef.current = node;
                  registerChev(node);
                }}
              >
                <ChevronDownIcon />
              </span>
            </button>
          </RadixAccordion.Trigger>
        </h3>
      </RadixAccordion.Header>
      <RadixAccordion.Content asChild>
        <div
          className="accordion__body"
          ref={(node) => {
            bodyRef.current = node;
            registerBody(node);
          }}
        >
          <div>{item.body}</div>
        </div>
      </RadixAccordion.Content>
    </RadixAccordion.Item>
  );
}
