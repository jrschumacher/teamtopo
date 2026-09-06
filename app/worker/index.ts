import { handleDocs } from './docs';
import { handleSubscribe } from './subscribe';
import { error } from './http';

export interface Env {
	DOCS: R2Bucket;
	DB: D1Database;
	WRITE_LIMIT: RateLimit;
	EMAIL?: SendEmail;
	EMAIL_FROM: string;
}

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const url = new URL(request.url);
		if (url.pathname.startsWith('/api/docs')) return handleDocs(request, env, ctx, url);
		if (url.pathname.startsWith('/api/subscribe')) return handleSubscribe(request, env, ctx, url);
		return error('not_found', 'no such route', 404);
	}
} satisfies ExportedHandler<Env>;
