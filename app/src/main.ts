import { ApiError } from './lib/api';
import { getCached, revalidate, setCached } from './lib/doc-cache';
import { LinkError, openDocument, openVersion } from './lib/doc';
import { escapeHtml } from './lib/markdown';
import type { OpenedDoc } from './lib/types';
import { matchRoute, startRouter, type Route } from './router';
import { renderEditor } from './views/editor';
import { renderLanding } from './views/landing';
import { renderTeamView } from './views/team';
import { renderViewer } from './views/viewer';

interface CatalogEntry {
	name: string;
	title: string;
	source: string;
}

/** Starter for `/new`: `?example=<name>` from the catalog, else the first entry. */
async function loadStarter(name: string | null): Promise<string | undefined> {
	try {
		const res = await fetch('/catalog.json');
		if (!res.ok) return undefined;
		const data = (await res.json()) as unknown;
		if (!Array.isArray(data)) return undefined;
		const entries = data as CatalogEntry[];
		const match = name ? entries.find((e) => e.name === name) : undefined;
		return (match ?? entries[0])?.source;
	} catch {
		return undefined;
	}
}

function notice(
	title: string,
	body: string,
	links = '<a href="/">Home</a> · <a href="/new">New diagram</a>'
) {
	return `<div class="notice"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p><p>${links}</p></div>`;
}

function errorHtml(err: unknown): string {
	if (err instanceof LinkError) return notice('Link missing key', err.message);
	if (err instanceof ApiError) {
		if (err.status === 404)
			return notice('Document not found', 'This diagram does not exist or has been removed.');
		if (err.status === 0)
			return notice('Offline', 'Could not reach the server. Check your connection and try again.');
		return notice('Something went wrong', `The server answered ${err.status}: ${err.message}`);
	}
	return notice('Something went wrong', err instanceof Error ? err.message : String(err));
}

let seq = 0;

/** Draws the doc-bearing routes ('doc' | 'version' | 'team'). Shared so a cache-hit
 * synchronous render and a post-fetch render go through the exact same dispatch. */
function drawDoc(route: Route, doc: OpenedDoc, root: HTMLElement): void {
	if (route.name === 'doc') {
		if (doc.canEdit) renderEditor(root, doc);
		else renderViewer(root, doc);
	} else if (route.name === 'version') {
		renderViewer(root, doc, { versionId: route.params.vid });
	} else if (route.name === 'team') {
		renderTeamView(root, doc, route.params.teamId);
	}
}

/** Wraps a synchronous DOM swap in `document.startViewTransition` where available, so
 * the outgoing and incoming view cross-fade instead of the page ever going blank. */
function swap(draw: () => void): void {
	const startViewTransition = (
		document as Document & { startViewTransition?: (cb: () => void) => unknown }
	).startViewTransition;
	if (typeof startViewTransition === 'function') {
		startViewTransition.call(document, draw);
	} else {
		draw();
	}
}

/** Small inline "syncing" hint in the header's state pill, used while a background
 * revalidation fetch is in flight — never replaces the page. */
function setSyncing(root: HTMLElement, on: boolean): void {
	const pill = root.querySelector('.ed-state');
	pill?.classList.toggle('is-syncing', on);
}

/** Revalidation cooldown: a doc just fetched (or revalidated) over the network is
 * assumed current for this long, so hopping between its own routes (editor ↔ its
 * teams ↔ its versions) makes no further requests. A background fetch still runs once
 * this window has passed, so an externally-updated doc is caught on the next hop. */
const REVALIDATE_COOLDOWN_MS = 60_000;
const lastFetchedAt = new Map<string, number>();

function markFetched(id: string): void {
	lastFetchedAt.set(id, Date.now());
}

/** After a synchronous cache-hit render, revalidate in the background — unless this doc
 * was fetched or revalidated too recently to bother. Refetches, compares the version id,
 * and re-renders only when it changed. Silent no-op on failure — the cached view stays
 * up; the next navigation (past the cooldown) or an explicit save will retry. */
function revalidateInBackground(
	route: Route & { name: 'doc' | 'version' | 'team' },
	root: HTMLElement,
	my: number
): void {
	const id = route.params.id;
	const last = lastFetchedAt.get(id) ?? 0;
	if (Date.now() - last < REVALIDATE_COOLDOWN_MS) return;

	const stale = () => my !== seq;
	setSyncing(root, true);
	void revalidate(id, () => openDocument(id, location.hash))
		.then((fresh) => {
			markFetched(id);
			if (stale() || !fresh) return;
			swap(() => drawDoc(route, fresh, root));
		})
		.catch(() => {
			// background revalidation failure is non-fatal; the cached view stays put
		})
		.finally(() => {
			if (!stale()) setSyncing(root, false);
		});
}

async function show(route: Route | null, root: HTMLElement): Promise<void> {
	const my = ++seq;
	const stale = () => my !== seq;
	root.dataset.view = route?.name ?? 'notfound';

	if (!route) {
		root.innerHTML = notice('Not found', 'There is nothing at this address.');
		return;
	}
	if (route.name === 'home') {
		renderLanding(root);
		return;
	}

	try {
		switch (route.name) {
			case 'new': {
				root.innerHTML = '<p class="notice">Loading…</p>';
				const example = new URLSearchParams(location.search).get('example');
				const starter = await loadStarter(example);
				if (stale()) return;
				renderEditor(root, null, { starter, resetDraft: example !== null });
				return;
			}
			case 'doc':
			case 'team': {
				const cached = getCached(route.params.id, location.hash);
				if (cached) {
					swap(() => drawDoc(route, cached, root));
					revalidateInBackground(route, root, my);
					return;
				}
				root.innerHTML = '<p class="notice">Loading…</p>';
				const doc = await openDocument(route.params.id, location.hash);
				markFetched(route.params.id);
				if (stale()) return;
				swap(() => drawDoc(route, doc, root));
				return;
			}
			case 'version': {
				// A cached doc whose current version matches the requested one has the same
				// content: reuse it synchronously instead of re-fetching that version.
				const cached = getCached(route.params.id, location.hash);
				if (cached && cached.version?.id === route.params.vid) {
					swap(() => drawDoc(route, cached, root));
					return;
				}
				root.innerHTML = '<p class="notice">Loading…</p>';
				const doc = await openVersion(route.params.id, route.params.vid, location.hash);
				if (stale()) return;
				swap(() => drawDoc(route, doc, root));
				return;
			}
		}
	} catch (err) {
		if (stale()) return;
		root.innerHTML = errorHtml(err);
	}
}

/** Warm the doc cache for an in-app team/version link on hover or focus, so following it
 * renders synchronously. Guards against duplicate in-flight warms and existing cache. */
const warming = new Set<string>();

function warmLink(a: HTMLAnchorElement): void {
	const url = new URL(a.href, location.href);
	if (url.origin !== location.origin) return;
	const route = matchRoute(url.pathname);
	if (!route || (route.name !== 'team' && route.name !== 'version')) return;
	const hash = url.hash || location.hash;
	const key = `${route.params.id}${hash}`;
	if (warming.has(key) || getCached(route.params.id, hash)) return;
	warming.add(key);
	openDocument(route.params.id, hash)
		.then((doc) => {
			setCached(doc);
			markFetched(route.params.id);
		})
		.catch(() => {
			// prefetch failure is silent; the real navigation will surface the error
		})
		.finally(() => warming.delete(key));
}

function onWarmEvent(ev: Event): void {
	const a = (ev.target as Element | null)?.closest('a');
	if (a) warmLink(a as HTMLAnchorElement);
}

document.addEventListener('mouseover', onWarmEvent);
document.addEventListener('focus', onWarmEvent, true);

const root = document.getElementById('app');
if (!root) throw new Error('#app missing');
startRouter(root, (route, el) => void show(route, el));
