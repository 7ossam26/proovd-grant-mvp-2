/**
 * Resources — Creator Flow v2 **deviation 4**, Session F, 2026-08-20.
 *
 * Four things that do not exist, said plainly, plus a way to say you want one.
 *
 * §14.1's last line — *"All material lives in one Campaign kit. No separate
 * resource-library or education journey is required"* — stays true because of a
 * SEPARATION that is structural rather than a rule this page remembers: the
 * record behind it has a resource key, a subject, and a timestamp, and no
 * column that could hold an asset, a URL, a file, or a campaign id.
 *
 * So there is no download control anywhere, because there is no file. §1.4: a
 * control that does nothing is worse than no control, and a disabled one
 * invites somebody to work out how to enable it.
 *
 * Nothing chases anybody. §27 defines no resource key, there is no schedule
 * column, and no job reads the table — `RESOURCES_INTEREST_IS_RECORDED` says
 * so, and it is true because of what is absent rather than what is promised.
 */

import { useEffect, useState } from 'react';
import {
  CREATOR_RESOURCES,
  RESOURCES_ARE_NOT_THE_CAMPAIGN_KIT,
  RESOURCES_HAVE_NOTHING_TO_DOWNLOAD,
  RESOURCES_INTEREST_IS_RECORDED,
} from '@proovd/shared';
import { Button, Card, NO_ACTION, StatePanel } from '../../components/index.js';
import { supportMailto } from '../../features/public/states.js';
import {
  CreatorRequestError,
  fetchCreatorResources,
  recordResourceInterest,
} from '../creator/api.js';

export function CreatorResources() {
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'error'; title: string; message: string }
    | { status: 'ready'; interested: string[] }
  >({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { resources } = await fetchCreatorResources();
        if (!cancelled) setState({ status: 'ready', interested: resources.interested });
      } catch (caught) {
        if (cancelled) return;
        const detail = caught instanceof CreatorRequestError ? caught.detail : null;
        setState({
          status: 'error',
          title: detail?.title ?? 'This could not be loaded',
          message: detail?.whatHappened ?? 'Resources could not be loaded.',
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === 'loading') {
    return (
      <div className="cra-page">
        <StatePanel
          state="Loading"
          whatHappened="Proovd is checking what you have already asked about."
          next="It appears in a moment."
          owner="Proovd"
          nextUpdate="Within a few seconds"
          action={NO_ACTION}
          reference="Resources"
        />
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="cra-page">
        <StatePanel
          state={state.title}
          whatHappened={state.message}
          next="Nothing here is needed to run a campaign — everything for one is in its own kit."
          owner="Proovd"
          nextUpdate="No update pending"
          action={
            <Button tier="secondary" href="/creator/home">
              Back to your home
            </Button>
          }
          reference="Resources"
          getHelp={{ href: supportMailto('Resources') }}
        />
      </div>
    );
  }

  return (
    <div className="cra-page">
      <header className="cra-page__head">
        <h1>Guides we have not written yet</h1>
        <p className="cra-lede">{RESOURCES_ARE_NOT_THE_CAMPAIGN_KIT}</p>
      </header>

      {CREATOR_RESOURCES.map((resource) => (
        <ResourceTile
          key={resource.id}
          id={resource.id}
          label={resource.label}
          summary={resource.summary}
          notBuilt={resource.notBuilt}
          asked={state.interested.includes(resource.id)}
          onAsked={(interested) => setState({ status: 'ready', interested })}
        />
      ))}

      <Card>
        <h2>Nothing to download</h2>
        <p className="cra-help">{RESOURCES_HAVE_NOTHING_TO_DOWNLOAD}</p>
      </Card>
    </div>
  );
}

function ResourceTile({
  id,
  label,
  summary,
  notBuilt,
  asked,
  onAsked,
}: {
  id: string;
  label: string;
  summary: string;
  notBuilt: string;
  asked: boolean;
  onAsked: (interested: string[]) => void;
}) {
  const [busy, setBusy] = useState(false);

  return (
    <Card>
      <h2>{label}</h2>
      <p>{summary}</p>
      <p className="cra-help">{notBuilt}</p>
      {asked ? (
        <p className="cra-help" role="status">
          You have asked about this. {RESOURCES_INTEREST_IS_RECORDED}
        </p>
      ) : (
        <>
          <p className="cra-help">{RESOURCES_INTEREST_IS_RECORDED}</p>
          <Button
            tier="secondary"
            disabled={busy}
            onClick={() => {
              void (async () => {
                setBusy(true);
                try {
                  const { resources } = await recordResourceInterest(id);
                  onAsked(resources.interested);
                } finally {
                  setBusy(false);
                }
              })();
            }}
          >
            Tell Proovd I want {label.toLowerCase()}
          </Button>
        </>
      )}
    </Card>
  );
}
