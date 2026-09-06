/** Read-only document view, also used for a single version. */

import { parse, render, type Model } from '@lib/teamtopo';
import { docPath, teamLink, versionLink } from '../lib/links';
import { escapeHtml } from '../lib/markdown';
import type { OpenedDoc } from '../lib/types';
import { navigate } from '../router';

export interface ViewerOptions {
	/** Set when viewing `/d/:id/v/:vid`; shows the version bar. */
	versionId?: string;
}

type Theme = 'light' | 'dark';

function currentTheme(): Theme {
	const stamped = document.documentElement.getAttribute('data-theme');
	if (stamped === 'dark' || stamped === 'light') return stamped;
	if (typeof matchMedia !== 'function') return 'light';
	return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function formatWhen(iso: string): string {
	const d = new Date(iso);
	return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function teamsHtml(model: Model, doc: OpenedDoc): string {
	const teams = model.teams.filter((t) => t.type !== 'group');
	if (teams.length === 0) return '<p class="muted">No teams.</p>';
	return `<ul class="team-list">${teams
		.map(
			(t) => `<li><a href="${teamLink(doc.id, t.id, doc.fragment)}">${escapeHtml(t.label)}</a></li>`
		)
		.join('')}</ul>`;
}

function versionsHtml(doc: OpenedDoc, versionId?: string): string {
	if (doc.versions.length === 0) return '<p class="muted">No versions.</p>';
	const currentId = versionId ?? doc.versions[0]?.id;
	return `<ol class="versions">${doc.versions
		.map((v) => {
			const label = `${escapeHtml(formatWhen(v.at))} · ${v.size} B`;
			const tag = v.id === currentId ? ' <span class="tag">viewing</span>' : '';
			return `<li><a href="${versionLink(doc.id, v.id, doc.fragment)}">${label}</a>${tag}</li>`;
		})
		.join('')}</ol>`;
}

function versionBar(doc: OpenedDoc, versionId: string): string {
	const v = doc.versions.find((x) => x.id === versionId) ?? doc.version;
	const when = v ? formatWhen(v.at) : versionId;
	return `<div class="banner version-bar" role="status">Viewing version from ${escapeHtml(when)} · <a href="${docPath(doc.id)}${doc.fragment}">back to latest</a></div>`;
}

export function renderViewer(root: HTMLElement, doc: OpenedDoc, opts: ViewerOptions = {}): void {
	let model: Model | null = null;
	let diagram: string;
	try {
		model = parse(doc.source);
		diagram = render(model, { theme: currentTheme(), idPrefix: 'vw' });
	} catch (e) {
		diagram = `<p class="empty">This diagram has a syntax error: ${escapeHtml(e instanceof Error ? e.message : String(e))}</p>`;
	}
	const title = model?.title || 'Untitled diagram';
	const editorLink =
		doc.canEdit && doc.links.edit
			? `<a class="btn primary" id="open-editor" href="${doc.links.edit}">Open editor</a>`
			: '';

	root.innerHTML = `
	<header class="bar">
		<div class="brand"><a href="/">teamtopo</a><h1>${escapeHtml(title)}</h1></div>
		<div class="controls">
			<button class="btn" id="copy-view-link" type="button">Copy view link</button>
			${editorLink}
		</div>
	</header>
	${opts.versionId ? versionBar(doc, opts.versionId) : ''}
	<main class="viewer-body">
		<div class="canvas fit" id="canvas">${diagram}</div>
		<aside class="side">
			<h2>Teams</h2>
			${model ? teamsHtml(model, doc) : ''}
			<h2>Versions</h2>
			${versionsHtml(doc, opts.versionId)}
		</aside>
	</main>
	<div class="toast" id="toast" role="status" aria-live="polite"></div>`;

	const toast = root.querySelector('#toast');
	let toastTimer: ReturnType<typeof setTimeout> | undefined;
	const showToast = (msg: string) => {
		if (!toast) return;
		toast.textContent = msg;
		toast.classList.add('show');
		clearTimeout(toastTimer);
		toastTimer = setTimeout(() => toast.classList.remove('show'), 1800);
	};

	root.querySelector('#copy-view-link')?.addEventListener('click', async () => {
		try {
			await navigator.clipboard.writeText(`${location.origin}${doc.links.view}`);
			showToast('View link copied');
		} catch {
			showToast('Clipboard blocked. Copy the address bar instead.');
		}
	});

	root.querySelector('#canvas')?.addEventListener('click', (e) => {
		const g = (e.target as Element | null)?.closest<SVGElement>('.tt-node, .tt-frame');
		const id = g?.getAttribute('data-id');
		if (!id || !model) return;
		const node = model.index[id];
		if (!node || node.type === 'group') return;
		navigate(teamLink(doc.id, id, doc.fragment));
	});
}
