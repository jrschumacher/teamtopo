import { handleDocs } from './docs';
import { handleSubscribe } from './subscribe';
import { error } from './http';

export interface Env {
	DOCS: R2Bucket;
	DB: D1Database;
	WRITE_LIMIT: RateLimit;
	EMAIL?: SendEmail;
	EMAIL_FROM: string;
	/** Workers Analytics Engine dataset for usage events (worker/analytics.ts). Optional so a
	 * config without the binding degrades to no analytics rather than a crash. */
	ANALYTICS?: AnalyticsEngineDataset;
	/** Set to "preview" only in wrangler.jsonc's env.preview. Never set in the top-level
	 * (production) config — see the fail-closed guard in `fetch` below. */
	STAGE?: string;
}

// Hostnames that only ever serve production traffic. A preview-tagged version (env.preview,
// bound to the disposable preview D1/R2) must never answer for one of these — see the
// promotion-door rules in wrangler.jsonc's env.preview comment block.
const PRODUCTION_HOSTNAMES = ['teamtopo.abnl.workers.dev'];

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const url = new URL(request.url);

		// Fail-closed guard: a preview version (STAGE=preview) must never serve the production
		// hostname. This is a backstop against the four promotion doors documented in
		// wrangler.jsonc, not the isolation mechanism itself — it refuses before any binding is
		// touched, so its worst failure is availability, never writing production data.
		if (env.STAGE === 'preview' && PRODUCTION_HOSTNAMES.includes(url.hostname)) {
			return error(
				'preview_on_production_host',
				'preview build refused on production hostname',
				503
			);
		}

		if (url.pathname.startsWith('/api/docs')) return handleDocs(request, env, ctx, url);
		if (url.pathname.startsWith('/api/subscribe')) return handleSubscribe(request, env, ctx, url);
		return error('not_found', 'no such route', 404);
	}
} satisfies ExportedHandler<Env>;
