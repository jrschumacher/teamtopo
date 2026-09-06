import { ApiError } from './lib/api';
import { LinkError, openDocument, openVersion } from './lib/doc';
import { escapeHtml } from './lib/markdown';
import { startRouter, type Route } from './router';
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

	root.innerHTML = '<p class="notice">Loading…</p>';
	try {
		switch (route.name) {
			case 'new': {
				const example = new URLSearchParams(location.search).get('example');
				const starter = await loadStarter(example);
				if (stale()) return;
				renderEditor(root, null, { starter, resetDraft: example !== null });
				return;
			}
			case 'doc': {
				const doc = await openDocument(route.params.id, location.hash);
				if (stale()) return;
				if (doc.canEdit) renderEditor(root, doc);
				else renderViewer(root, doc);
				return;
			}
			case 'version': {
				const doc = await openVersion(route.params.id, route.params.vid, location.hash);
				if (stale()) return;
				renderViewer(root, doc, { versionId: route.params.vid });
				return;
			}
			case 'team': {
				const doc = await openDocument(route.params.id, location.hash);
				if (stale()) return;
				renderTeamView(root, doc, route.params.teamId);
				return;
			}
		}
	} catch (err) {
		if (stale()) return;
		root.innerHTML = errorHtml(err);
	}
}

const root = document.getElementById('app');
if (!root) throw new Error('#app missing');
startRouter(root, (route, el) => void show(route, el));
