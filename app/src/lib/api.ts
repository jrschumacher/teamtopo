/** Thin typed fetch wrappers for the Worker API in docs/app-intent.md "Worker API". */

import type { Version } from './types';

export class ApiError extends Error {
	status: number;
	code: string;
	/** Present on 409 `stale`: the version the server currently has. */
	latest?: Version;

	constructor(status: number, code: string, message: string, latest?: Version) {
		super(message);
		this.name = 'ApiError';
		this.status = status;
		this.code = code;
		this.latest = latest;
	}
}

export interface DocRef {
	id: string;
	version: Version;
}

export interface DocResponse extends DocRef {
	versions: Version[];
	payload: string;
}

export interface VersionResponse extends DocRef {
	payload: string;
}

/** The worker emits `at` as epoch milliseconds; the client contract is ISO 8601. */
function normalizeVersion(v: unknown): Version {
	const o = (v ?? {}) as Record<string, unknown>;
	const at = typeof o.at === 'number' ? new Date(o.at).toISOString() : String(o.at ?? '');
	return { id: String(o.id ?? ''), at, size: Number(o.size ?? 0) };
}

async function readBody(res: Response): Promise<Record<string, unknown>> {
	try {
		const data: unknown = await res.json();
		return typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

async function request(path: string, init: RequestInit): Promise<Record<string, unknown>> {
	let res: Response;
	try {
		res = await fetch(path, init);
	} catch (err) {
		throw new ApiError(0, 'network', err instanceof Error ? err.message : 'network error');
	}
	const body = await readBody(res);
	if (!res.ok) {
		const code = typeof body.error === 'string' ? body.error : 'http_error';
		const message = typeof body.message === 'string' ? body.message : `HTTP ${res.status}`;
		const latest = body.latest ? normalizeVersion(body.latest) : undefined;
		throw new ApiError(res.status, code, message, latest);
	}
	return body;
}

function jsonInit(method: string, body: unknown, writeToken?: string): RequestInit {
	const headers: Record<string, string> = { 'Content-Type': 'application/json' };
	if (writeToken) headers.Authorization = `Bearer ${writeToken}`;
	return { method, headers, body: JSON.stringify(body) };
}

function toRef(body: Record<string, unknown>): DocRef {
	return { id: String(body.id ?? ''), version: normalizeVersion(body.version) };
}

export async function createDoc(payload: string, writeToken: string): Promise<DocRef> {
	return toRef(await request('/api/docs', jsonInit('POST', { payload }, writeToken)));
}

/** Why the document is being fetched. The response is identical either way; the worker only
 * uses these for usage analytics (docs/analytics.md). */
export interface GetDocOptions {
	/** The team page is asking: counted as `team_view` instead of `doc_view`. */
	view?: 'team';
	/** Background revalidation, link prefetch or a supporting fetch: records no view at all. */
	background?: boolean;
}

export async function getDoc(id: string, opts: GetDocOptions = {}): Promise<DocResponse> {
	const params = new URLSearchParams();
	if (opts.view) params.set('view', opts.view);
	if (opts.background) params.set('background', '1');
	const query = params.toString();
	const body = await request(`/api/docs/${encodeURIComponent(id)}${query ? `?${query}` : ''}`, {
		method: 'GET'
	});
	const versions = Array.isArray(body.versions) ? body.versions.map(normalizeVersion) : [];
	return { ...toRef(body), versions, payload: String(body.payload ?? '') };
}

export async function getVersion(id: string, vid: string): Promise<VersionResponse> {
	const body = await request(
		`/api/docs/${encodeURIComponent(id)}/versions/${encodeURIComponent(vid)}`,
		{ method: 'GET' }
	);
	return { ...toRef(body), payload: String(body.payload ?? '') };
}

export async function saveDoc(
	id: string,
	payload: string,
	base: string,
	writeToken: string
): Promise<DocRef> {
	return toRef(
		await request(
			`/api/docs/${encodeURIComponent(id)}`,
			jsonInit('PUT', { payload, base }, writeToken)
		)
	);
}
