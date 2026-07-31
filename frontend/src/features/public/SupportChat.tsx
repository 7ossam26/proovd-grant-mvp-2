/**
 * Tawk.to live chat, gated on staffed hours — Spec §31.4, §30.
 *
 * Outside staffed hours the widget does not render at all: not greyed out, not
 * "we're away", not a bubble that opens a form nobody reads. §31.4 is explicit
 * that unstaffed chat must never be promised, and the real commitment — the
 * one-business-day email SLA — is in the footer where it always is.
 *
 * The script is injected only while staffed, and the hour is rechecked on a
 * timer so a page left open past closing stops offering chat. Tawk's embed
 * cannot be unloaded cleanly once it has booted, so closing hides it through
 * Tawk's own API; the injected tag is left in place rather than torn out from
 * under a live third-party script.
 */

import { useEffect, useState } from 'react';
import { isStaffed, readSupportChatConfig } from './support-hours.js';

declare global {
  interface Window {
    Tawk_API?: {
      hideWidget?: () => void;
      showWidget?: () => void;
    };
    Tawk_LoadStart?: Date;
  }
}

const RECHECK_MS = 60_000;
const SCRIPT_ID = 'proovd-tawk';

/**
 * No default anywhere. §31.4 names the setting and fixes no hours, so an
 * unconfigured deployment has no chat — the same fail-closed shape §6's
 * reauthentication window uses on the backend.
 */
const config = readSupportChatConfig({
  propertyId: import.meta.env.VITE_TAWK_PROPERTY_ID,
  widgetId: import.meta.env.VITE_TAWK_WIDGET_ID,
  timeZone: import.meta.env.VITE_SUPPORT_CHAT_TIMEZONE,
  hours: import.meta.env.VITE_SUPPORT_CHAT_HOURS,
});

export function SupportChat() {
  const [staffed, setStaffed] = useState(() => (config ? isStaffed(new Date(), config) : false));

  useEffect(() => {
    if (!config) return;
    const tick = () => setStaffed(isStaffed(new Date(), config));
    tick();
    const timer = window.setInterval(tick, RECHECK_MS);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!config) return;

    if (!staffed) {
      window.Tawk_API?.hideWidget?.();
      return;
    }

    if (document.getElementById(SCRIPT_ID)) {
      window.Tawk_API?.showWidget?.();
      return;
    }

    window.Tawk_API = window.Tawk_API ?? {};
    window.Tawk_LoadStart = new Date();

    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.async = true;
    script.src = `https://embed.tawk.to/${config.propertyId}/${config.widgetId}`;
    script.charset = 'UTF-8';
    script.setAttribute('crossorigin', '*');
    document.body.appendChild(script);
  }, [staffed]);

  // The widget is the third-party script's own DOM; this component renders no
  // markup of its own, so there is nothing to grey out when hours end.
  return null;
}
