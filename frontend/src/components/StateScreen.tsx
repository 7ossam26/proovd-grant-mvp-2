import type { ReactNode } from 'react';
import { Link } from 'react-router';

interface StateScreenAction {
  href: string;
  label: string;
}

interface StateScreenProps {
  title: ReactNode;
  description: ReactNode;
  action?: StateScreenAction;
  artwork?: {
    src: string;
    alt: string;
  };
  helpHref?: string;
  children?: ReactNode;
}

/**
 * The minimal, full-screen language for public exception states.
 *
 * These screens deliberately sit outside the marketing shell: somebody who
 * has followed a broken address or a dead one-time link needs one calm answer
 * and one recovery action, not the complete site navigation and footer.
 */
export function StateScreen({
  title,
  description,
  action,
  artwork,
  helpHref = '/support',
  children,
}: StateScreenProps) {
  return (
    <div className={`state-screen${artwork ? ' state-screen--artwork' : ''}`}>
      <header className="state-screen__header">
        <Link className="state-screen__brand" to="/" aria-label="Go to the Proovd homepage">
          <img src="/assets/proovd-logo.svg" alt="" />
        </Link>
        <Link className="state-screen__help" to={helpHref}>
          Help
        </Link>
      </header>

      <main className="state-screen__main">
        {artwork ? (
          <img className="state-screen__artwork" src={artwork.src} alt={artwork.alt} />
        ) : null}
        <div className="state-screen__copy">
          <h1 className="state-screen__title">{title}</h1>
          <p className="state-screen__description">{description}</p>
          {action ? (
            <Link className="state-screen__action" to={action.href}>
              {action.label}
            </Link>
          ) : null}
        </div>
        {children}
      </main>
    </div>
  );
}
