/**
 * The Founder's and Creator's notification settings — §27.7 (Phase 22c).
 *
 * §27.7: "Founder/Affiliate in settings." Before this there was no settings
 * surface for either role — every authenticated address in the product is
 * `:campaignId`- or `:associationId`-scoped, because everything a Founder or
 * Creator did until now belonged to one campaign. The digest preference is the
 * first thing that belongs to the *person*, so this is the first account-level
 * page, and it holds exactly what §27.7 puts there.
 *
 * ── It is not a general settings page ─────────────────────────────────────
 * One control and one record. There is no profile editor, no password panel,
 * no "preferences" section with invented switches beside the one the Spec
 * names — §1 rule 6, and the practical version of it: a settings page is where
 * options accumulate, and every one of them would be a rule nobody agreed to.
 * When a later phase has a second account-level setting, it joins this page.
 *
 * ── One component, both roles ─────────────────────────────────────────────
 * `PayoutOnboarding`'s arrangement, for its reason: the states are identical
 * and everything role-specific arrives from the server, so two components
 * would be two places for one sentence to drift.
 */

import { useCallback, useEffect, useState } from 'react';
import { Measure, NO_ACTION, Section, StatePanel } from '../../components/index.js';
import { SurfaceLoading, supportMailto } from '../../features/public/states.js';
import { DigestPreference, type DigestFrequency, type DigestPreferenceView } from './DigestPreference.js';
import { NotificationHistory, type HistoryEntry } from './NotificationHistory.js';
import {
  fetchDigestPreference,
  fetchNotificationHistory,
  saveDigestPreference,
  type NotificationsRole,
} from './api.js';

export interface NotificationSettingsProps {
  role: NotificationsRole;
}

export function NotificationSettings({ role }: NotificationSettingsProps) {
  const [preference, setPreference] = useState<DigestPreferenceView | null>(null);
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const [pref, history] = await Promise.all([
          fetchDigestPreference(role),
          fetchNotificationHistory(role),
        ]);
        if (!live) return;
        setPreference(pref);
        setEntries(history.entries);
        setCursor(history.nextCursor);
      } catch (error) {
        if (live) setFailure(error instanceof Error ? error.message : 'Something went wrong.');
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [role]);

  const save = useCallback(
    async (frequency: DigestFrequency) => {
      setPreference(await saveDigestPreference(role, frequency));
    },
    [role],
  );

  const loadMore = useCallback(async () => {
    if (!cursor) return;
    const next = await fetchNotificationHistory(role, cursor);
    setEntries((current) => [...current, ...next.entries]);
    setCursor(next.nextCursor);
  }, [role, cursor]);

  if (loading) {
    return <SurfaceLoading subject="your notification settings" reference="Your account" />;
  }

  if (failure || !preference) {
    return (
      <Section aria-labelledby="notification-settings-error">
        <Measure>
          <h1 className="h2" id="notification-settings-error">
            We could not load your notification settings
          </h1>
          {/* §33.11.7: all six of §27.1's questions, not just the one that
              matters most. The fact that matters most is still first: a failed
              read changed nothing about which emails you receive. */}
          <StatePanel
            state="We could not load your notification settings"
            whatHappened={`${failure ?? 'The server did not return your preference.'} Nothing about your emails has changed.`}
            next="Reload the page. Every transactional email — money, deadlines, your account — keeps arriving either way."
            owner="Proovd"
            nextUpdate="As soon as you reload"
            action={NO_ACTION}
            reference="Your notification settings"
            getHelp={{ href: supportMailto('Notification settings') }}
          />
        </Measure>
      </Section>
    );
  }

  return (
    <Section aria-labelledby="notification-settings-heading">
      <Measure>
        <h1 className="h2" id="notification-settings-heading">
          Notifications
        </h1>
        <DigestPreference preference={preference} onSave={save} />

        {/*
          History sits BELOW the one control, on its own page, and never on the
          campaign home — §27.7's own prohibition and DNA §5.2's. It renders no
          count and there is nothing here that marks anything read.
        */}
        <section aria-labelledby="notification-history-heading">
          <h2 className="h2" id="notification-history-heading">
            What we have sent you
          </h2>
          <NotificationHistory entries={entries} {...(cursor ? { onLoadMore: loadMore } : {})} />
        </section>
      </Measure>
    </Section>
  );
}

export function FounderNotificationSettings() {
  return <NotificationSettings role="founder" />;
}

export function CreatorNotificationSettings() {
  return <NotificationSettings role="creator" />;
}
