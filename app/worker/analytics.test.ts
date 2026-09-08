/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { createExecutionContext, env as rawEnv, waitOnExecutionContext } from 'cloudflare:test';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import worker from './index';
import type { Env } from './index';
import { ROUTES, toDataPoint, track } from './analytics';

// See subscribe.test.ts for why `cloudflare:test`'s env is cast to this project's Env.
const env = rawEnv as unknown as Env;

beforeAll(async () => {
	await env.DB.exec(
		'CREATE TABLE IF NOT EXISTS subscribers (email TEXT PRIMARY KEY, token TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, confirmed_at TEXT, unsubscribed_at TEXT)'
	);
});

interface FakeCtx {
	ctx: ExecutionContext;
	settled: () => Promise<void>;
}

function fakeCtx(): FakeCtx {
	const pending: Promise<unknown>[] = [];
	const ctx = {
		waitUntil: (p: Promise<unknown>) => void pending.push(p),
		passThroughOnException: () => undefined,
		props: {}
	} as unknown as ExecutionContext;
	return { ctx, settled: async () => void (await Promise.all(pending)) };
}

function fakeDataset(impl?: () => void) {
	return { writeDataPoint: vi.fn(impl ?? (() => undefined)) } as unknown as AnalyticsEngineDataset;
}

describe('toDataPoint', () => {
	it('lays out type/id/route as blobs and bytes/versions as doubles, indexed by type', () => {
		expect(
			toDataPoint({
				type: 'doc_save',
				route: ROUTES.doc,
				docId: 'abc',
				payloadBytes: 1234,
				versionCount: 7
			})
		).toEqual({
			indexes: ['doc_save'],
			blobs: ['doc_save', 'abc', '/api/docs/:id'],
			doubles: [1234, 7]
		});
	});

	it('fills absent fields with empty string and zero so column positions stay stable', () => {
		expect(toDataPoint({ type: 'subscribe', route: ROUTES.subscribe })).toEqual({
			indexes: ['subscribe'],
			blobs: ['subscribe', '', '/api/subscribe'],
			doubles: [0, 0]
		});
	});
});

describe('track', () => {
	it('writes the data point through ctx.waitUntil', async () => {
		const ANALYTICS = fakeDataset();
		const { ctx, settled } = fakeCtx();
		track({ ANALYTICS }, ctx, { type: 'doc_view', route: ROUTES.doc, docId: 'x' });
		await settled();
		expect(ANALYTICS.writeDataPoint).toHaveBeenCalledTimes(1);
		expect(ANALYTICS.writeDataPoint).toHaveBeenCalledWith({
			indexes: ['doc_view'],
			blobs: ['doc_view', 'x', '/api/docs/:id'],
			doubles: [0, 0]
		});
	});

	it('is a no-op without a binding', async () => {
		const { ctx, settled } = fakeCtx();
		expect(() => track({}, ctx, { type: 'doc_view', route: ROUTES.doc })).not.toThrow();
		await settled();
	});

	it('never throws or rejects when the binding fails', async () => {
		const ANALYTICS = fakeDataset(() => {
			throw new Error('analytics down');
		});
		const { ctx, settled } = fakeCtx();
		expect(() =>
			track({ ANALYTICS }, ctx, { type: 'doc_create', route: ROUTES.docs, docId: 'x' })
		).not.toThrow();
		await expect(settled()).resolves.toBeUndefined();
		expect(ANALYTICS.writeDataPoint).toHaveBeenCalledTimes(1);
	});

	it('never throws when waitUntil itself throws', () => {
		const ANALYTICS = fakeDataset();
		const ctx = {
			waitUntil: () => {
				throw new Error('no request scope');
			}
		} as unknown as ExecutionContext;
		expect(() => track({ ANALYTICS }, ctx, { type: 'doc_view', route: ROUTES.doc })).not.toThrow();
	});
});

describe('request path events', () => {
	type Req = Request<unknown, IncomingRequestCfProperties>;

	async function run(ANALYTICS: AnalyticsEngineDataset, request: Request) {
		const ctx = createExecutionContext();
		const res = await worker.fetch(request as Req, { ...rawEnv, ANALYTICS } as unknown as Env, ctx);
		await waitOnExecutionContext(ctx);
		return res;
	}

	function blobs(dataset: AnalyticsEngineDataset, call = 0): unknown[] {
		const mock = dataset.writeDataPoint as unknown as ReturnType<typeof vi.fn>;
		return (mock.mock.calls[call][0] as AnalyticsEngineDataPoint).blobs ?? [];
	}

	function doubles(dataset: AnalyticsEngineDataset, call = 0): number[] {
		const mock = dataset.writeDataPoint as unknown as ReturnType<typeof vi.fn>;
		return (mock.mock.calls[call][0] as AnalyticsEngineDataPoint).doubles ?? [];
	}

	it('records doc_create, doc_view, team_view, version_view and doc_save with no PII', async () => {
		const ANALYTICS = fakeDataset();
		const headers = {
			'content-type': 'application/json',
			authorization: 'Bearer tok',
			'user-agent': 'SecretAgent/1.0',
			'cf-connecting-ip': '203.0.113.9'
		};

		const created = await run(
			ANALYTICS,
			new Request('https://example.com/api/docs', {
				method: 'POST',
				headers,
				body: JSON.stringify({ payload: 'hello' })
			})
		);
		expect(created.status).toBe(201);
		const { id, version } = (await created.json()) as { id: string; version: { id: string } };
		expect(blobs(ANALYTICS, 0)).toEqual(['doc_create', id, '/api/docs']);
		expect(doubles(ANALYTICS, 0)).toEqual([5, 1]);

		await run(ANALYTICS, new Request(`https://example.com/api/docs/${id}`));
		expect(blobs(ANALYTICS, 1)).toEqual(['doc_view', id, '/api/docs/:id']);

		await run(ANALYTICS, new Request(`https://example.com/api/docs/${id}?view=team`));
		expect(blobs(ANALYTICS, 2)).toEqual(['team_view', id, '/api/docs/:id']);

		await run(ANALYTICS, new Request(`https://example.com/api/docs/${id}/versions/${version.id}`));
		expect(blobs(ANALYTICS, 3)).toEqual(['version_view', id, '/api/docs/:id/versions/:vid']);

		const saved = await run(
			ANALYTICS,
			new Request(`https://example.com/api/docs/${id}`, {
				method: 'PUT',
				headers,
				body: JSON.stringify({ payload: 'hello again', base: version.id })
			})
		);
		expect(saved.status).toBe(200);
		expect(blobs(ANALYTICS, 4)).toEqual(['doc_save', id, '/api/docs/:id']);
		expect(doubles(ANALYTICS, 4)).toEqual([11, 2]);

		const everything = JSON.stringify(
			(ANALYTICS.writeDataPoint as unknown as ReturnType<typeof vi.fn>).mock.calls
		);
		expect(everything).not.toContain('203.0.113.9');
		expect(everything).not.toContain('SecretAgent');
		expect(everything).not.toContain('tok');
	});

	it('records subscribe and subscribe_confirm without the email address', async () => {
		const ANALYTICS = fakeDataset();
		const email = 'analytics-signup@example.com';

		const res = await run(
			ANALYTICS,
			new Request('https://example.com/api/subscribe', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ email })
			})
		);
		expect(res.status).toBe(202);
		expect(blobs(ANALYTICS, 0)).toEqual(['subscribe', '', '/api/subscribe']);

		const row = await env.DB.prepare('SELECT token FROM subscribers WHERE email = ?')
			.bind(email)
			.first<{ token: string }>();
		const confirm = await run(
			ANALYTICS,
			new Request(
				`https://example.com/api/subscribe/confirm?t=${encodeURIComponent(row?.token ?? '')}`,
				{ redirect: 'manual' }
			)
		);
		expect(confirm.status).toBe(303);
		expect(blobs(ANALYTICS, 1)).toEqual(['subscribe_confirm', '', '/api/subscribe/confirm']);

		const everything = JSON.stringify(
			(ANALYTICS.writeDataPoint as unknown as ReturnType<typeof vi.fn>).mock.calls
		);
		expect(everything).not.toContain(email);
	});

	it('does not count a repeat signup from an already confirmed address', async () => {
		const ANALYTICS = fakeDataset();
		const email = 'analytics-repeat@example.com';
		await env.DB.prepare(
			'INSERT INTO subscribers (email, token, created_at, confirmed_at) VALUES (?, ?, ?, ?)'
		)
			.bind(email, 'repeat-token', new Date().toISOString(), new Date().toISOString())
			.run();

		const res = await run(
			ANALYTICS,
			new Request('https://example.com/api/subscribe', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ email })
			})
		);
		expect(res.status).toBe(202);
		expect(ANALYTICS.writeDataPoint).not.toHaveBeenCalled();
	});

	it('still serves the request when the binding throws', async () => {
		const ANALYTICS = fakeDataset(() => {
			throw new Error('analytics down');
		});
		const res = await run(
			ANALYTICS,
			new Request('https://example.com/api/docs', {
				method: 'POST',
				headers: { 'content-type': 'application/json', authorization: 'Bearer tok' },
				body: JSON.stringify({ payload: 'hello' })
			})
		);
		expect(res.status).toBe(201);
	});
});
