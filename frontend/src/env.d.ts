/// <reference types="vite/client" />

/**
 * Frontend environment contract. Every name here is baked into the client
 * bundle at build time, so nothing secret may ever appear in this list
 * (tech-stack §16, Spec §28.2: "no sensitive value in logs, client bundles,
 * screenshots, email, or documentation"). A Tawk property/widget ID is a
 * public embed identifier, not a credential.
 *
 * All four support-chat values are optional and there is no default for any of
 * them — Spec §31.4 names staffed hours as a setting and fixes no number, so an
 * unconfigured deployment renders no chat at all rather than promising one.
 */
interface ImportMetaEnv {
  readonly VITE_TAWK_PROPERTY_ID?: string;
  readonly VITE_TAWK_WIDGET_ID?: string;
  /** IANA zone the staffed hours below are stated in, e.g. `America/New_York`. */
  readonly VITE_SUPPORT_CHAT_TIMEZONE?: string;
  /** Staffed window on a U.S. business day, `HH:MM-HH:MM`. */
  readonly VITE_SUPPORT_CHAT_HOURS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
