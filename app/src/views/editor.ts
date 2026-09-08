/**
 * Editor view: source pane with syntax highlighting + line gutter, debounced live
 * render, a Diagram/Team APIs tab bar, header popovers (Examples, History, Share),
 * explicit Save with the stale-409 reload/save-anyway flow, and /new draft persistence.
 * Element ids and classes are a contract with the visual design (docs/editor-design.md);
 * keep them stable. Ported from src/playground.html, then restyled.
 */

import { parse, ParseError, render, teamApi, type Model, type Node } from '@lib/teamtopo';
import { ApiError } from '../lib/api';
import { brandMarkHtml } from '../lib/brand';
import { createDocument } from '../lib/doc';
import { highlight } from '../lib/highlight';
import { teamLink, versionLink } from '../lib/links';
import { escapeHtml } from '../lib/markdown';
import { setupPopovers, type PopoverController } from '../lib/popover';
import type { OpenedDoc, Version } from '../lib/types';
import { navigate } from '../router';
import { loadCatalog, type CatalogEntry } from './landing';
import './editor.css';

export const DRAFT_KEY = 'teamtopo.draft';
const RENDER_DELAY_MS = 120;
const TOAST_MS = 1800;
const COPY_FEEDBACK_MS = 1400;
const FALLBACK_STARTER =
	'teamTopology\n  stream app "Product"\n  platform infra "Platform"\n  infra --> app\n';

export interface EditorOptions {
	/** Source for a new document when no draft is stored (or `resetDraft` is set). */
	starter?: string;
	/** Ignore any stored draft and start from `starter`. */
	resetDraft?: boolean;
}

const disposers = new WeakMap<HTMLElement, () => void>();

type Theme = 'light' | 'dark';

function currentTheme(): Theme {
	const stamped = document.documentElement.getAttribute('data-theme');
	if (stamped === 'dark' || stamped === 'light') return stamped;
	if (typeof matchMedia !== 'function') return 'light';
	return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function readDraft(): string | null {
	try {
		return localStorage.getItem(DRAFT_KEY);
	} catch {
		return null;
	}
}

function writeDraft(source: string | null): void {
	try {
		if (source === null) localStorage.removeItem(DRAFT_KEY);
		else localStorage.setItem(DRAFT_KEY, source);
	} catch {
		// storage unavailable: drafts are a convenience only
	}
}

function formatWhen(iso: string): string {
	const d = new Date(iso);
	return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function absolute(link: string): string {
	return `${location.origin}${link}`;
}

function sanitizeFilename(name: string): string {
	const cleaned = name.trim().replace(/[\\/:*?"<>|]+/g, '-');
	return cleaned || 'diagram';
}

function historyHtml(doc: OpenedDoc | null): string {
	if (!doc || doc.versions.length === 0)
		return '<p class="ed-pop-empty">No saved versions yet.</p>';
	const items = doc.versions
		.map((v) => {
			const current = doc.version?.id === v.id;
			return `<li><a class="ed-pop-item${current ? ' current' : ''}" href="${versionLink(doc.id, v.id, doc.fragment)}"><span class="ed-pop-id">${escapeHtml(v.id)}</span><span class="ed-pop-when">${escapeHtml(formatWhen(v.at))}</span></a></li>`;
		})
		.join('');
	return `<ul class="ed-pop-list" id="versions">${items}</ul>`;
}

function shareHtml(doc: OpenedDoc | null): string {
	if (!doc) {
		return '<p class="muted">Save to get a view link and an edit link.</p>';
	}
	const view = escapeHtml(absolute(doc.links.view));
	const edit = doc.links.edit ? escapeHtml(absolute(doc.links.edit)) : '';
	return `
		<div class="ed-share-row">
			<span class="ed-share-pill view"><b>view</b><input readonly id="view-link" class="ed-share-input" value="${view}"></span>
			<button type="button" class="ed-copy" id="copy-view" data-copy="#view-link">Copy</button>
		</div>
		${
			edit
				? `<div class="ed-share-row">
			<span class="ed-share-pill edit"><b>edit</b><input readonly id="edit-link" class="ed-share-input" value="${edit}"></span>
			<button type="button" class="ed-copy" id="copy-edit" data-copy="#edit-link">Copy</button>
		</div>
		<p class="ed-share-warn">Anyone with the edit link can change this diagram. Share the view link unless you mean to grant write access.</p>`
				: ''
		}`;
}

function headerHtml(doc: OpenedDoc | null): string {
	const showExamples = doc === null;
	return `
	<header class="ed-bar">
		<a class="ed-brand" href="/">${brandMarkHtml()}teamtopo</a>
		<span class="ed-divider"></span>
		<span class="ed-title" id="doc-title">Untitled diagram</span>
		<span class="ed-state" id="state-pill"><span class="ed-state-dot" id="state-dot"></span><span id="state-text"></span></span>
		<span class="ed-spacer"></span>
		${
			showExamples
				? `<div class="ed-pop-wrap">
			<button class="ed-btn" id="examples-btn" type="button" aria-haspopup="true" aria-expanded="false">Examples ▾</button>
			<div class="ed-popover" id="examples-pop" hidden><ul class="ed-pop-list" id="examples-list"></ul></div>
		</div>`
				: ''
		}
		<div class="ed-pop-wrap">
			<button class="ed-btn" id="history-btn" type="button" aria-haspopup="true" aria-expanded="false">History</button>
			<div class="ed-popover" id="history-pop" hidden>${historyHtml(doc)}</div>
		</div>
		<div class="ed-pop-wrap">
			<button class="ed-btn ed-btn-outline" id="share-btn" type="button" aria-haspopup="true" aria-expanded="false">Share</button>
			<div class="ed-popover" id="share-pop" hidden><div class="ed-share">${shareHtml(doc)}</div></div>
		</div>
		<button class="ed-btn ed-btn-primary" id="save" type="button" disabled>Save</button>
	</header>
	<button type="button" class="ed-backdrop" id="backdrop" hidden aria-hidden="true" tabindex="-1"></button>`;
}

function shell(doc: OpenedDoc | null): string {
	return `
	<div class="ed-shell">
		${headerHtml(doc)}
		<div class="banner" id="banner" role="status" hidden></div>
		<div class="ed-work">
			<section class="ed-pane ed-pane-source" aria-label="Diagram source">
				<div class="ed-pane-head"><span>Source</span><span class="ed-spacer"></span><span class="ed-pane-ext">.tt</span></div>
				<div class="ed-code" id="code">
					<pre class="ed-gutter" id="gutter" aria-hidden="true"></pre>
					<div class="ed-code-main">
						<pre class="ed-highlight" id="highlight" aria-hidden="true"></pre>
						<textarea class="ed-src" id="src" spellcheck="false" autocapitalize="off" autocomplete="off" wrap="off" aria-label="Diagram source"></textarea>
					</div>
				</div>
				<div class="ed-status" id="status"><span class="dot"></span><span id="status-text"></span></div>
			</section>
			<section class="ed-pane ed-pane-main" aria-label="Diagram and Team APIs">
				<div class="ed-tabbar" role="tablist" aria-label="View">
					<button class="ed-tab" id="tab-diagram" type="button" role="tab" aria-selected="true" aria-controls="panel-diagram">Diagram</button>
					<button class="ed-tab" id="tab-api" type="button" role="tab" aria-selected="false" aria-controls="panel-api">Team APIs</button>
					<span class="ed-spacer"></span>
					<button class="ed-btn" id="export-svg" type="button">Export SVG</button>
					<button class="ed-btn" id="export-md" type="button">Markdown</button>
					<button class="ed-btn" id="fit" type="button" aria-pressed="true" title="Scale the diagram to the pane width">Fit</button>
				</div>
				<div class="ed-panel" id="panel-diagram" role="tabpanel" aria-labelledby="tab-diagram">
					<div class="ed-canvas fit" id="canvas"></div>
					<div class="ed-panel-foot"><span id="render-status"></span><span class="ed-spacer"></span><span id="dims"></span></div>
				</div>
				<div class="ed-panel" id="panel-api" role="tabpanel" aria-labelledby="tab-api" hidden>
					<div class="ed-api-scroll"><div class="ed-api-grid" id="api-grid"></div></div>
					<div class="ed-panel-foot"><span id="api-status"></span><span class="ed-spacer"></span><span>Team API template · CC BY-SA 4.0</span></div>
				</div>
			</section>
		</div>
		<div class="toast" id="toast" role="status" aria-live="polite"></div>
	</div>`;
}

function apiCardHtml(doc: OpenedDoc | null, node: Node): string {
	const tag = doc ? 'a' : 'div';
	const href = doc ? ` href="${teamLink(doc.id, node.id, doc.fragment)}"` : '';
	const fields = node.api ? Object.entries(node.api) : [];
	const body =
		fields.length > 0
			? `<dl>${fields.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join('')}</dl>`
			: `<p class="ed-api-empty">No <span style="font-family: var(--mono)">api</span> block yet — add one in the source to document this team.</p>`;
	return `<${tag} class="ed-api-card" data-team-id="${escapeHtml(node.id)}"${href}>
		<div class="ed-api-card-head">
			<span class="ed-api-chip ${node.type}"></span>
			<h3>${escapeHtml(node.label)}</h3>
			<span class="ed-api-type">${node.type}</span>
		</div>
		${body}
	</${tag}>`;
}

export function renderEditor(
	root: HTMLElement,
	doc: OpenedDoc | null,
	opts: EditorOptions = {}
): void {
	disposers.get(root)?.();
	root.innerHTML = shell(doc);

	const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
	const src = $<HTMLTextAreaElement>('#src');
	const gutter = $('#gutter');
	const highlightEl = $('#highlight');
	const canvas = $('#canvas');
	const status = $('#status');
	const statusText = $('#status-text');
	const dims = $('#dims');
	const renderStatus = $('#render-status');
	const titleEl = $('#doc-title');
	const stateDot = $('#state-dot');
	const stateText = $('#state-text');
	const saveBtn = $<HTMLButtonElement>('#save');
	const banner = $('#banner');
	const toast = $('#toast');
	const apiGrid = $('#api-grid');
	const apiStatus = $('#api-status');
	const historyPop = $('#history-pop');
	const sharePop = $<HTMLElement>('#share-pop').querySelector<HTMLElement>('.ed-share')!;
	const tabDiagram = $<HTMLButtonElement>('#tab-diagram');
	const tabApi = $<HTMLButtonElement>('#tab-api');
	const panelDiagram = $<HTMLElement>('#panel-diagram');
	const panelApi = $<HTMLElement>('#panel-api');

	let model: Model | null = null;
	let lastError: number | null = null;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let toastTimer: ReturnType<typeof setTimeout> | undefined;
	let saving = false;
	let examplesCatalog: CatalogEntry[] | null = null;
	const copyTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

	const initial = doc
		? doc.source
		: ((opts.resetDraft ? null : readDraft()) ?? opts.starter ?? FALLBACK_STARTER);
	src.value = initial;

	const isDirty = () => (doc ? src.value !== doc.source : src.value.trim() !== '');

	function updateStatePill() {
		if (saving) {
			stateDot.dataset.tone = 'accent';
			stateText.textContent = 'Saving…';
		} else if (isDirty()) {
			delete stateDot.dataset.tone;
			stateText.textContent = 'Unsaved changes';
		} else {
			stateDot.dataset.tone = 'ok';
			stateText.textContent = 'Saved · encrypted';
		}
	}

	function updateSaveState() {
		saveBtn.disabled = saving || !isDirty();
		updateStatePill();
	}

	function updateGutter() {
		const n = src.value.split('\n').length;
		let html = '';
		for (let i = 1; i <= n; i++)
			html += `<span${i === lastError ? ' class="err"' : ''}>${i}</span>`;
		gutter.innerHTML = html;
	}

	function updateHighlight() {
		highlightEl.innerHTML = highlight(src.value);
	}

	function renderApiGrid() {
		if (!model) {
			apiGrid.innerHTML = '';
			apiStatus.textContent = '';
			return;
		}
		const teams = model.teams.filter((t) => t.type !== 'group');
		apiGrid.innerHTML = teams.map((t) => apiCardHtml(doc, t)).join('');
		apiStatus.textContent = `${teams.length} Team API page${teams.length === 1 ? '' : 's'} generated`;
	}

	function renderNow() {
		const text = src.value;
		if (!doc) writeDraft(text);
		const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
		try {
			model = parse(text);
			canvas.innerHTML = render(model, { theme: currentTheme(), idPrefix: 'ed' });
			const el = canvas.querySelector('svg');
			dims.textContent = el
				? `${Number(el.getAttribute('width')) | 0} × ${Number(el.getAttribute('height')) | 0}`
				: '';
			const teams = model.teams.length;
			const inters = model.interactions.length;
			statusText.textContent = `${teams} team${teams === 1 ? '' : 's'}, ${inters} interaction${inters === 1 ? '' : 's'} · no errors`;
			status.classList.remove('error');
			lastError = null;
			titleEl.textContent = model.title?.trim() || 'Untitled diagram';
			const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
			renderStatus.textContent = `rendered in ${Math.max(0, Math.round(t1 - t0))} ms`;
			renderApiGrid();
		} catch (e) {
			statusText.textContent = e instanceof Error ? e.message : String(e);
			status.classList.add('error');
			lastError = e instanceof ParseError ? e.line : null;
			if (!canvas.querySelector('svg')) {
				canvas.innerHTML = '<p class="empty">Fix the source to see the diagram.</p>';
			}
		}
		updateGutter();
		updateSaveState();
	}

	function scheduleRender() {
		clearTimeout(timer);
		timer = setTimeout(renderNow, RENDER_DELAY_MS);
	}

	function showToast(msg: string) {
		toast.textContent = msg;
		toast.classList.add('show');
		clearTimeout(toastTimer);
		toastTimer = setTimeout(() => toast.classList.remove('show'), TOAST_MS);
	}

	function showBanner(html: string) {
		banner.innerHTML = html;
		banner.hidden = false;
	}

	function hideBanner() {
		banner.hidden = true;
		banner.innerHTML = '';
	}

	function refreshPanels() {
		historyPop.innerHTML = historyHtml(doc);
		sharePop.innerHTML = shareHtml(doc);
	}

	async function createNew(source: string) {
		const created = await createDocument(source);
		writeDraft(null);
		history.replaceState(null, '', created.editLink);
		renderEditor(root, created.doc);
		popovers.closeAll();
		showToastOn(root, 'Saved. This page is now your edit link — copy it from Share.');
	}

	async function saveExisting(existing: OpenedDoc, source: string) {
		if (!existing.save) return;
		try {
			await existing.save(source);
			hideBanner();
			refreshPanels();
			showToast('Saved');
		} catch (err) {
			if (err instanceof ApiError && err.status === 409 && err.latest) {
				const latest: Version = err.latest;
				showBanner(
					`Someone saved a newer version (${escapeHtml(formatWhen(latest.at))}). ` +
						`<button type="button" class="link" id="reload">Reload</button> to see it, or ` +
						`<button type="button" class="link" id="save-anyway">save anyway</button> and overwrite it.`
				);
				banner.querySelector('#reload')?.addEventListener('click', () => location.reload());
				banner.querySelector('#save-anyway')?.addEventListener('click', () => {
					existing.version = latest;
					void doSave();
				});
				return;
			}
			throw err;
		}
	}

	async function doSave() {
		if (saving || !isDirty()) return;
		saving = true;
		updateSaveState();
		const source = src.value;
		try {
			if (doc) await saveExisting(doc, source);
			else await createNew(source);
		} catch (err) {
			showToast(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
		} finally {
			saving = false;
			if (root.contains(saveBtn)) updateSaveState();
		}
	}

	function selectTab(tab: 'diagram' | 'api') {
		const showDiagram = tab === 'diagram';
		tabDiagram.setAttribute('aria-selected', String(showDiagram));
		tabApi.setAttribute('aria-selected', String(!showDiagram));
		panelDiagram.hidden = !showDiagram;
		panelApi.hidden = showDiagram;
	}

	tabDiagram.addEventListener('click', () => selectTab('diagram'));
	tabApi.addEventListener('click', () => selectTab('api'));

	src.addEventListener('input', () => {
		updateHighlight();
		updateGutter();
		updateSaveState();
		scheduleRender();
	});

	src.addEventListener('keydown', (e) => {
		if (e.key === 'Tab') {
			e.preventDefault();
			const { selectionStart: s, selectionEnd: t, value } = src;
			const lineStart = value.lastIndexOf('\n', s - 1) + 1;
			let lineEnd = value.indexOf('\n', lineStart);
			if (lineEnd === -1) lineEnd = value.length;
			if (e.shiftKey) {
				const line = value.slice(lineStart, lineEnd);
				const m = /^ {1,2}/.exec(line);
				if (m) {
					const removed = m[0].length;
					src.setRangeText('', lineStart, lineStart + removed, 'end');
					src.selectionStart = Math.max(lineStart, s - removed);
					src.selectionEnd = Math.max(lineStart, t - removed);
				}
			} else {
				src.setRangeText('  ', s, t, 'end');
			}
			src.dispatchEvent(new Event('input'));
			return;
		}
		if ((e.metaKey || e.ctrlKey) && e.key === 's') {
			e.preventDefault();
			void doSave();
		}
	});

	$('#fit').addEventListener('click', (e) => {
		const btn = e.currentTarget as HTMLButtonElement;
		const on = btn.getAttribute('aria-pressed') !== 'true';
		btn.setAttribute('aria-pressed', String(on));
		canvas.classList.toggle('fit', on);
	});

	$('#export-svg').addEventListener('click', () => {
		if (!model) return showToast('Nothing to export yet');
		const svg = render(model, { theme: currentTheme() });
		triggerDownload(
			`${sanitizeFilename(model.title || 'Untitled diagram')}.svg`,
			svg,
			'image/svg+xml'
		);
	});

	$('#export-md').addEventListener('click', () => {
		if (!model) return showToast('Nothing to export yet');
		const teams = model.teams.filter((t) => t.type !== 'group');
		const md = teams.map((t) => teamApi(model as Model, t.id)).join('\n\n---\n\n');
		triggerDownload(
			`${sanitizeFilename(model.title || 'Untitled diagram')}-team-apis.md`,
			md,
			'text/markdown'
		);
	});

	saveBtn.addEventListener('click', () => void doSave());

	async function handleCopyClick(btn: HTMLButtonElement) {
		const sel = btn.dataset.copy;
		const input = sel ? root.querySelector<HTMLInputElement>(sel) : null;
		if (!input) return;
		try {
			await navigator.clipboard.writeText(input.value);
			const original = btn.dataset.label ?? btn.textContent ?? 'Copy';
			btn.dataset.label = original;
			btn.textContent = 'Copied';
			clearTimeout(copyTimers.get(btn));
			copyTimers.set(
				btn,
				setTimeout(() => {
					btn.textContent = original;
				}, COPY_FEEDBACK_MS)
			);
		} catch {
			showToast('Clipboard blocked. Select and copy manually.');
		}
	}

	root.addEventListener('click', (e) => {
		const target = e.target as Element | null;
		const copyBtn = target?.closest<HTMLButtonElement>('[data-copy]');
		if (copyBtn) {
			void handleCopyClick(copyBtn);
			return;
		}
		const exampleBtn = target?.closest<HTMLElement>('[data-example-index]');
		if (exampleBtn && examplesCatalog) {
			const entry = examplesCatalog[Number(exampleBtn.dataset.exampleIndex)];
			if (entry) {
				src.value = entry.source;
				src.dispatchEvent(new Event('input'));
				renderNow();
				popovers.closeAll();
			}
			return;
		}
	});

	canvas.addEventListener('click', (e) => {
		const g = (e.target as Element | null)?.closest<SVGElement>('.tt-node, .tt-frame');
		const id = g?.getAttribute('data-id');
		if (!id || !model) return;
		const node = model.index[id];
		if (!node || node.type === 'group') return;
		if (!doc) return showToast('Save the diagram first to open team pages');
		navigate(teamLink(doc.id, id, doc.fragment));
	});

	const popoverEntries = [
		{ button: $<HTMLButtonElement>('#history-btn'), panel: $<HTMLElement>('#history-pop') },
		{ button: $<HTMLButtonElement>('#share-btn'), panel: $<HTMLElement>('#share-pop') }
	];
	const examplesBtn = root.querySelector<HTMLButtonElement>('#examples-btn');
	const examplesPop = root.querySelector<HTMLElement>('#examples-pop');
	if (examplesBtn && examplesPop)
		popoverEntries.unshift({ button: examplesBtn, panel: examplesPop });
	const popovers: PopoverController = setupPopovers($('#backdrop'), popoverEntries);

	if (doc === null) {
		void loadCatalog()
			.then((entries) => {
				examplesCatalog = entries;
				const list = root.querySelector('#examples-list');
				if (!list) return;
				list.innerHTML = entries
					.map(
						(e, i) =>
							`<li><button type="button" class="ed-pop-item" data-example-index="${i}">${escapeHtml(e.title)}</button></li>`
					)
					.join('');
			})
			.catch(() => {
				const list = root.querySelector('#examples-list');
				if (list) list.innerHTML = '<p class="ed-pop-empty">Examples could not be loaded.</p>';
			});
	}

	const media =
		typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
	media?.addEventListener('change', renderNow);
	disposers.set(root, () => {
		clearTimeout(timer);
		clearTimeout(toastTimer);
		media?.removeEventListener('change', renderNow);
		popovers.dispose();
	});

	updateHighlight();
	selectTab('diagram');
	renderNow();
}

function triggerDownload(filename: string, content: string, type: string): void {
	const blob = new Blob([content], { type });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	a.remove();
	URL.revokeObjectURL(url);
}

/** Toast on a freshly re-rendered editor (after `renderEditor` replaced the DOM). */
function showToastOn(root: HTMLElement, msg: string) {
	const toast = root.querySelector('#toast');
	if (!toast) return;
	toast.textContent = msg;
	toast.classList.add('show');
	setTimeout(() => toast.classList.remove('show'), TOAST_MS * 2);
}
