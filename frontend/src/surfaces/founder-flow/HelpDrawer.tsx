/** The reference's Help drawer: reading for this page, never flow navigation. */
import { useLayoutEffect, useRef, useState, type ReactElement } from 'react';
import { Dialog } from 'radix-ui';
import { referenceDrawerClose, referenceDrawerOpen } from '../../components/anim.js';

interface HelpDoc {
  title: string;
  body: string;
  tag: string;
}

const HANDBOOK: HelpDoc = {
  title: 'Proovd founder handbook.pdf',
  body: 'Every step of the flow in one document. Worth a skim.',
  tag: 'GUIDE · 4.2 MB',
};

const DOCS: Readonly<Record<string, readonly HelpDoc[]>> = {
  invite: [
    { title: 'Your Proovd invite, explained.pdf', body: 'What claiming commits you to, and what it does not.', tag: 'PDF · 0.4 MB' },
    { title: 'Founder onboarding at a glance.pdf', body: 'The eight questions, the fee, and how long each part takes.', tag: 'PDF · 1.1 MB' },
  ],
  problem: [
    { title: 'Writing a problem backers recognise.pdf', body: 'Four rewrites of a real problem statement, worst to best.', tag: 'PDF · 0.8 MB' },
    { title: 'Problem statement worksheet.pdf', body: 'Fill-in-the-blank sheet you can paste straight in.', tag: 'WORKSHEET · 0.2 MB' },
  ],
  solution: [
    { title: 'One-sentence solution statements.pdf', body: 'How to say what you built without a feature list.', tag: 'PDF · 0.6 MB' },
  ],
  reach: [
    { title: 'How creator reach is counted.pdf', body: 'Where the audience number comes from and what it excludes.', tag: 'PDF · 0.5 MB' },
  ],
  'campaign-type': [
    { title: 'Idea or Product: picking your campaign.pdf', body: 'Which one raises more, by category, from 400 campaigns.', tag: 'PDF · 1.3 MB' },
  ],
  email: [
    { title: 'Why we verify your email.pdf', body: 'How sign-in ties your campaign and payouts to you.', tag: 'PDF · 0.3 MB' },
  ],
  code: [
    { title: 'Why we verify your email.pdf', body: 'How sign-in ties your campaign and payouts to you.', tag: 'PDF · 0.3 MB' },
  ],
  'confirm-problem': [
    { title: 'Problem and solution checklist.pdf', body: 'Six checks before the rest of your answers build on these.', tag: 'PDF · 0.4 MB' },
  ],
  'confirm-solution': [
    { title: 'Problem and solution checklist.pdf', body: 'Six checks before the rest of your answers build on these.', tag: 'PDF · 0.4 MB' },
  ],
  positioning: [
    { title: 'Competitor mapping worksheet.pdf', body: 'Direct rivals, indirect rivals, and the workaround people use now.', tag: 'WORKSHEET · 0.3 MB' },
    { title: 'Naming rivals without selling them.pdf', body: 'How to be specific and still come out ahead.', tag: 'PDF · 0.7 MB' },
  ],
  visuals: [
    { title: 'Shooting product photos on a phone.pdf', body: 'Window light, one surface, no tripod.', tag: 'PDF · 2.4 MB' },
    { title: 'Clip lengths that convert.pdf', body: 'What backers actually watch to the end.', tag: 'PDF · 0.9 MB' },
  ],
  branding: [
    { title: 'How to make AI logos that do not look AI.pdf', body: 'Prompts, cleanup, and the four tells to remove.', tag: 'PDF · 3.1 MB' },
    { title: 'Picking one brand colour.pdf', body: 'Why a single colour beats a palette on a campaign page.', tag: 'PDF · 0.8 MB' },
  ],
  color: [
    { title: 'How to make AI logos that do not look AI.pdf', body: 'Prompts, cleanup, and the four tells to remove.', tag: 'PDF · 3.1 MB' },
    { title: 'Picking one brand colour.pdf', body: 'Why a single colour beats a palette on a campaign page.', tag: 'PDF · 0.8 MB' },
  ],
  interview: [
    { title: 'What happens on the founder call.pdf', body: 'Who joins, what we ask, and what you get after.', tag: 'PDF · 0.4 MB' },
  ],
  story: [
    { title: 'Founder story prompts.pdf', body: 'Nine questions that get a story out of you in ten minutes.', tag: 'PDF · 0.6 MB' },
    { title: 'Dictating instead of writing.pdf', body: 'Speaking your answer, then tidying the transcript.', tag: 'PDF · 0.3 MB' },
  ],
  socials: [
    { title: 'Which socials backers actually check.pdf', body: 'Ranked by how often backers click through.', tag: 'PDF · 0.5 MB' },
  ],
  'last-look': [
    { title: 'Bonus answers and your listing fee.pdf', body: 'Every bonus section, what it costs you in time, what it saves.', tag: 'PDF · 0.4 MB' },
  ],
  details: [
    { title: 'ID and payout name matching.pdf', body: 'Why the name here has to match your ID exactly.', tag: 'PDF · 0.3 MB' },
  ],
  match: [
    { title: 'How we match creators.pdf', body: 'Category, audience overlap, and past campaign fit.', tag: 'PDF · 0.7 MB' },
  ],
  'creator-payment': [
    { title: 'Creator commission, worked example.pdf', body: 'A $40,000 campaign, line by line, both pay models.', tag: 'PDF · 0.9 MB' },
  ],
  'application-review': [
    { title: 'What our review looks for.pdf', body: 'The seven things we check, and the usual reasons for a rejection.', tag: 'PDF · 0.6 MB' },
  ],
  fee: [
    { title: 'Listing fee breakdown.pdf', body: 'What the fee covers and how the discounts stack.', tag: 'PDF · 0.3 MB' },
  ],
  voice: [
    { title: 'Brand voice adjectives that are not filler.pdf', body: 'Sixty words that mean something, and the ones to drop.', tag: 'PDF · 0.7 MB' },
  ],
  threshold: [
    { title: 'Setting an order threshold you can deliver.pdf', body: 'Sizing a target against your production run.', tag: 'PDF · 0.8 MB' },
  ],
  faqs: [
    { title: 'The five FAQs backers always ask.pdf', body: 'Delivery, refunds, shipping, timelines, and who you are.', tag: 'PDF · 0.5 MB' },
  ],
  rewards: [
    { title: 'Rewards that beat discounts.pdf', body: 'In-app perks, early access, and why price cuts attract the wrong backers.', tag: 'PDF · 1.2 MB' },
    { title: 'Delivery dates you can keep.pdf', body: 'Working back from your production lead time.', tag: 'PDF · 0.4 MB' },
  ],
  payouts: [
    { title: 'Stripe onboarding checklist.pdf', body: 'Every document Stripe asks for, in the order it asks.', tag: 'PDF · 0.6 MB' },
    { title: 'SSN or EIN for payouts.pdf', body: 'Which one applies to you, and what changes if you incorporate.', tag: 'PDF · 0.4 MB' },
  ],
  'in-review': [
    { title: 'What we check before you go live.pdf', body: 'Page, rewards, and creator line-up.', tag: 'PDF · 0.5 MB' },
  ],
  live: [
    { title: 'Your first week live.pdf', body: 'What to post, when to email, and the day-three dip.', tag: 'PDF · 1.4 MB' },
  ],
};

export function HelpDrawer({
  pageId,
  param: _param,
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
  const docs = [...(DOCS[pageId] ?? []), HANDBOOK];

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
            <div className="ff-help-ref__intro">Reading for this page</div>
            <div className="ff-help-ref__docs">
              {docs.map((doc, index) => (
                <article className={index === 0 ? 'is-current' : undefined} key={`${doc.title}-${index}`}>
                  <span className="ff-help-ref__tag">{doc.tag}</span>
                  <strong>{doc.title}</strong>
                  <span>{doc.body}</span>
                </article>
              ))}
            </div>
          </aside>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
