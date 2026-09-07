/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { createExecutionContext, env as rawEnv, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from './index';
import type { Env } from './index';

describe('worker router', () => {
	it('returns 404 JSON for unknown /api routes', async () => {
		const res = await SELF.fetch('https://example.com/api/nope');
		expect(res.status).toBe(404);
		expect(res.headers.get('content-type')).toMatch(/application\/json/);
		expect(await res.json()).toMatchObject({ error: 'not_found' });
	});

	it('routes /api/docs and /api/subscribe to their handlers', async () => {
		const docs = await SELF.fetch('https://example.com/api/docs');
		const sub = await SELF.fetch('https://example.com/api/subscribe', { method: 'POST' });
		expect(docs.status).toBe(405);
		expect(sub.status).toBe(400);
	});
});

describe('STAGE guard', () => {
	it('refuses with 503 when STAGE=preview and the host is the production hostname', async () => {
		const ctx = createExecutionContext();
		const res = await worker.fetch(
			new Request('https://teamtopo.abnl.workers.dev/api/subscribe') as unknown as Request<
				unknown,
				IncomingRequestCfProperties
			>,
			{ ...rawEnv, STAGE: 'preview' } as unknown as Env,
			ctx
		);
		expect(res.status).toBe(503);
	});

	it('serves normally when STAGE=preview but the host is not production', async () => {
		const ctx = createExecutionContext();
		const res = await worker.fetch(
			new Request('https://preview.example.com/api/nope') as unknown as Request<
				unknown,
				IncomingRequestCfProperties
			>,
			{ ...rawEnv, STAGE: 'preview' } as unknown as Env,
			ctx
		);
		expect(res.status).toBe(404);
	});

	it('serves normally on the production hostname when STAGE is unset', async () => {
		const ctx = createExecutionContext();
		const res = await worker.fetch(
			new Request('https://teamtopo.abnl.workers.dev/api/nope') as unknown as Request<
				unknown,
				IncomingRequestCfProperties
			>,
			{ ...rawEnv } as unknown as Env,
			ctx
		);
		expect(res.status).toBe(404);
	});
});
