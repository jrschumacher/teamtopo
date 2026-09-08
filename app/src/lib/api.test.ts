import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, createDoc, getDoc, getVersion, saveDoc } from './api';

const V = { id: '00000000000001-abcd', at: 1_700_000_000_000, size: 42 };
const V_ISO = { id: V.id, at: new Date(V.at).toISOString(), size: 42 };

function jsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});
}

describe('api', () => {
	const fetchMock = vi.fn<typeof fetch>();

	beforeEach(() => {
		vi.stubGlobal('fetch', fetchMock);
	});
	afterEach(() => {
		fetchMock.mockReset();
		vi.unstubAllGlobals();
	});

	it('createDoc POSTs the payload with a bearer token', async () => {
		fetchMock.mockResolvedValue(jsonResponse(201, { id: 'doc1', version: V }));
		const ref = await createDoc('{"v":1}', 'tok');
		expect(ref).toEqual({ id: 'doc1', version: V_ISO });
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('/api/docs');
		expect(init?.method).toBe('POST');
		expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tok');
		expect(JSON.parse(String(init?.body))).toEqual({ payload: '{"v":1}' });
	});

	it('getDoc marks team-page reads with ?view=team and nothing else', async () => {
		fetchMock.mockResolvedValue(
			jsonResponse(200, { id: 'doc1', version: V, versions: [V], payload: 'p' })
		);
		await getDoc('doc1');
		expect(fetchMock.mock.calls[0][0]).toBe('/api/docs/doc1');
		await getDoc('doc1', { view: 'team' });
		expect(fetchMock.mock.calls[1][0]).toBe('/api/docs/doc1?view=team');
		await getDoc('doc1', { background: true });
		expect(fetchMock.mock.calls[2][0]).toBe('/api/docs/doc1?background=1');
		await getDoc('doc1', { view: 'team', background: true });
		expect(fetchMock.mock.calls[3][0]).toBe('/api/docs/doc1?view=team&background=1');
	});

	it('getDoc returns versions newest first as given and normalizes timestamps', async () => {
		const older = { id: '00000000000000-zzzz', at: 1_600_000_000_000, size: 10 };
		fetchMock.mockResolvedValue(
			jsonResponse(200, { id: 'doc1', version: V, versions: [V, older], payload: 'p' })
		);
		const doc = await getDoc('doc 1');
		expect(fetchMock.mock.calls[0][0]).toBe('/api/docs/doc%201');
		expect(doc.payload).toBe('p');
		expect(doc.version).toEqual(V_ISO);
		expect(doc.versions.map((v) => v.id)).toEqual([V.id, older.id]);
		expect(doc.versions[1].at).toBe(new Date(older.at).toISOString());
	});

	it('getVersion hits the versions path', async () => {
		fetchMock.mockResolvedValue(jsonResponse(200, { id: 'doc1', version: V, payload: 'p' }));
		const v = await getVersion('doc1', V.id);
		expect(fetchMock.mock.calls[0][0]).toBe(`/api/docs/doc1/versions/${V.id}`);
		expect(v).toEqual({ id: 'doc1', version: V_ISO, payload: 'p' });
	});

	it('saveDoc PUTs payload and base', async () => {
		fetchMock.mockResolvedValue(jsonResponse(200, { id: 'doc1', version: V }));
		await saveDoc('doc1', 'p', 'base-vid', 'tok');
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('/api/docs/doc1');
		expect(init?.method).toBe('PUT');
		expect(JSON.parse(String(init?.body))).toEqual({ payload: 'p', base: 'base-vid' });
		expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tok');
	});

	it('throws a typed ApiError on non-2xx with the server code and message', async () => {
		fetchMock.mockResolvedValue(
			jsonResponse(401, { error: 'unauthorized', message: 'missing bearer token' })
		);
		const err = await createDoc('p', 'tok').catch((e: unknown) => e);
		expect(err).toBeInstanceOf(ApiError);
		const api = err as ApiError;
		expect(api.status).toBe(401);
		expect(api.code).toBe('unauthorized');
		expect(api.message).toBe('missing bearer token');
		expect(api.latest).toBeUndefined();
	});

	it('carries `latest` on a 409 stale save', async () => {
		fetchMock.mockResolvedValue(jsonResponse(409, { error: 'stale', latest: V }));
		const err = (await saveDoc('doc1', 'p', 'old', 'tok').catch((e: unknown) => e)) as ApiError;
		expect(err).toBeInstanceOf(ApiError);
		expect(err.status).toBe(409);
		expect(err.code).toBe('stale');
		expect(err.latest).toEqual(V_ISO);
	});

	it('falls back to http_error for non-JSON error bodies', async () => {
		fetchMock.mockResolvedValue(new Response('boom', { status: 500 }));
		const err = (await getDoc('x').catch((e: unknown) => e)) as ApiError;
		expect(err.status).toBe(500);
		expect(err.code).toBe('http_error');
	});

	it('wraps network failures as ApiError with status 0', async () => {
		fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
		const err = (await getDoc('x').catch((e: unknown) => e)) as ApiError;
		expect(err).toBeInstanceOf(ApiError);
		expect(err.status).toBe(0);
		expect(err.code).toBe('network');
	});
});
