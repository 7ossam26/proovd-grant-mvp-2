/**
 * §12's helper resources — static, copy-ready guidance.
 *
 * §12: "The workspace contains static, copy-ready guidance—not an embedded AI
 * product." §30 defers "AI pitch rewriting/refinement" by name. So every prompt
 * here is text beside a copy control, there is no generate button anywhere in
 * this file, and there is no server route it could call if there were.
 *
 * Staged as Glance → Explore (DNA §5.14): the one-line summary is visible, the
 * points and the prompts sit behind one gesture. §12 asks for four subjects of
 * real guidance, and four subjects of unfolded prose beside a form is the wall
 * DNA §5.9 exists to prevent.
 *
 * `Copylink` is deliberately not reused here: it is the URL affordance and its
 * confirmation says "Link copied", which a prompt is not.
 */

import { HELPER_RESOURCES, type HelperSubject } from '@proovd/shared';
import { Accordion, Button, useToast, type AccordionEntry } from '../../components/index.js';

function CopyPrompt({ title, text }: { title: string; text: string }) {
  const toast = useToast();

  async function copy() {
    try {
      await navigator.clipboard?.writeText(text);
      toast('Prompt copied', { sub: 'Paste it into whichever tool you use.' });
    } catch {
      toast('Copy failed — select the text and copy it', { accent: 'yellow' });
    }
  }

  return (
    <div className="helper__prompt">
      <p className="helper__prompt-title">{title}</p>
      <p className="helper__prompt-text">{text}</p>
      <Button tier="tertiary" small onClick={() => void copy()}>
        Copy prompt
      </Button>
    </div>
  );
}

export function HelperResources({ subject }: { subject: HelperSubject }) {
  const resource = HELPER_RESOURCES.find((r) => r.subject === subject);
  if (!resource) return null;

  const entries: AccordionEntry[] = [
    {
      value: `${subject}-guidance`,
      head: resource.title,
      body: (
        <div className="helper">
          <p className="lede">{resource.glance}</p>

          <ul className="helper__points">
            {resource.points.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>

          {resource.prompts.map((prompt) => (
            <CopyPrompt key={prompt.title} title={prompt.title} text={prompt.text} />
          ))}

          <ul className="helper__limits">
            {resource.limits.map((limit) => (
              <li key={limit}>{limit}</li>
            ))}
          </ul>
        </div>
      ),
    },
  ];

  return <Accordion items={entries} />;
}
