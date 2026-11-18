/**
 * taverns.js - URL helpers
 *
 * Every ID placed in a request path goes through `pathSegment`, so an ID that
 * comes from user input (a slash-command option, message text) can never change
 * which route a request is sent to.
 */

/**
 * Escape one URL path segment. Empty values, `.` and `..` are refused, because
 * they would point the request at a different route.
 */
export function pathSegment(value: string | number | bigint): string {
  if (value === undefined || value === null) {
    throw new TypeError(`Missing ID for a URL path (got ${value})`);
  }
  const segment = String(value);
  if (segment === '' || segment === '.' || segment === '..') {
    throw new TypeError(`Invalid ID for a URL path: ${JSON.stringify(segment)}`);
  }
  return encodeURIComponent(segment);
}

/**
 * Template tag that escapes every interpolated value as a path segment:
 * route`/taverns/${tavernId}/members/${userId}`.
 */
export function route(strings: TemplateStringsArray, ...values: Array<string | number | bigint>): string {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) {
    out += pathSegment(values[i]) + strings[i + 1];
  }
  return out;
}

/**
 * Check a custom API or gateway URL. The bot token travels with every request,
 * so only https:// (API) and wss:// (gateway) are accepted, unless
 * `allowInsecure` is set for local development.
 */
export function checkBaseUrl(
  url: string,
  kind: 'api' | 'gateway',
  allowInsecure = false,
): void {
  const secure = kind === 'api' ? 'https:' : 'wss:';
  const insecure = kind === 'api' ? 'http:' : 'ws:';
  const label = kind === 'api' ? 'The API URL' : 'The gateway URL';

  let protocol: string;
  try {
    protocol = new URL(url).protocol;
  } catch {
    throw new TypeError(`${label} is not a valid URL`);
  }

  if (protocol === secure) return;
  if (protocol === insecure) {
    if (allowInsecure) return;
    throw new Error(
      `${label} uses ${insecure}//, which would send the bot token unencrypted. ` +
        `Use ${secure}//, or pass allowInsecure: true for local development only.`,
    );
  }
  throw new Error(`${label} must start with ${secure}//`);
}
