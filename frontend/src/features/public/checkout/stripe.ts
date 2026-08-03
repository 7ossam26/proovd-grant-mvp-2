/**
 * Stripe.js in test mode — the card field's placeholder until Stripe is fully
 * set up (Spec §28.3, §34).
 *
 * ── Loaded, not bundled ─────────────────────────────────────────────────────
 * Stripe requires its own script to be loaded from js.stripe.com for PCI scope
 * (the card fields are Stripe-hosted iframes, so raw card data never touches
 * Proovd's DOM — §28.3). We load it from the CDN on demand, the way GSAP is
 * vendored rather than bundled, so there is no `@stripe/stripe-js` dependency to
 * add before the integration is real.
 *
 * ── It refuses loudly when unconfigured ─────────────────────────────────────
 * `VITE_STRIPE_PUBLISHABLE_KEY` has no default (like every other Track-A input).
 * When it is absent the card step renders a plain "not available yet" state and
 * offers no card field — the `unconfigured*` posture the rest of the codebase
 * takes, applied to payments. A fake, inert card field would be worse than none
 * (§1.4). In test mode the key is a `pk_test_…` value and the card fields accept
 * Stripe's test cards (4242 4242 4242 4242, etc.).
 */

export const STRIPE_PUBLISHABLE_KEY: string | undefined = import.meta.env
  .VITE_STRIPE_PUBLISHABLE_KEY as string | undefined;

export function stripeConfigured(): boolean {
  return typeof STRIPE_PUBLISHABLE_KEY === 'string' && STRIPE_PUBLISHABLE_KEY.startsWith('pk_');
}

interface StripeGlobal {
  (key: string): StripeInstance;
}
interface StripeInstance {
  elements(): StripeElements;
  createPaymentMethod(input: {
    type: 'card';
    card: unknown;
    billing_details?: Record<string, unknown>;
  }): Promise<{ paymentMethod?: { id: string }; error?: { message?: string } }>;
}
interface StripeElements {
  create(type: 'card', options?: Record<string, unknown>): StripeCardElement;
}
export interface StripeCardElement {
  mount(node: HTMLElement): void;
  unmount(): void;
  on(event: string, handler: (e: { error?: { message?: string }; complete?: boolean }) => void): void;
}

let scriptPromise: Promise<StripeGlobal | null> | null = null;

/** Loads Stripe.js from the CDN once. Resolves null if the script cannot load. */
export async function loadStripeScript(): Promise<StripeGlobal | null> {
  if (typeof window === 'undefined') return null;
  const existing = (window as unknown as { Stripe?: StripeGlobal }).Stripe;
  if (existing) return existing;
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<StripeGlobal | null>((resolve) => {
    const script = document.createElement('script');
    script.src = 'https://js.stripe.com/v3/';
    script.async = true;
    script.onload = () => resolve((window as unknown as { Stripe?: StripeGlobal }).Stripe ?? null);
    script.onerror = () => resolve(null);
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export interface StripeCard {
  element: StripeCardElement;
  /** Creates a PaymentMethod from the entered card, in the Founder-account context. */
  createPaymentMethod(billing: Record<string, unknown>): Promise<
    { ok: true; paymentMethodId: string } | { ok: false; message: string }
  >;
}

/**
 * Mounts a Stripe card Element into `node` and returns a handle. Returns null
 * when Stripe is not configured or the script fails to load — the caller renders
 * the "not available yet" state.
 */
export async function mountCardElement(node: HTMLElement): Promise<StripeCard | null> {
  if (!stripeConfigured()) return null;
  const Stripe = await loadStripeScript();
  if (!Stripe) return null;

  const stripe = Stripe(STRIPE_PUBLISHABLE_KEY!);
  const elements = stripe.elements();
  const card = elements.create('card', { hidePostalCode: true });
  card.mount(node);

  return {
    element: card,
    async createPaymentMethod(billing) {
      const result = await stripe.createPaymentMethod({
        type: 'card',
        card,
        billing_details: billing,
      });
      if (result.error || !result.paymentMethod) {
        return { ok: false, message: result.error?.message ?? 'Please check your card details.' };
      }
      return { ok: true, paymentMethodId: result.paymentMethod.id };
    },
  };
}
