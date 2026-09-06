import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './api';
import { decrypt, deriveKeys, encrypt, importViewKey, newSecret } from './crypto';
import { createDocument, LinkError, openDocument, openVersion } from './doc';

const SRC = 'teamTopology\n  stream app "Product"\n';
const V1 = { id: '00000000000001-aaaa', at: 1_700_000_000_000, size: 10 };
const V2 = { id: '00000000000002-bbbb', at: 1_700_000_001_000, size: 12 };

function jsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), { status });
}

describe('doc', () => {
	const fetchMock = vi.fn<typeof fetch>();
	let secret: string;
	let payload: string;

	beforeEach(async () => {
		vi.stubGlobal('fetch', fetchMock);
		secret = newSecret();
		const { encKey } = await deriveKeys(secret);
		payload = await encrypt(encKey, SRC);
	});
	afterEach(() => {
		fetchMock.mockReset();
		vi.unstubAllGlobals();
	});

	function serveDoc() {
		fetchMock.mockImplementation(async (input) => {
			const url = String(input);
			if (url === '/api/docs/doc1') {
				return jsonResponse(200, { id: 'doc1', version: V2, versions: [V2, V1], payload });
			}
			if (url === `/api/docs/doc1/versions/${V1.id}`) {
				return jsonResponse(200, { id: 'doc1', version: V1, payload });
			}
			return jsonResponse(404, { error: 'not_found', message: 'no such document' });
		});
	}

	it('opens with the edit link: canEdit, both links, save attached', async () => {
		serveDoc();
		const doc = await openDocument('doc1', `#s=${secret}`);
		expect(doc.source).toBe(SRC);
		expect(doc.canEdit).toBe(true);
		expect(doc.save).toBeTypeOf('function');
		expect(doc.fragment).toBe(`#s=${secret}`);
		expect(doc.links.edit).toBe(`/d/doc1#s=${secret}`);
		const { viewKey } = await deriveKeys(secret);
		expect(doc.links.view).toBe(`/d/doc1#k=${viewKey}`);
		expect(doc.version?.id).toBe(V2.id);
		expect(doc.versions.map((v) => v.id)).toEqual([V2.id, V1.id]);
	});

	it('opens with the view link: read-only, no edit link', async () => {
		serveDoc();
		const { viewKey } = await deriveKeys(secret);
		const doc = await openDocument('doc1', `#k=${viewKey}`);
		expect(doc.source).toBe(SRC);
		expect(doc.canEdit).toBe(false);
		expect(doc.save).toBeUndefined();
		expect(doc.links.edit).toBeUndefined();
		expect(doc.fragment).toBe(`#k=${viewKey}`);
	});

	it('rejects a link without a key before fetching', async () => {
		serveDoc();
		const err = (await openDocument('doc1', '').catch((e: unknown) => e)) as LinkError;
		expect(err).toBeInstanceOf(LinkError);
		expect(err.code).toBe('missing_key');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('rejects a wrong key as bad_key', async () => {
		serveDoc();
		const other = await deriveKeys(newSecret());
		const err = (await openDocument('doc1', `#k=${other.viewKey}`).catch(
			(e: unknown) => e
		)) as LinkError;
		expect(err).toBeInstanceOf(LinkError);
		expect(err.code).toBe('bad_key');
	});

	it('rejects a malformed key as bad_key', async () => {
		serveDoc();
		const err = (await openDocument('doc1', '#s=nope').catch((e: unknown) => e)) as LinkError;
		expect(err).toBeInstanceOf(LinkError);
		expect(err.code).toBe('bad_key');
	});

	it('propagates a 404 as ApiError', async () => {
		serveDoc();
		const err = await openDocument('missing', `#s=${secret}`).catch((e: unknown) => e);
		expect(err).toBeInstanceOf(ApiError);
		expect((err as ApiError).status).toBe(404);
	});

	it('save encrypts with the doc key, uses the current version as base, and updates the doc', async () => {
		serveDoc();
		const doc = await openDocument('doc1', `#s=${secret}`);
		const V3 = { id: '00000000000003-cccc', at: 1_700_000_002_000, size: 20 };
		fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: 'doc1', version: V3 }));

		const next = SRC + '  platform infra "Infra"\n';
		const version = await doc.save!(next);
		expect(version.id).toBe(V3.id);

		const [url, init] = fetchMock.mock.calls.at(-1)!;
		expect(url).toBe('/api/docs/doc1');
		expect(init?.method).toBe('PUT');
		const { writeToken, encKey } = await deriveKeys(secret);
		expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${writeToken}`);
		const body = JSON.parse(String(init?.body)) as { payload: string; base: string };
		expect(body.base).toBe(V2.id);
		expect(await decrypt(encKey, body.payload)).toBe(next);

		expect(doc.source).toBe(next);
		expect(doc.version?.id).toBe(V3.id);
		expect(doc.versions.map((v) => v.id)).toEqual([V3.id, V2.id, V1.id]);
	});

	it('rethrows a 409 with latest and leaves the doc unchanged; retry with latest as base works', async () => {
		serveDoc();
		const doc = await openDocument('doc1', `#s=${secret}`);
		const V3 = { id: '00000000000003-cccc', at: 1_700_000_002_000, size: 20 };
		fetchMock.mockResolvedValueOnce(jsonResponse(409, { error: 'stale', latest: V3 }));

		const err = (await doc.save!('x').catch((e: unknown) => e)) as ApiError;
		expect(err).toBeInstanceOf(ApiError);
		expect(err.status).toBe(409);
		expect(err.latest?.id).toBe(V3.id);
		expect(doc.version?.id).toBe(V2.id);
		expect(doc.source).toBe(SRC);

		const V4 = { id: '00000000000004-dddd', at: 1_700_000_003_000, size: 1 };
		fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: 'doc1', version: V4 }));
		doc.version = err.latest!;
		await doc.save!('x');
		const body = JSON.parse(String(fetchMock.mock.calls.at(-1)![1]?.body)) as { base: string };
		expect(body.base).toBe(V3.id);
		expect(doc.version?.id).toBe(V4.id);
	});

	it('openVersion returns the version as read-only with the full version list', async () => {
		serveDoc();
		const doc = await openVersion('doc1', V1.id, `#s=${secret}`);
		expect(doc.source).toBe(SRC);
		expect(doc.version?.id).toBe(V1.id);
		expect(doc.versions.map((v) => v.id)).toEqual([V2.id, V1.id]);
		expect(doc.canEdit).toBe(true);
		expect(doc.save).toBeUndefined();
		expect(doc.links.edit).toBe(`/d/doc1#s=${secret}`);
	});

	it('createDocument POSTs an encrypted payload and returns the edit link and an editable doc', async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse(201, { id: 'new1', version: V1 }));
		const created = await createDocument(SRC);
		expect(created.id).toBe('new1');
		expect(created.editLink).toBe(`/d/new1#s=${created.secret}`);

		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('/api/docs');
		const { encKey, writeToken, viewKey } = await deriveKeys(created.secret);
		expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${writeToken}`);
		const body = JSON.parse(String(init?.body)) as { payload: string };
		expect(await decrypt(await importViewKey(viewKey), body.payload)).toBe(SRC);
		expect(await decrypt(encKey, body.payload)).toBe(SRC);

		expect(created.doc.canEdit).toBe(true);
		expect(created.doc.version?.id).toBe(V1.id);
		expect(created.doc.versions).toHaveLength(1);
		expect(created.doc.links.view).toBe(`/d/new1#k=${viewKey}`);
		expect(created.doc.save).toBeTypeOf('function');
	});
});
