/**
 * Usage events for Workers Analytics Engine (docs/analytics.md).
 *
 * Every write is best-effort: deferred with `ctx.waitUntil`, wrapped so a failing or
 * missing binding can never fail or slow a request. Data points carry only the event type,
 * an opaque document id (content is encrypted client-side) and the route *pattern* — never
 * IPs, user agents, emails or concrete URLs.
 */
import type { Env } from './index';

export type UsageEventType =
	| 'doc_view'
	| 'doc_create'
	| 'doc_save'
	| 'version_view'
	| 'team_view'
	| 'subscribe'
	| 'subscribe_confirm';

export interface UsageEvent {
	type: UsageEventType;
	/** Route pattern from `ROUTES`, never a concrete path. */
	route: string;
	docId?: string;
	payloadBytes?: number;
	versionCount?: number;
}

/** Route patterns recorded in `blob3`; low-cardinality on purpose so GROUP BY stays cheap. */
export const ROUTES = {
	docs: '/api/docs',
	doc: '/api/docs/:id',
	version: '/api/docs/:id/versions/:vid',
	subscribe: '/api/subscribe',
	confirm: '/api/subscribe/confirm'
} as const;

/**
 * Column layout, which the canned queries depend on:
 *   index1  = event type (the sampling key)
 *   blob1   = event type, blob2 = document id or '', blob3 = route pattern
 *   double1 = payload bytes, double2 = version count (0 where not applicable)
 */
export function toDataPoint(event: UsageEvent): AnalyticsEngineDataPoint {
	return {
		indexes: [event.type],
		blobs: [event.type, event.docId ?? '', event.route],
		doubles: [event.payloadBytes ?? 0, event.versionCount ?? 0]
	};
}

export function track(env: Pick<Env, 'ANALYTICS'>, ctx: ExecutionContext, event: UsageEvent): void {
	const dataset = env.ANALYTICS;
	if (!dataset) return;
	try {
		ctx.waitUntil(
			Promise.resolve()
				.then(() => dataset.writeDataPoint(toDataPoint(event)))
				.catch(() => undefined)
		);
	} catch {
		// waitUntil itself can throw (e.g. outside a request scope); analytics never fails a request.
	}
}
