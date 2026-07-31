/**
 * The gallery — a development-only route that renders every design-system
 * component in every section mode, at every breakpoint, with motion on and off.
 * It is the phase's proof and stays useful: check a component here before using
 * it in a real surface. Excluded from the production build (see router.tsx).
 *
 * Verify by resizing: 320 · 600 · 900 · desktop. Verify reduced motion via
 * devtools "Emulate prefers-reduced-motion: reduce". Verify the no-motion
 * fail-safe by renaming a file under /vendor/gsap/ and reloading.
 */
import { useRef, useState } from 'react';
import './gallery.css';
import {
  Accordion,
  Button,
  Card,
  Copylink,
  Cols,
  Dock,
  Drawer,
  Field,
  Flow,
  GridAuto,
  Input,
  Link,
  Menu,
  Modal,
  Mode,
  Option,
  Progress,
  Reveal,
  Scaffold,
  StatePanel,
  Stat,
  Stepper,
  Tabs,
  Tag,
  Textarea,
  Toggle,
  Wrap,
  useButtonProgress,
  useNumberRoll,
  useToast,
  type SectionMode,
} from '../components/index.js';

const MODES: SectionMode[] = ['none', 'dark', 'light', 'drawer'];

export default function Gallery() {
  const [mode, setMode] = useState<SectionMode>('none');

  function toggleHtmlClass(name: string, on: boolean) {
    document.documentElement.classList.toggle(name, on);
  }

  return (
    <div className="gx-root">
      <header className="gx-bar">
        <span className="gx-bar__label">Design system gallery</span>
        <Menu
          label="Section mode"
          trigger={<Button tier="secondary" small>{`Mode: ${mode}`}</Button>}
          items={MODES.map((m) => ({ label: m, onSelect: () => setMode(m) }))}
        />
        <div className="gx-bar__group">
          <Toggle
            label="Cover the copy"
            onCheckedChange={(on) => toggleHtmlClass('cover-copy', on)}
          />
          <Toggle
            label="Force no-motion CSS"
            onCheckedChange={(on) => toggleHtmlClass('no-motion', on)}
          />
        </div>
        <span className="gx-bar__label">
          Resize to 320 · 600 · 900 · desktop · devtools reduced-motion
        </span>
      </header>

      <main>
        <Mode kind={mode} className="gx-canvas">
          <Wrap>
            <Catalog />
          </Wrap>
        </Mode>
      </main>
    </div>
  );
}

function Demo({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="gx-demo" aria-label={title}>
      <h2 className="h2">{title}</h2>
      {note ? <p className="gx-demo__note">{note}</p> : null}
      {children}
    </section>
  );
}

function Catalog() {
  return (
    <div className="section">
      <TextDemo />
      <ButtonsDemo />
      <InputsDemo />
      <ToggleDemo />
      <OptionDemo />
      <StepperDemo />
      <TagDemo />
      <CardStatDemo />
      <LinkDemo />
      <ProgressDemo />
      <CopylinkDemo />
      <StickerDemo />
      <TabsDemo />
      <AccordionDemo />
      <MenuDemo />
      <OverlayDemo />
      <ToastDemo />
      <StatePanelDemo />
      <FlowDemo />
      <ScaffoldDemo />
      <DockDemo />
    </div>
  );
}

/* ── Dock ───────────────────────────────────────────────────────────────── */
function DockDemo() {
  return (
    <Demo
      title="Dock"
      note="On phones this pins to the bottom on the solid page background and reserves space — it never covers content. On desktop it's a normal row."
    >
      <Dock>
        <Button tier="primary">Save pre-order</Button>
        <Button tier="tertiary">Not now</Button>
      </Dock>
    </Demo>
  );
}

/* ── Text & reveals ─────────────────────────────────────────────────────── */
function TextDemo() {
  return (
    <Demo title="Type & reveals" note="One text hero per moment; splits revert after the reveal.">
      <Reveal kind="kicker" as="p" className="kicker">Vetted founders, real pre-orders</Reveal>
      <Reveal kind="headline" as="h1" className="hero">Prove it before you build it</Reveal>
      <Reveal kind="lede" as="p" className="lede">
        Backers save a card and are charged later, under one disclosed rule.
      </Reveal>
    </Demo>
  );
}

/* ── Buttons ────────────────────────────────────────────────────────────── */
function ButtonsDemo() {
  const withProgress = useButtonProgress();
  const payRef = useRef<HTMLButtonElement>(null);
  return (
    <Demo title="Buttons — three tiers" note="Adjacent actions descend the tiers — never two of the same, side by side.">
      <div className="gx-row">
        <Button tier="primary">Primary</Button>
        <Button tier="secondary">Secondary</Button>
        <Button tier="tertiary">Tertiary</Button>
      </div>
      <div className="gx-row">
        <Button tier="primary">Save pre-order</Button>
        <Button tier="tertiary">Cancel</Button>
      </div>
      <div className="gx-row">
        <Button tier="primary" small>Small</Button>
        <Button tier="primary" disabled>Disabled</Button>
        <Button tier="secondary" href="#gallery">Link button</Button>
      </div>
      <div className="gx-row">
        <button
          ref={payRef}
          type="button"
          className="btn btn--primary"
          onClick={() =>
            withProgress(payRef, () => new Promise((r) => setTimeout(r, 1400)))
          }
        >
          <span className="btn__label">Authorize pre-order</span>
        </button>
      </div>
    </Demo>
  );
}

/* ── Inputs ─────────────────────────────────────────────────────────────── */
function InputsDemo() {
  return (
    <Demo title="Inputs & fields" note="The only grey-bordered tappable. Never a silent box.">
      <div className="gx-stack">
        <Field label="Legal name" hint="As it appears on your ID.">
          <Input placeholder="Ada Lovelace" autoComplete="name" />
        </Field>
        <Field
          label="Payout email"
          error="Enter an email so payouts can reach you."
        >
          <Input type="email" placeholder="you@studio.com" defaultValue="not-an-email" />
        </Field>
        <Field label="What are you making?">
          <Textarea placeholder="One or two sentences." />
        </Field>
        <Input hero placeholder="Hero input" aria-label="Hero input" />
      </div>
    </Demo>
  );
}

/* ── Toggle ─────────────────────────────────────────────────────────────── */
function ToggleDemo() {
  return (
    <Demo title="Toggle" note="Sits bare with its label — never inside a bordered card. The square knob travels.">
      <div className="gx-stack">
        <Toggle label="Email me before every charge" defaultChecked sub="You can turn this off any time." />
        <Toggle label="Show test controls" />
        <Toggle label="Unavailable" disabled />
      </div>
    </Demo>
  );
}

/* ── Option / checkbox ──────────────────────────────────────────────────── */
function OptionDemo() {
  const [a, setA] = useState(true);
  const [b, setB] = useState(false);
  const [c, setC] = useState(false);
  return (
    <Demo title="Checkbox / option" note="Off: grey border. On: brand border, 5% fill, a drawn check.">
      <div className="gx-stack">
        <Option label="Charge when the idea is proven" checked={a} onCheckedChange={setA} />
        <Option label="Charge at the close date" checked={b} onCheckedChange={setB} />
        <Option label="Notify my creators" checked={c} onCheckedChange={setC} />
      </div>
    </Demo>
  );
}

/* ── Stepper ────────────────────────────────────────────────────────────── */
function StepperDemo() {
  const [qty, setQty] = useState(2);
  return (
    <Demo title="Stepper" note="The number is the container. No outer box.">
      <Stepper value={qty} onValueChange={setQty} label="quantity" min={1} max={9} />
    </Demo>
  );
}

/* ── Tag ────────────────────────────────────────────────────────────────── */
function TagDemo() {
  return (
    <Demo title="Tags" note="Live/action keeps the brand ring; quiet info tags are filled, no ring.">
      <div className="gx-row">
        <Tag variant="live">Matching…</Tag>
        <Tag>Idea campaign</Tag>
        <Tag variant="sage">Peak was Tuesday</Tag>
        <Tag variant="moss">Draft</Tag>
        <Tag variant="mint">Paid</Tag>
      </div>
    </Demo>
  );
}

/* ── Card + Stat ────────────────────────────────────────────────────────── */
function CardStatDemo() {
  const [n, setN] = useState(1240);
  const numRef = useRef<HTMLSpanElement>(null);
  const initial = useRef(n.toLocaleString()).current;
  useNumberRoll(numRef, n);
  return (
    <Demo title="Cards & stats" note="Cards are brand-ringed, never grey — metric containers only.">
      <GridAuto track="14rem">
        <Card white>
          <Stat variant="white" brandValue value={<span ref={numRef}>{initial}</span>} sub="backers so far" />
        </Card>
        <Stat variant="mint" value="US$48,200" sub="reserved" />
        <Stat variant="dark" value="5%" sub="Proovd fee" />
        <Stat variant="white" value="12 days" sub="until close" />
      </GridAuto>
      <div className="gx-row">
        <Button tier="secondary" onClick={() => setN((v) => v + 137)}>Add backers</Button>
      </div>
    </Demo>
  );
}

/* ── Link ───────────────────────────────────────────────────────────────── */
function LinkDemo() {
  return (
    <Demo title="Links" note="Section-mode ink, underline draws on hover.">
      <p>
        Read the <Link href="#terms">charge rule</Link>, or open the{' '}
        <Link href="https://stripe.com" external>seller agreement</Link>.
      </p>
    </Demo>
  );
}

/* ── Progress ───────────────────────────────────────────────────────────── */
function ProgressDemo() {
  const [p, setP] = useState(0.4);
  return (
    <Demo title="Progress" note="Always the bordered treatment. Nothing else, ever.">
      <div className="gx-stack">
        <Progress value={p} label="Reserved toward the idea threshold" />
        <div className="gx-row">
          <Button tier="secondary" small onClick={() => setP((v) => Math.max(0, v - 0.2))}>Less</Button>
          <Button tier="secondary" small onClick={() => setP((v) => Math.min(1, v + 0.2))}>More</Button>
        </div>
      </div>
    </Demo>
  );
}

/* ── Copylink ───────────────────────────────────────────────────────────── */
function CopylinkDemo() {
  return (
    <Demo title="Copy link" note="One-click copy with confirmation.">
      <Copylink url="https://app.proovd.co/c/sample-pre-launch/aurora" display="app.proovd.co/c/aurora" />
    </Demo>
  );
}

/* ── Stickers ───────────────────────────────────────────────────────────── */
function StickerDemo() {
  return (
    <Demo title="Stickers & placeholders" note="Rectangle-in-rectangle. Pick a number, not a colour.">
      <GridAuto track="6rem" data-grid>
        {Array.from({ length: 14 }, (_, i) => (
          <span key={i} className={`sticker sk-${i + 1}`} aria-hidden="true" />
        ))}
      </GridAuto>
    </Demo>
  );
}

/* ── Tabs ───────────────────────────────────────────────────────────────── */
function TabsDemo() {
  return (
    <Demo title="Tabs">
      <Tabs
        label="Campaign views"
        items={[
          { value: 'glance', label: 'Glance', content: <p>What changed since you were last here.</p> },
          { value: 'backers', label: 'Backers', content: <p>Everyone who reserved, and when they’re charged.</p> },
          { value: 'creators', label: 'Creators', content: <p>Who’s promoting, and how they’re paid.</p> },
        ]}
      />
    </Demo>
  );
}

/* ── Accordion ──────────────────────────────────────────────────────────── */
function AccordionDemo() {
  return (
    <Demo title="Accordion">
      <Accordion
        defaultValue="q1"
        items={[
          { value: 'q1', head: 'When am I charged?', body: <p>Only when the disclosed rule is met — never before.</p> },
          { value: 'q2', head: 'Can I cancel?', body: <p>Yes, any time before the charge decision, from your secure link.</p> },
          { value: 'q3', head: 'Who is the seller?', body: <p>The founder running the campaign, named on your receipt.</p> },
        ]}
      />
    </Demo>
  );
}

/* ── Menu ───────────────────────────────────────────────────────────────── */
function MenuDemo() {
  const toast = useToast();
  return (
    <Demo title="Menu">
      <Menu
        label="Campaign actions"
        trigger={<Button tier="secondary">Actions</Button>}
        items={[
          { label: 'Share campaign', onSelect: () => toast('Shared') },
          { label: 'Edit details', onSelect: () => toast('Editing') },
          { label: 'Pause (unavailable)', onSelect: () => {}, disabled: true },
        ]}
      />
    </Demo>
  );
}

/* ── Modal + Drawer ─────────────────────────────────────────────────────── */
function OverlayDemo() {
  return (
    <Demo title="Modal & Drawer" note="Modal grows from its trigger; the drawer is the Explore surface.">
      <div className="gx-row">
        <Modal
          title="Cancel this pre-order?"
          description="You won’t be charged. This can’t be undone."
          trigger={<Button tier="secondary">Open modal</Button>}
          closeLabel="Keep it"
        >
          <p>Your saved card is removed and your reservation is released.</p>
        </Modal>
        <Drawer title="Explore" trigger={<Button tier="secondary">Open drawer</Button>}>
          <nav>
            <button className="tab is-active" type="button">Overview</button>
            <button className="tab" type="button">Backers</button>
            <button className="tab" type="button">Payments</button>
            <button className="tab" type="button">History</button>
          </nav>
        </Drawer>
      </div>
    </Demo>
  );
}

/* ── Toast ──────────────────────────────────────────────────────────────── */
function ToastDemo() {
  const toast = useToast();
  return (
    <Demo title="Toast" note="Imperative only. An immediate confirmation — never the durable record.">
      <div className="gx-row">
        <Button tier="secondary" onClick={() => toast('Pre-order saved', { sub: 'You were not charged.' })}>
          Fire toast
        </Button>
        <Button tier="tertiary" onClick={() => toast('Heads up', { accent: 'yellow' })}>
          Accent toast
        </Button>
      </div>
    </Demo>
  );
}

/* ── StatePanel ─────────────────────────────────────────────────────────── */
function StatePanelDemo() {
  const toast = useToast();
  return (
    <Demo title="StatePanel — the six-question pattern" note="Every waiting / review / payment / recovery state answers all six.">
      <Cols>
        <StatePanel
          state="We’re reviewing your campaign."
          whatHappened="You submitted your campaign for review."
          next="A human checks it against the eligibility rules."
          owner="Proovd"
          nextUpdate={new Date(Date.now() + 2 * 24 * 3600 * 1000)}
          action="No action needed"
          reference="CMP-4821"
          getHelp={{ onClick: () => toast('Support, with your campaign attached') }}
        />
        <StatePanel
          ring
          state="Your card needs a quick fix."
          whatHappened="The card on file was declined at the charge decision."
          next="Update it and we’ll retry once."
          owner="You"
          nextUpdate="Before Friday 9:00pm"
          action={<Button tier="primary">Update card</Button>}
          reference="RES-90-2231"
          getHelp={{ onClick: () => toast('Support, with your reservation attached') }}
        />
      </Cols>
    </Demo>
  );
}

/* ── Flow ───────────────────────────────────────────────────────────────── */
function FlowDemo() {
  const [name, setName] = useState('');
  const [rule, setRule] = useState<'idea' | 'close'>('idea');
  const [notify, setNotify] = useState(true);
  const toast = useToast();
  return (
    <Demo title="Flow — one thing per screen" note="Finite, animated, every step reachable; ends on a done-moment.">
      <Flow
        persistKey="gallery-demo"
        confirmLabel="Publish campaign"
        done={{ title: 'Published. It’s live.', body: 'First backers usually arrive within a day — check back tomorrow.' }}
        onComplete={() => toast('Campaign published')}
        steps={[
          {
            id: 'name',
            label: 'Name',
            title: 'What’s the campaign called?',
            canAdvance: name.trim().length > 0,
            summary: name || '—',
            content: (
              <Field label="Campaign name">
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Aurora Desk Lamp" />
              </Field>
            ),
          },
          {
            id: 'rule',
            label: 'Charge rule',
            title: 'When should backers be charged?',
            summary: rule === 'idea' ? 'When the idea is proven' : 'At the close date',
            content: (
              <div className="gx-stack">
                <Option label="When the idea is proven" checked={rule === 'idea'} onCheckedChange={() => setRule('idea')} />
                <Option label="At the close date" checked={rule === 'close'} onCheckedChange={() => setRule('close')} />
              </div>
            ),
          },
          {
            id: 'notify',
            label: 'Creators',
            title: 'Tell your creators it’s live?',
            summary: notify ? 'Notify creators' : 'Stay quiet',
            content: <Toggle label="Notify my creators" checked={notify} onCheckedChange={setNotify} />,
          },
        ]}
      />
    </Demo>
  );
}

/* ── Scaffold ───────────────────────────────────────────────────────────── */
function ScaffoldDemo() {
  return (
    <Demo title="Glance / Act / Explore" note="Glance + Act is the landing; Explore is one gesture away.">
      <Scaffold
        glance={
          <>
            <p className="kicker">Since yesterday</p>
            <p className="num">3</p>
            <p>creators are waiting on your decision.</p>
          </>
        }
        act={
          <>
            <p>Review the first one — it takes about a minute.</p>
            <Button tier="primary">Review creator</Button>
          </>
        }
        explore={
          <Tabs
            label="Everything"
            items={[
              { value: 'all', label: 'All creators', content: <p>The full roster, filterable.</p> },
              { value: 'paid', label: 'Payments', content: <p>Every payout and its status.</p> },
            ]}
          />
        }
      />
    </Demo>
  );
}
