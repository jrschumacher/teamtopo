/**
 * Read-only document view, also used for a single version. Adopts the editor's header
 * shell (logo, title, History, a view-only Share popover) with no editor controls.
 */

import { parse, render, type Model } from '@lib/teamtopo';
import { brandMarkHtml, pageTitle } from '../lib/brand';
import { docPath, teamLink, versionLink } from '../lib/links';
import { escapeHtml } from '../lib/markdown';
import { setupPopovers } from '../lib/popover';
import type { OpenedDoc } from '../lib/types';
import { navigate } from '../router';
import './editor.css';

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

function absolute(link: string): string {
	return `${location.origin}${link}`;
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

function historyPopoverHtml(doc: OpenedDoc, versionId?: string): string {
	if (doc.versions.length === 0) return '<p class="ed-pop-empty">No saved versions yet.</p>';
	const currentId = versionId ?? doc.versions[0]?.id;
	const items = doc.versions
		.map((v) => {
			const current = v.id === currentId;
			return `<li><a class="ed-pop-item${current ? ' current' : ''}" href="${versionLink(doc.id, v.id, doc.fragment)}"><span class="ed-pop-id">${escapeHtml(v.id)}</span><span class="ed-pop-when">${escapeHtml(formatWhen(v.at))}</span></a></li>`;
		})
		.join('');
	return `<ul class="ed-pop-list" id="versions">${items}</ul>`;
}

function shareViewOnlyHtml(doc: OpenedDoc): string {
	const view = escapeHtml(absolute(doc.links.view));
	return `<div class="ed-share-row">
		<span class="ed-share-pill view"><b>view</b><input readonly id="view-link" class="ed-share-input" value="${view}"></span>
		<button type="button" class="ed-copy" id="copy-view" data-copy="#view-link">Copy</button>
	</div>`;
}

function versionBar(doc: OpenedDoc, versionId: string): string {
	const v = doc.versions.find((x) => x.id === versionId) ?? doc.version;
	const when = v ? formatWhen(v.at) : versionId;
	return `<div class="banner version-bar" role="status">Viewing version from ${escapeHtml(when)} · <a href="${docPath(doc.id)}${doc.fragment}">back to latest</a></div>`;
}

function headerHtml(doc: OpenedDoc, title: string, opts: ViewerOptions): string {
	const editorLink =
		doc.canEdit && doc.links.edit
			? `<a class="ed-btn ed-btn-primary" id="open-editor" href="${doc.links.edit}">Open editor</a>`
			: '';
	return `
	<header class="ed-bar">
		<a class="ed-brand" href="/">${brandMarkHtml()}teamtopo</a>
		<span class="ed-divider"></span>
		<span class="ed-title" id="doc-title">${escapeHtml(title)}</span>
		<span class="ed-spacer"></span>
		<div class="ed-pop-wrap">
			<button class="ed-btn" id="history-btn" type="button" aria-haspopup="true" aria-expanded="false">History</button>
			<div class="ed-popover" id="history-pop" hidden>${historyPopoverHtml(doc, opts.versionId)}</div>
		</div>
		<div class="ed-pop-wrap">
			<button class="ed-btn ed-btn-outline" id="share-btn" type="button" aria-haspopup="true" aria-expanded="false">Share</button>
			<div class="ed-popover" id="share-pop" hidden><div class="ed-share">${shareViewOnlyHtml(doc)}</div></div>
		</div>
		${editorLink}
	</header>
	<button type="button" class="ed-backdrop" id="backdrop" hidden aria-hidden="true" tabindex="-1"></button>`;
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
	document.title = pageTitle(model?.title);

	root.innerHTML = `
	<div class="ed-shell">
		${headerHtml(doc, title, opts)}
		${opts.versionId ? versionBar(doc, opts.versionId) : ''}
		<main class="viewer-body">
			<div class="ed-canvas fit" id="canvas">${diagram}</div>
			<aside class="side">
				<h2>Teams</h2>
				${model ? teamsHtml(model, doc) : ''}
				<h2>Versions</h2>
				${versionsHtml(doc, opts.versionId)}
			</aside>
		</main>
		<div class="toast" id="toast" role="status" aria-live="polite"></div>
	</div>`;

	const toast = root.querySelector('#toast');
	let toastTimer: ReturnType<typeof setTimeout> | undefined;
	const showToast = (msg: string) => {
		if (!toast) return;
		toast.textContent = msg;
		toast.classList.add('show');
		clearTimeout(toastTimer);
		toastTimer = setTimeout(() => toast.classList.remove('show'), 1800);
	};

	root.querySelector('#canvas')?.addEventListener('click', (e) => {
		const g = (e.target as Element | null)?.closest<SVGElement>('.tt-node, .tt-frame');
		const id = g?.getAttribute('data-id');
		if (!id || !model) return;
		const node = model.index[id];
		if (!node || node.type === 'group') return;
		navigate(teamLink(doc.id, id, doc.fragment));
	});

	root.addEventListener('click', (e) => {
		const btn = (e.target as Element | null)?.closest<HTMLButtonElement>('[data-copy]');
		if (!btn) return;
		const sel = btn.dataset.copy;
		const input = sel ? root.querySelector<HTMLInputElement>(sel) : null;
		if (!input) return;
		void navigator.clipboard.writeText(input.value).then(
			() => showToast('View link copied'),
			() => showToast('Clipboard blocked. Copy the address bar instead.')
		);
	});

	const historyBtn = root.querySelector<HTMLButtonElement>('#history-btn');
	const historyPop = root.querySelector<HTMLElement>('#history-pop');
	const shareBtn = root.querySelector<HTMLButtonElement>('#share-btn');
	const sharePop = root.querySelector<HTMLElement>('#share-pop');
	const backdrop = root.querySelector<HTMLElement>('#backdrop');
	if (historyBtn && historyPop && shareBtn && sharePop && backdrop) {
		setupPopovers(backdrop, [
			{ button: historyBtn, panel: historyPop },
			{ button: shareBtn, panel: sharePop }
		]);
	}
}
