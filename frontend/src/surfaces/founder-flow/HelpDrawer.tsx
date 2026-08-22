/** Contextual help for Founder onboarding. Every item is real product guidance. */
import { useLayoutEffect, useRef, useState, type ReactElement } from 'react';
import { Dialog } from 'radix-ui';
import { referenceDrawerClose, referenceDrawerOpen } from '../../components/anim.js';

interface HelpTopic {
  title: string;
  body: string;
}

const HELP: Readonly<Record<string, HelpTopic>> = {
  invite: {
    title: 'Claiming your invitation',
    body: 'Review the invitation prepared for you. Claiming it starts this campaign’s onboarding; it does not publish a page or charge anything.',
  },
  problem: {
    title: 'The problem',
    body: 'Confirm or correct the problem your product solves. Your answer becomes campaign source material and stays editable until submission.',
  },
  solution: {
    title: 'The solution',
    body: 'Describe what you are building and how it addresses the problem. Be concrete; this is not a feature checklist.',
  },
  reach: {
    title: 'Audience reach',
    body: 'Record the audience information you can support. Proovd uses it for Creator recruitment and campaign planning.',
  },
  'campaign-type': {
    title: 'Campaign type',
    body: 'Choose Idea Campaign when the order threshold determines whether cards are charged. Choose Product Campaign when every active pre-order is charged at close.',
  },
  email: {
    title: 'Your account email',
    body: 'Use the email address you will keep access to. We send a verification code before linking the claimed invitation to your account.',
  },
  code: {
    title: 'Email verification',
    body: 'Enter the latest code sent to your account email. Requesting another code makes the earlier one unusable.',
  },
  'confirm-problem': {
    title: 'Confirm the problem',
    body: 'Check the wording before later campaign sections build on it. Correct anything that changes what a Backer would understand.',
  },
  'confirm-solution': {
    title: 'Confirm the solution',
    body: 'Check that this says what the product does without promising work or outcomes you cannot support.',
  },
  positioning: {
    title: 'Positioning',
    body: 'Name the alternatives people use today and explain the meaningful difference. This can include direct competitors and manual workarounds.',
  },
  visuals: {
    title: 'Campaign visuals',
    body: 'Add visuals you have the right to publish. They remain private draft material until the campaign is approved and launched.',
  },
  branding: {
    title: 'Branding',
    body: 'Confirm the product name and logo that should appear on this campaign. Do not upload marks you do not own or have permission to use.',
  },
  color: {
    title: 'Campaign colour',
    body: 'Choose the primary colour used to frame this campaign. It changes presentation only, not the campaign terms.',
  },
  interview: {
    title: 'Founder interview',
    body: 'Schedule or join the recorded campaign interview step shown here. The campaign cannot move past a required interview until its real status is recorded.',
  },
  story: {
    title: 'Founder story',
    body: 'Tell the product story in your own words. Keep claims specific and supported; the review team reads this before approval.',
  },
  socials: {
    title: 'Public profiles',
    body: 'Add only profiles that belong to you or the product. They help review and may be shown on the approved campaign page.',
  },
  'last-look': {
    title: 'Review your answers',
    body: 'Check the complete onboarding record before moving into campaign build. Nothing is public at this point.',
  },
  details: {
    title: 'Founder details',
    body: 'Use accurate identity and business details. Stripe collects its own identity, tax, and bank information on Stripe’s hosted pages, not here.',
  },
  match: {
    title: 'Creator matching',
    body: 'This shows the recorded recruitment state for your campaign. Proovd owns Creator outreach and records each real response.',
  },
  'creator-payment': {
    title: 'Creator compensation',
    body: 'Record whether you are open to a fixed Creator payment alongside an agreed percentage. Nothing becomes binding until both sides accept the same proposal.',
  },
  fee: {
    title: 'Listing fee',
    body: 'Your exact listing fee and any earned discounts are shown before payment. Sales tax is calculated from the billing address you provide.',
  },
  voice: {
    title: 'Campaign voice',
    body: 'Choose language that sounds like you and remains accurate. This guides the campaign draft; it does not change the transaction terms.',
  },
  threshold: {
    title: 'Order threshold',
    body: 'For an Idea Campaign, set the number of unique Backers with active pre-orders needed at close before saved cards can be charged.',
  },
  faqs: {
    title: 'Campaign questions',
    body: 'Answer the questions a Backer needs before reserving: delivery, access, cancellation, support, and what happens if plans change.',
  },
  rewards: {
    title: 'Reward packages',
    body: 'Each package needs an exact price, included digital items, fulfilment method, and delivery commitment.',
  },
  payouts: {
    title: 'Stripe onboarding',
    body: 'Stripe opens its own hosted onboarding. Proovd never asks you to enter bank, tax, or identity-document details into this page.',
  },
  'in-review': {
    title: 'Campaign review',
    body: 'This page reads the stored campaign and Creator-roster state. It changes only when the Founder, a Creator, or Proovd records the next real action.',
  },
  live: {
    title: 'Campaign live',
    body: 'Once launch is recorded, your campaign dashboard shows the live campaign state and the actions that belong to you.',
  },
};

const GENERAL_HELP: HelpTopic = {
  title: 'Founder onboarding help',
  body: 'Nothing on this page is public until the campaign passes review and launch is recorded. Contact Proovd if the stored state does not match what happened.',
};

export function HelpDrawer({
  pageId,
  param,
  trigger,
}: {
  pageId: string;
  param: string;
  trigger: ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const closing = useRef(false);
  const drawer = useRef<HTMLElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  const topic = HELP[pageId] ?? GENERAL_HELP;

  useLayoutEffect(() => {
    if (open) referenceDrawerOpen(drawer.current, scrim.current);
  }, [open]);

  function change(next: boolean) {
    if (next) {
      closing.current = false;
      setOpen(true);
      return;
    }
    if (closing.current) return;
    if (!drawer.current) {
      setOpen(false);
      return;
    }
    closing.current = true;
    referenceDrawerClose(drawer.current, () => {
      closing.current = false;
      setOpen(false);
    });
  }

  const supportHref = `/support?reference=${encodeURIComponent(param)}`;

  return (
    <Dialog.Root open={open} onOpenChange={change}>
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay asChild>
          <div className="ff-help-ref__scrim" ref={scrim} />
        </Dialog.Overlay>
        <Dialog.Content asChild>
          <aside className="ff-help-ref" ref={drawer}>
            <div className="ff-help-ref__head">
              <Dialog.Title>Help</Dialog.Title>
              <Dialog.Close asChild>
                <button type="button" aria-label="Close help">
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </Dialog.Close>
            </div>
            <div className="ff-help-ref__intro">Help for this page</div>
            <div className="ff-help-ref__docs">
              <section className="is-current">
                <strong>{topic.title}</strong>
                <span>{topic.body}</span>
                <a href={supportHref}>Contact Proovd support</a>
              </section>
            </div>
          </aside>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
