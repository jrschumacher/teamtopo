/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

const TOKEN = 'test-write-token-abc123';
const WRONG_TOKEN = 'wrong-token-xyz789';

function authHeaders(token: string) {
	return { authorization: `Bearer ${token}` };
}

async function createDoc(payload: string, token = TOKEN) {
	return SELF.fetch('https://example.com/api/docs', {
		method: 'POST',
		headers: { 'content-type': 'application/json', ...authHeaders(token) },
		body: JSON.stringify({ payload })
	});
}

describe('docs API', () => {
	it('creates a document and round-trips it through GET', async () => {
		const created = await createDoc('hello world');
		expect(created.status).toBe(201);
		expect(created.headers.get('cache-control')).toBe('no-store');
		const createdBody = (await created.json()) as { id: string; version: { id: string } };
		expect(createdBody.id).toMatch(/^[0-9a-f-]{36}$/i);
		expect(createdBody.version.id).toMatch(/^\d{14}-[0-9a-z]{4}$/);

		const got = await SELF.fetch(`https://example.com/api/docs/${createdBody.id}`);
		expect(got.status).toBe(200);
		const gotBody = (await got.json()) as {
			id: string;
			version: unknown;
			versions: unknown[];
			payload: string;
		};
		expect(gotBody.id).toBe(createdBody.id);
		expect(gotBody.payload).toBe('hello world');
		expect(gotBody.versions).toHaveLength(1);
		expect(JSON.stringify(gotBody)).not.toMatch(/tokenHash/);
	});

	it('returns 404 for an unknown document id', async () => {
		const res = await SELF.fetch(
			'https://example.com/api/docs/00000000-0000-0000-0000-000000000000'
		);
		expect(res.status).toBe(404);
		expect(await res.json()).toMatchObject({ error: 'not_found' });
	});

	it('rejects PUT without a bearer token with 401', async () => {
		const created = await createDoc('v1');
		const { id } = (await created.json()) as { id: string };

		const res = await SELF.fetch(`https://example.com/api/docs/${id}`, {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ payload: 'v2', base: 'whatever' })
		});
		expect(res.status).toBe(401);
	});

	it('rejects PUT with the wrong bearer token with 401', async () => {
		const created = await createDoc('v1');
		const { id } = (await created.json()) as { id: string };

		const res = await SELF.fetch(`https://example.com/api/docs/${id}`, {
			method: 'PUT',
			headers: { 'content-type': 'application/json', ...authHeaders(WRONG_TOKEN) },
			body: JSON.stringify({ payload: 'v2', base: 'whatever' })
		});
		expect(res.status).toBe(401);
	});

	it('rejects PUT with a stale base with 409 and reports latest', async () => {
		const created = await createDoc('v1');
		const { id, version } = (await created.json()) as { id: string; version: { id: string } };

		const res = await SELF.fetch(`https://example.com/api/docs/${id}`, {
			method: 'PUT',
			headers: { 'content-type': 'application/json', ...authHeaders(TOKEN) },
			body: JSON.stringify({ payload: 'v2', base: 'not-the-real-base' })
		});
		expect(res.status).toBe(409);
		const body = (await res.json()) as { error: string; latest: { id: string } };
		expect(body.error).toBe('stale');
		expect(body.latest.id).toBe(version.id);
	});

	it('accepts a valid PUT, lists the new version first, and GET returns the new payload', async () => {
		const created = await createDoc('v1');
		const { id, version: v1 } = (await created.json()) as {
			id: string;
			version: { id: string };
		};

		const put = await SELF.fetch(`https://example.com/api/docs/${id}`, {
			method: 'PUT',
			headers: { 'content-type': 'application/json', ...authHeaders(TOKEN) },
			body: JSON.stringify({ payload: 'v2', base: v1.id })
		});
		expect(put.status).toBe(200);
		const putBody = (await put.json()) as { id: string; version: { id: string } };
		expect(putBody.version.id).not.toBe(v1.id);

		const got = await SELF.fetch(`https://example.com/api/docs/${id}`);
		const gotBody = (await got.json()) as {
			payload: string;
			versions: { id: string }[];
		};
		expect(gotBody.payload).toBe('v2');
		expect(gotBody.versions[0].id).toBe(putBody.version.id);
		expect(gotBody.versions[1].id).toBe(v1.id);

		const oldVersion = await SELF.fetch(`https://example.com/api/docs/${id}/versions/${v1.id}`);
		expect(oldVersion.status).toBe(200);
		const oldBody = (await oldVersion.json()) as { payload: string };
		expect(oldBody.payload).toBe('v1');
	});

	it('rejects an oversize payload with 413', async () => {
		const big = 'x'.repeat(262145);
		const res = await createDoc(big);
		expect(res.status).toBe(413);
	});

	it('rejects malformed JSON with 400', async () => {
		const res = await SELF.fetch('https://example.com/api/docs', {
			method: 'POST',
			headers: { 'content-type': 'application/json', ...authHeaders(TOKEN) },
			body: '{not json'
		});
		expect(res.status).toBe(400);
	});

	it('never leaks tokenHash in any response body', async () => {
		const created = await createDoc('secret-check');
		const createdBody = (await created.json()) as { id: string; version: { id: string } };
		expect(JSON.stringify(createdBody)).not.toMatch(/tokenHash/);

		const got = await SELF.fetch(`https://example.com/api/docs/${createdBody.id}`);
		expect(JSON.stringify(await got.json())).not.toMatch(/tokenHash/);

		const put = await SELF.fetch(`https://example.com/api/docs/${createdBody.id}`, {
			method: 'PUT',
			headers: { 'content-type': 'application/json', ...authHeaders(TOKEN) },
			body: JSON.stringify({ payload: 'updated', base: createdBody.version.id })
		});
		expect(JSON.stringify(await put.json())).not.toMatch(/tokenHash/);

		const version = await SELF.fetch(
			`https://example.com/api/docs/${createdBody.id}/versions/${createdBody.version.id}`
		);
		expect(JSON.stringify(await version.json())).not.toMatch(/tokenHash/);
	});
});
