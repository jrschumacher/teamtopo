/**
 * Editor view: textarea + line gutter, debounced live render, share links, versions,
 * stale-save handling. Ported from src/playground.html. `doc === null` is `/new`.
 */

import { parse, ParseError, render, type Model } from '@lib/teamtopo';
import { ApiError } from '../lib/api';
import { createDocument } from '../lib/doc';
import { teamLink, versionLink } from '../lib/links';
import { escapeHtml } from '../lib/markdown';
import type { OpenedDoc, Version } from '../lib/types';
import { navigate } from '../router';

export const DRAFT_KEY = 'teamtopo.draft';
const RENDER_DELAY_MS = 120;
const TOAST_MS = 1800;
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

function versionsHtml(doc: OpenedDoc | null): string {
	if (!doc || doc.versions.length === 0) return '<p class="muted">No saved versions yet.</p>';
	const items = doc.versions
		.map((v) => {
			const current = doc.version?.id === v.id;
			const label = `${escapeHtml(formatWhen(v.at))} · ${v.size} B`;
			return `<li><a href="${versionLink(doc.id, v.id, doc.fragment)}">${label}</a>${
				current ? ' <span class="tag">latest</span>' : ''
			}</li>`;
		})
		.join('');
	return `<ol class="versions" id="versions">${items}</ol>`;
}

function absolute(link: string): string {
	return `${location.origin}${link}`;
}

function shareHtml(doc: OpenedDoc | null): string {
	if (!doc) {
		return '<p class="muted">Save to get a view link and an edit link.</p>';
	}
	const view = escapeHtml(absolute(doc.links.view));
	const edit = doc.links.edit ? escapeHtml(absolute(doc.links.edit)) : '';
	return `
		<label class="share-row">View link (read-only)
			<span class="share-input"><input readonly id="view-link" value="${view}"><button type="button" class="btn" data-copy="#view-link">Copy</button></span>
		</label>
		${
			edit
				? `<label class="share-row">Edit link
			<span class="share-input"><input readonly id="edit-link" value="${edit}"><button type="button" class="btn" data-copy="#edit-link">Copy</button></span>
		</label>
		<p class="warn">Anyone with the edit link can change this diagram. Share the view link unless you mean to grant write access.</p>`
				: ''
		}`;
}

function shell(doc: OpenedDoc | null): string {
	return `
	<header class="bar">
		<div class="brand"><a href="/">teamtopo</a><span class="muted">${doc ? 'Editing' : 'New diagram'}</span></div>
		<div class="controls">
			<button class="btn" id="fit" type="button" aria-pressed="true" title="Scale the diagram to the pane width">Fit</button>
			<button class="btn" id="copy-svg" type="button">Copy SVG</button>
			<button class="btn primary" id="save" type="button" disabled>${doc ? 'Save' : 'Save & get links'}</button>
		</div>
	</header>
	<div class="banner" id="banner" role="status" hidden></div>
	<main class="work">
		<section class="pane editor-pane" aria-label="Diagram source">
			<div class="pane-head"><span>Source</span><span class="spacer"></span><span id="saved-state" class="muted"></span></div>
			<div class="code">
				<div class="gutter" id="gutter" aria-hidden="true"></div>
				<textarea class="src" id="src" spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="Diagram source"></textarea>
			</div>
			<div class="status" id="status"><span class="dot"></span><span id="status-text">Ready</span></div>
		</section>
		<section class="pane preview" aria-label="Rendered diagram">
			<div class="pane-head"><span>Diagram</span><span class="spacer"></span><span id="dims"></span></div>
			<div class="canvas fit" id="canvas"></div>
			<details class="panel" id="share-panel"><summary>Share</summary><div class="panel-body" id="share-body">${shareHtml(doc)}</div></details>
			<details class="panel" id="versions-panel"><summary>Versions</summary><div class="panel-body" id="versions-body">${versionsHtml(doc)}</div></details>
		</section>
	</main>
	<div class="toast" id="toast" role="status" aria-live="polite"></div>`;
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
	const canvas = $('#canvas');
	const status = $('#status');
	const statusText = $('#status-text');
	const dims = $('#dims');
	const saveBtn = $<HTMLButtonElement>('#save');
	const savedState = $('#saved-state');
	const banner = $('#banner');
	const toast = $('#toast');

	let model: Model | null = null;
	let lastError: number | null = null;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let toastTimer: ReturnType<typeof setTimeout> | undefined;
	let saving = false;

	const initial = doc
		? doc.source
		: ((opts.resetDraft ? null : readDraft()) ?? opts.starter ?? FALLBACK_STARTER);
	src.value = initial;

	const isDirty = () => (doc ? src.value !== doc.source : src.value.trim() !== '');

	function updateSaveState() {
		saveBtn.disabled = saving || !isDirty();
		if (doc) savedState.textContent = isDirty() ? 'Unsaved changes' : 'Saved';
		else savedState.textContent = 'Not saved yet';
	}

	function updateGutter() {
		const n = src.value.split('\n').length;
		let html = '';
		for (let i = 1; i <= n; i++)
			html += `<span${i === lastError ? ' class="err"' : ''}>${i}</span>`;
		gutter.innerHTML = html;
		gutter.scrollTop = src.scrollTop;
	}

	function renderNow() {
		const text = src.value;
		if (!doc) writeDraft(text);
		try {
			model = parse(text);
			canvas.innerHTML = render(model, { theme: currentTheme(), idPrefix: 'ed' });
			const el = canvas.querySelector('svg');
			dims.textContent = el
				? `${Number(el.getAttribute('width')) | 0} × ${Number(el.getAttribute('height')) | 0}`
				: '';
			const teams = model.teams.length;
			const inters = model.interactions.length;
			statusText.textContent = `${teams} team${teams === 1 ? '' : 's'}, ${inters} interaction${inters === 1 ? '' : 's'}`;
			status.classList.remove('error');
			lastError = null;
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

	async function copyText(text: string, done: string) {
		try {
			await navigator.clipboard.writeText(text);
			showToast(done);
		} catch {
			showToast('Clipboard blocked. Select and copy manually.');
		}
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
		$('#share-body').innerHTML = shareHtml(doc);
		$('#versions-body').innerHTML = versionsHtml(doc);
	}

	async function createNew(source: string) {
		const created = await createDocument(source);
		writeDraft(null);
		history.replaceState(null, '', created.editLink);
		renderEditor(root, created.doc);
		const share = root.querySelector<HTMLDetailsElement>('#share-panel');
		if (share) share.open = true;
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
		savedState.textContent = 'Saving…';
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

	src.addEventListener('input', () => {
		updateGutter();
		updateSaveState();
		scheduleRender();
	});
	src.addEventListener('scroll', () => {
		gutter.scrollTop = src.scrollTop;
	});
	src.addEventListener('keydown', (e) => {
		if (e.key === 'Tab') {
			e.preventDefault();
			const { selectionStart: s, selectionEnd: t } = src;
			src.setRangeText('  ', s, t, 'end');
			src.dispatchEvent(new Event('input'));
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

	$('#copy-svg').addEventListener('click', () => {
		if (!model) return showToast('Nothing to copy yet');
		void copyText(render(model, { theme: currentTheme() }), 'SVG copied');
	});

	saveBtn.addEventListener('click', () => void doSave());

	root.addEventListener('click', (e) => {
		const btn = (e.target as Element | null)?.closest<HTMLElement>('[data-copy]');
		if (!btn) return;
		const input = root.querySelector<HTMLInputElement>(btn.dataset.copy ?? '');
		if (input) void copyText(input.value, 'Link copied');
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

	const media =
		typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
	media?.addEventListener('change', renderNow);
	disposers.set(root, () => {
		clearTimeout(timer);
		clearTimeout(toastTimer);
		media?.removeEventListener('change', renderNow);
	});

	renderNow();
}

/** Toast on a freshly re-rendered editor (after `renderEditor` replaced the DOM). */
function showToastOn(root: HTMLElement, msg: string) {
	const toast = root.querySelector('#toast');
	if (!toast) return;
	toast.textContent = msg;
	toast.classList.add('show');
	setTimeout(() => toast.classList.remove('show'), TOAST_MS * 2);
}
