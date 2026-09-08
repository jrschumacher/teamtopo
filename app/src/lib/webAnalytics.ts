/**
 * Cloudflare Web Analytics beacon for the landing page (docs/analytics.md).
 *
 * Loaded from the landing view only, with `spa: false` so the beacon never hooks history
 * navigation and so never observes `/d/<id>` routes. (The beacon also strips the URL
 * fragment and query before sending, so the key-carrying `#k=` / `#s=` links would not
 * leave the browser either way — this is the second fence, not the only one.)
 */

const BEACON_SRC = 'https://static.cloudflareinsights.com/beacon.min.js';
const BEACON_ATTR = 'data-cf-beacon';

/** The site token from the build environment; `undefined` (no beacon) when unset or blank. */
export function webAnalyticsToken(): string | undefined {
	const token = import.meta.env.VITE_CF_WEB_ANALYTICS_TOKEN;
	const trimmed = typeof token === 'string' ? token.trim() : '';
	return trimmed || undefined;
}

/** Append the beacon once. Returns whether a script was added on this call. */
export function mountWebAnalytics(token: string | undefined, doc: Document = document): boolean {
	if (!token) return false;
	if (doc.querySelector(`script[${BEACON_ATTR}]`)) return false;
	const script = doc.createElement('script');
	script.defer = true;
	script.src = BEACON_SRC;
	script.setAttribute(BEACON_ATTR, JSON.stringify({ token, spa: false }));
	doc.head.appendChild(script);
	return true;
}
