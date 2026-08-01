/**
 * Where a raw token may legitimately appear in a URL, and how to erase it
 * again before anything writes that URL down.
 *
 * §28.1: the raw value exists only in the delivered URL — never at rest, never
 * in a log. A URL is exactly the thing infrastructure records by default:
 * access logs, error reports, Sentry breadcrumbs, browser history, referrer
 * headers. So the route shapes and the redaction rule live in one module, and
 * the logger and Sentry both read from here. Two copies of this list would
 * drift, and the drift would be invisible until a token showed up in a log.
 */

/** Founder invitation draft (§7). */
export const DRAFT_TOKEN_PATH = '/api/draft';

/** Backer campaign-scoped magic link (§19). */
export const MAGIC_LINK_TOKEN_PATH = '/api/link';

/** Private campaign-specific Affiliate invitation (§8, §11). */
export const AFFILIATE_INVITATION_TOKEN_PATH = '/api/affiliate-invitation';

/** The Express route parameter every token middleware reads. */
export const TOKEN_PARAM = 'token';

const TOKEN_BEARING_PREFIXES = [
  DRAFT_TOKEN_PATH,
  MAGIC_LINK_TOKEN_PATH,
  AFFILIATE_INVITATION_TOKEN_PATH,
] as const;

export const REDACTED = '[redacted]';

/**
 * Replaces the token segment of a token-bearing URL.
 *
 * Matches on the path prefix rather than on anything token-shaped: a rule that
 * tries to recognise a token by its characters will one day meet a token it
 * does not recognise, and that is the day one gets logged.
 */
export function redactTokenUrl(url: string): string {
  for (const prefix of TOKEN_BEARING_PREFIXES) {
    if (url === prefix || url.startsWith(`${prefix}/`)) {
      const rest = url.slice(prefix.length + 1);
      if (rest === '') return url;
      // Keep any sub-path after the token so the route stays recognisable.
      const slash = rest.indexOf('/');
      const query = rest.indexOf('?');
      const cut = [slash, query].filter((i) => i >= 0).sort((a, b) => a - b)[0];
      const tail = cut === undefined ? '' : rest.slice(cut);
      return `${prefix}/${REDACTED}${tail}`;
    }
  }
  return url;
}

/** True when this URL could carry a raw token. Used by the Sentry filter. */
export function isTokenBearingUrl(url: string): boolean {
  return TOKEN_BEARING_PREFIXES.some((p) => url === p || url.startsWith(`${p}/`));
}
