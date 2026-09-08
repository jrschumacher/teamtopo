import type { Env } from './index';
import { json } from './http';
import { ROUTES, track } from './analytics';

const MAX_PAYLOAD_BYTES = 262144;
const MAX_VERSIONS = 100;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BASE36 = '0123456789abcdefghijklmnopqrstuvwxyz';

interface VersionMeta {
	id: string;
	at: string;
	size: number;
}

interface DocMeta {
	id: string;
	tokenHash: string;
	createdAt: string;
	latest: string;
	versions: VersionMeta[];
}

type Result<T> = { ok: true; value: T } | { ok: false; reason: string };

// Responses in this file always carry Cache-Control: no-store (never call `error()`
// from ./http directly here, since it does not set that header).
function noStore(data: unknown, status: number): Response {
	return json(data, status, { 'Cache-Control': 'no-store' });
}

function fail(code: string, message: string, status: number): Response {
	return noStore({ error: code, message }, status);
}

function byteLength(value: string): number {
	return new TextEncoder().encode(value).length;
}

function validatePayload(value: unknown): Result<string> {
	if (typeof value !== 'string') return { ok: false, reason: 'payload must be a string' };
	if (byteLength(value) > MAX_PAYLOAD_BYTES) {
		return { ok: false, reason: 'payload exceeds 262144 bytes' };
	}
	return { ok: true, value };
}

function validateId(value: string): Result<string> {
	if (!UUID_RE.test(value)) return { ok: false, reason: 'id must be a UUID' };
	return { ok: true, value };
}

async function parseJsonBody(request: Request): Promise<Result<Record<string, unknown>>> {
	try {
		const value = await request.json();
		if (typeof value !== 'object' || value === null) {
			return { ok: false, reason: 'body must be a JSON object' };
		}
		return { ok: true, value: value as Record<string, unknown> };
	} catch {
		return { ok: false, reason: 'malformed JSON' };
	}
}

function docKey(id: string): string {
	return `docs/${id}/meta.json`;
}

function versionKey(id: string, vid: string): string {
	return `docs/${id}/v/${vid}`;
}

async function readMeta(env: Env, id: string): Promise<DocMeta | null> {
	const obj = await env.DOCS.get(docKey(id));
	if (!obj) return null;
	return (await obj.json()) as DocMeta;
}

async function writeMeta(env: Env, meta: DocMeta): Promise<void> {
	await env.DOCS.put(docKey(meta.id), JSON.stringify(meta));
}

async function hashToken(token: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
	return base64url(new Uint8Array(digest));
}

function base64url(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Hand-rolled constant-time compare: the project's tsconfig mixes lib "DOM" with
// @cloudflare/workers-types, and DOM's SubtleCrypto (an interface) does not merge with
// workers-types' SubtleCrypto (a class), so crypto.subtle.timingSafeEqual is invisible
// to tsc here even though workerd implements it. Both inputs are fixed-length SHA-256
// digests, so the length check leaks nothing secret.
function constantTimeEqual(a: string, b: string): boolean {
	const enc = new TextEncoder();
	const ab = enc.encode(a);
	const bb = enc.encode(b);
	if (ab.byteLength !== bb.byteLength) return false;
	let diff = 0;
	for (let i = 0; i < ab.byteLength; i++) diff |= ab[i] ^ bb[i];
	return diff === 0;
}

function bearerToken(request: Request): string | null {
	const header = request.headers.get('authorization');
	if (!header) return null;
	const match = /^Bearer\s+(.+)$/i.exec(header);
	return match ? match[1] : null;
}

function newVersionId(): string {
	const ts = Date.now().toString().padStart(14, '0');
	const randomBytes = crypto.getRandomValues(new Uint8Array(4));
	let rand = '';
	for (const byte of randomBytes) rand += BASE36[byte % BASE36.length];
	return `${ts}-${rand}`;
}

async function checkRateLimit(env: Env, request: Request): Promise<Response | null> {
	const key = request.headers.get('CF-Connecting-IP') ?? 'anon';
	const outcome = await env.WRITE_LIMIT.limit({ key });
	if (!outcome.success) return fail('rate_limited', 'too many requests, try again later', 429);
	return null;
}

function payloadValidationFailure(reason: string): Response {
	return reason.includes('exceeds')
		? fail('payload_too_large', reason, 413)
		: fail('bad_request', reason, 400);
}

async function createDoc(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
	const token = bearerToken(request);
	if (!token) return fail('unauthorized', 'missing bearer token', 401);

	const limited = await checkRateLimit(env, request);
	if (limited) return limited;

	const bodyResult = await parseJsonBody(request);
	if (!bodyResult.ok) return fail('bad_request', bodyResult.reason, 400);

	const payloadResult = validatePayload(bodyResult.value.payload);
	if (!payloadResult.ok) return payloadValidationFailure(payloadResult.reason);

	const id = crypto.randomUUID();
	const tokenHash = await hashToken(token);
	const vid = newVersionId();
	const at = new Date().toISOString();
	const version: VersionMeta = { id: vid, at, size: byteLength(payloadResult.value) };

	await env.DOCS.put(versionKey(id, vid), payloadResult.value);
	const meta: DocMeta = { id, tokenHash, createdAt: at, latest: vid, versions: [version] };
	await writeMeta(env, meta);

	track(env, ctx, {
		type: 'doc_create',
		route: ROUTES.docs,
		docId: id,
		payloadBytes: version.size,
		versionCount: 1
	});
	return noStore({ id, version }, 201);
}

async function getDoc(
	env: Env,
	ctx: ExecutionContext,
	id: string,
	view: 'doc_view' | 'team_view'
): Promise<Response> {
	const meta = await readMeta(env, id);
	if (!meta) return fail('not_found', 'no such document', 404);

	const latestVersion = meta.versions.find((v) => v.id === meta.latest);
	const payloadObj = await env.DOCS.get(versionKey(id, meta.latest));
	if (!latestVersion || !payloadObj) return fail('not_found', 'no such version', 404);

	const payload = await payloadObj.text();
	track(env, ctx, {
		type: view,
		route: ROUTES.doc,
		docId: id,
		payloadBytes: latestVersion.size,
		versionCount: meta.versions.length
	});
	return noStore({ id: meta.id, version: latestVersion, versions: meta.versions, payload }, 200);
}

async function getVersion(
	env: Env,
	ctx: ExecutionContext,
	id: string,
	vid: string
): Promise<Response> {
	const meta = await readMeta(env, id);
	if (!meta) return fail('not_found', 'no such document', 404);

	const version = meta.versions.find((v) => v.id === vid);
	const obj = await env.DOCS.get(versionKey(id, vid));
	if (!version || !obj) return fail('not_found', 'no such version', 404);

	const payload = await obj.text();
	track(env, ctx, {
		type: 'version_view',
		route: ROUTES.version,
		docId: id,
		payloadBytes: version.size,
		versionCount: meta.versions.length
	});
	return noStore({ id: meta.id, version, payload }, 200);
}

async function putDoc(
	request: Request,
	env: Env,
	ctx: ExecutionContext,
	id: string
): Promise<Response> {
	const meta = await readMeta(env, id);
	if (!meta) return fail('not_found', 'no such document', 404);

	const token = bearerToken(request);
	if (!token) return fail('unauthorized', 'missing bearer token', 401);

	const limited = await checkRateLimit(env, request);
	if (limited) return limited;

	const bodyResult = await parseJsonBody(request);
	if (!bodyResult.ok) return fail('bad_request', bodyResult.reason, 400);

	const payloadResult = validatePayload(bodyResult.value.payload);
	if (!payloadResult.ok) return payloadValidationFailure(payloadResult.reason);

	const base = bodyResult.value.base;
	if (typeof base !== 'string') return fail('bad_request', 'base must be a string', 400);

	const tokenHash = await hashToken(token);
	if (!constantTimeEqual(tokenHash, meta.tokenHash)) {
		return fail('unauthorized', 'invalid token', 401);
	}

	if (base !== meta.latest) {
		const latestVersion = meta.versions.find((v) => v.id === meta.latest) ?? null;
		return noStore({ error: 'stale', latest: latestVersion }, 409);
	}

	const vid = newVersionId();
	const at = new Date().toISOString();
	const version: VersionMeta = { id: vid, at, size: byteLength(payloadResult.value) };

	await env.DOCS.put(versionKey(id, vid), payloadResult.value);
	meta.versions = [version, ...meta.versions];
	meta.latest = vid;

	while (meta.versions.length > MAX_VERSIONS) {
		const evicted = meta.versions.pop();
		if (evicted) await env.DOCS.delete(versionKey(id, evicted.id));
	}

	await writeMeta(env, meta);
	track(env, ctx, {
		type: 'doc_save',
		route: ROUTES.doc,
		docId: id,
		payloadBytes: version.size,
		versionCount: meta.versions.length
	});
	return noStore({ id, version }, 200);
}

export async function handleDocs(
	request: Request,
	env: Env,
	ctx: ExecutionContext,
	url: URL
): Promise<Response> {
	const segments = url.pathname.split('/').filter(Boolean).slice(2);

	if (segments.length === 0) {
		if (request.method !== 'POST') return fail('method_not_allowed', 'method not allowed', 405);
		return createDoc(request, env, ctx);
	}

	const idResult = validateId(segments[0]);
	if (!idResult.ok) return fail('bad_request', idResult.reason, 400);
	const id = idResult.value;

	if (segments.length === 1) {
		if (request.method === 'GET') {
			// The team page fetches the same document; the client marks it with `?view=team`
			// so usage analytics can tell the two apart. The response is identical.
			const view = url.searchParams.get('view') === 'team' ? 'team_view' : 'doc_view';
			return getDoc(env, ctx, id, view);
		}
		if (request.method === 'PUT') return putDoc(request, env, ctx, id);
		return fail('method_not_allowed', 'method not allowed', 405);
	}

	if (segments.length === 3 && segments[1] === 'versions') {
		if (request.method !== 'GET') return fail('method_not_allowed', 'method not allowed', 405);
		return getVersion(env, ctx, id, segments[2]);
	}

	return fail('not_found', 'no such route', 404);
}
