/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

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
