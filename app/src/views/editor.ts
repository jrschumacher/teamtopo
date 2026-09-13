/**
 * Editor view: source pane with syntax highlighting + line gutter, debounced live
 * render, a Diagram/Team APIs tab bar, header popovers (Examples, History, Share),
 * explicit Save with the stale-409 reload/save-anyway flow, and /new draft persistence.
 * The workspace chrome — a draggable divider, editor-only/split/diagram-only modes and
 * the renderer's zoom/fit/pan viewport — is state from `lib/workspace.ts` wired to the DOM
 * here. Element ids and classes are a contract with the visual design
 * (docs/editor-design.md); keep them stable. Ported from src/playground.html, then
 * restyled.
 */

import { parse, ParseError, render, teamApi, type Model, type Node } from '@lib/teamtopo';
import { ApiError } from '../lib/api';
import { brandMarkHtml, pageTitle } from '../lib/brand';
import { createDocument } from '../lib/doc';
import { highlight, type HighlightError } from '../lib/highlight';
import { teamLink, versionLink } from '../lib/links';
import { escapeHtml } from '../lib/markdown';
import { setupPopovers, type PopoverController } from '../lib/popover';
import type { OpenedDoc, Version } from '../lib/types';
import {
	clampRatio,
	clampZoom,
	DEFAULT_RATIO,
	fitZoom,
	formatZoom,
	MAX_ZOOM,
	MIN_PANE_PX,
	MIN_PANE_STACKED_PX,
	MIN_ZOOM,
	naturalSize,
	nextZoom,
	prevZoom,
	readWorkspace,
	writeWorkspace,
	type PaneMode,
	type Size
} from '../lib/workspace';
import { navigate } from '../router';
import { loadCatalog, type CatalogEntry } from './landing';
import './editor.css';

export const DRAFT_KEY = 'teamtopo.draft';
const RENDER_DELAY_MS = 120;
/** Matches `.ed-src`/`.ed-highlight` line-height in editor.css. */
const LINE_HEIGHT_PX = 20;
/** Matches `.ed-canvas` padding in editor.css — the diagram's usable viewport inset. */
const CANVAS_PAD_PX = 24;
/** Matches the `max-width` of the stacked-workspace media query in editor.css. */
const NARROW_QUERY = '(max-width: 56rem)';
/** Pointer travel before a press on the canvas becomes a pan instead of a click. */
const PAN_THRESHOLD_PX = 4;
/** Wheel delta that doubles/halves the zoom, for ctrl/⌘-wheel and trackpad pinch. */
const WHEEL_ZOOM_DIVISOR = 180;
/** Divider step per arrow key, as a fraction of the workspace (Shift takes bigger steps). */
const RATIO_STEP = 0.02;
const RATIO_STEP_COARSE = 0.1;
const TOAST_MS = 1800;
const COPY_FEEDBACK_MS = 1400;
const PANE_MODES: PaneMode[] = ['editor', 'split', 'renderer'];
const PANE_LABELS: Record<PaneMode, string> = {
	editor: 'Editor only',
	split: 'Split view',
	renderer: 'Diagram only'
};
/** 16×12 glyphs: the workspace outline with the visible pane(s) filled. */
const PANE_ICONS: Record<PaneMode, string> = {
	editor: '<rect class="on" x="2" y="2" width="5" height="8"/>',
	split: '<path d="M8 1.5v9"/>',
	renderer: '<rect class="on" x="9" y="2" width="5" height="8"/>'
};
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

/** The always-visible editor-only / split / diagram-only switch. */
function paneSwitchHtml(): string {
	const buttons = PANE_MODES.map(
		(mode) => `<button class="ed-pane-btn" id="pane-${mode}" type="button"
				aria-pressed="${mode === 'split'}" title="${PANE_LABELS[mode]}" aria-label="${PANE_LABELS[mode]}"
				><svg viewBox="0 0 16 12" aria-hidden="true" focusable="false"><rect x="1.5" y="1.5" width="13" height="9" rx="1.5"/>${PANE_ICONS[mode]}</svg></button>`
	).join('');
	return `<div class="ed-panes" role="group" aria-label="Workspace layout">${buttons}</div>`;
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
		${paneSwitchHtml()}
		<span class="ed-divider"></span>
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
		<div class="ed-work" id="work" data-pane-mode="split">
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
			<div class="ed-split" id="split" role="separator" tabindex="0" aria-orientation="vertical"
				aria-label="Resize the source and diagram panes" title="Drag to resize · double-click to reset"
				aria-valuemin="0" aria-valuemax="100" aria-valuenow="40"></div>
			<section class="ed-pane ed-pane-main" aria-label="Diagram and Team APIs">
				<div class="ed-tabbar" role="tablist" aria-label="View">
					<button class="ed-tab" id="tab-diagram" type="button" role="tab" aria-selected="true" aria-controls="panel-diagram">Diagram</button>
					<button class="ed-tab" id="tab-api" type="button" role="tab" aria-selected="false" aria-controls="panel-api">Team APIs</button>
					<span class="ed-spacer"></span>
					<button class="ed-btn" id="export-svg" type="button">Export SVG</button>
					<button class="ed-btn" id="export-md" type="button">Markdown</button>
					<div class="ed-zoom" role="group" aria-label="Diagram zoom and fit">
						<button class="ed-btn ed-zoom-step" id="zoom-out" type="button" aria-label="Zoom out" title="Zoom out">−</button>
						<button class="ed-btn ed-zoom-reset" id="zoom-reset" type="button" title="Reset zoom to 100%"><span id="zoom-level">100%</span></button>
						<button class="ed-btn ed-zoom-step" id="zoom-in" type="button" aria-label="Zoom in" title="Zoom in">+</button>
						<button class="ed-btn" id="fit" type="button" aria-pressed="true" title="Fit the whole diagram in view">Fit</button>
					</div>
				</div>
				<div class="ed-panel" id="panel-diagram" role="tabpanel" aria-labelledby="tab-diagram">
					<div class="ed-canvas ed-canvas-zoom" id="canvas" role="group" tabindex="0"
						aria-label="Diagram viewport — drag to pan, ctrl+wheel to zoom, +/−/0/F for zoom in, out, 100% and fit"></div>
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
	document.title = pageTitle();
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
	const work = $('#work');
	const splitter = $('#split');
	const sourcePane = $('.ed-pane-source');
	const mainPane = $('.ed-pane-main');
	const paneButtons = Object.fromEntries(
		PANE_MODES.map((m) => [m, $<HTMLButtonElement>(`#pane-${m}`)])
	) as Record<PaneMode, HTMLButtonElement>;
	const zoomIn = $<HTMLButtonElement>('#zoom-in');
	const zoomOut = $<HTMLButtonElement>('#zoom-out');
	const zoomReset = $<HTMLButtonElement>('#zoom-reset');
	const zoomLevel = $('#zoom-level');
	const fitBtn = $<HTMLButtonElement>('#fit');

	let model: Model | null = null;
	let lastError: number | null = null;
	let lastErrorMessage: string | null = null;
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
		const error: HighlightError | null =
			lastError != null && lastErrorMessage != null
				? { line: lastError, message: lastErrorMessage }
				: null;
		highlightEl.innerHTML = highlight(src.value, error);
	}

	/** Toggle whether the status strip behaves like a clickable "jump to error" control. */
	function setStatusJumpable(on: boolean) {
		if (on) {
			status.setAttribute('role', 'button');
			status.setAttribute('tabindex', '0');
		} else {
			status.removeAttribute('role');
			status.removeAttribute('tabindex');
		}
	}

	function jumpToError() {
		if (lastError == null) return;
		const lines = src.value.split('\n');
		const idx = Math.min(lastError - 1, lines.length - 1);
		let offset = 0;
		for (let i = 0; i < idx; i++) offset += lines[i].length + 1;
		src.focus();
		src.setSelectionRange(offset, offset);
		src.scrollTop = Math.max(0, idx * LINE_HEIGHT_PX);
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

	// ── workspace: pane split + renderer viewport ──────────────────────────────
	const ws = readWorkspace();
	const narrow = typeof matchMedia === 'function' ? matchMedia(NARROW_QUERY) : null;
	let drag: { pointerId: number } | null = null;
	let pan: { pointerId: number; x: number; y: number; left: number; top: number } | null = null;
	let panned = false;
	let syncing = false;

	const persist = () => writeWorkspace(ws);
	/** The workspace stacks its panes below `NARROW_QUERY`; the divider follows. */
	const stacked = () => narrow?.matches === true;
	const workExtent = () => (stacked() ? work.clientHeight : work.clientWidth);
	const minPane = () => (stacked() ? MIN_PANE_STACKED_PX : MIN_PANE_PX);
	const currentSvg = () => canvas.querySelector('svg');

	/** Usable viewport inside the canvas' padding, or `null` while it has no layout. */
	function viewportSize(): Size | null {
		const w = canvas.clientWidth - 2 * CANVAS_PAD_PX;
		const h = canvas.clientHeight - 2 * CANVAS_PAD_PX;
		return w > 0 && h > 0 ? { w, h } : null;
	}

	const canPan = () =>
		canvas.scrollWidth > canvas.clientWidth || canvas.scrollHeight > canvas.clientHeight;

	/**
	 * Scale the rendered SVG by its `width`/`height` attributes only — the `viewBox` stays
	 * as rendered, so every zoom level is drawn from vectors rather than scaled pixels.
	 */
	function applyZoomToSvg() {
		const svg = currentSvg();
		const natural = naturalSize(svg);
		if (!svg || !natural) return;
		svg.setAttribute('width', String(Math.round(natural.w * ws.zoom)));
		svg.setAttribute('height', String(Math.round(natural.h * ws.zoom)));
	}

	function updateViewportControls() {
		zoomLevel.textContent = formatZoom(ws.zoom);
		zoomReset.setAttribute('aria-label', `Zoom ${formatZoom(ws.zoom)}, reset to 100%`);
		zoomIn.disabled = ws.zoom >= MAX_ZOOM;
		zoomOut.disabled = ws.zoom <= MIN_ZOOM;
		fitBtn.setAttribute('aria-pressed', String(ws.fit));
		canvas.classList.toggle('can-pan', canPan());
	}

	/** Re-fit (when fit is on) and re-apply the zoom after anything changed the viewport. */
	function syncViewport() {
		if (syncing) return;
		syncing = true;
		try {
			if (ws.fit) {
				const fitted = fitZoom(naturalSize(currentSvg()), viewportSize());
				if (fitted !== null) ws.zoom = fitted;
			}
			applyZoomToSvg();
			updateViewportControls();
		} finally {
			syncing = false;
		}
	}

	/** Keep the content under `client` (a viewport point) still while the scale changes. */
	function keepAnchored(client: { x: number; y: number }, from: number, to: number) {
		if (!(from > 0) || !(to > 0)) return;
		const rect = canvas.getBoundingClientRect();
		const x = client.x - rect.left;
		const y = client.y - rect.top;
		const k = to / from;
		canvas.scrollLeft = (canvas.scrollLeft + x) * k - x;
		canvas.scrollTop = (canvas.scrollTop + y) * k - y;
	}

	function setZoom(zoom: number, anchor?: { x: number; y: number }) {
		const from = ws.zoom;
		ws.zoom = clampZoom(zoom);
		ws.fit = false;
		applyZoomToSvg();
		if (anchor) keepAnchored(anchor, from, ws.zoom);
		updateViewportControls();
		persist();
	}

	/** Fit the whole diagram in the viewport and keep it fitted as the viewport changes. */
	function applyFit() {
		ws.fit = true;
		canvas.scrollLeft = 0;
		canvas.scrollTop = 0;
		syncViewport();
		persist();
	}

	function setRatio(ratio: number) {
		ws.ratio = clampRatio(ratio, workExtent(), minPane());
		work.style.setProperty('--ed-split', `${(ws.ratio * 100).toFixed(2)}%`);
		splitter.setAttribute('aria-valuenow', String(Math.round(ws.ratio * 100)));
		syncViewport();
	}

	function applyLayout() {
		work.dataset.paneMode = ws.mode;
		for (const mode of PANE_MODES)
			paneButtons[mode].setAttribute('aria-pressed', String(ws.mode === mode));
		const extent = workExtent();
		splitter.setAttribute('aria-orientation', stacked() ? 'horizontal' : 'vertical');
		splitter.setAttribute(
			'aria-valuemin',
			String(Math.round(clampRatio(0, extent, minPane()) * 100))
		);
		splitter.setAttribute(
			'aria-valuemax',
			String(Math.round(clampRatio(1, extent, minPane()) * 100))
		);
		setRatio(ws.ratio);
	}

	/** Switch panes, never leaving focus stranded inside the pane that just went away. */
	function setPaneMode(mode: PaneMode, from?: HTMLElement) {
		const hiding = mode === 'editor' ? mainPane : mode === 'renderer' ? sourcePane : null;
		const strands =
			hiding !== null &&
			document.activeElement instanceof HTMLElement &&
			hiding.contains(document.activeElement);
		ws.mode = mode;
		applyLayout();
		persist();
		if (strands) (from ?? paneButtons[mode]).focus();
	}

	function renderNow() {
		const text = src.value;
		if (!doc) writeDraft(text);
		const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
		try {
			model = parse(text);
			canvas.innerHTML = render(model, { theme: currentTheme(), idPrefix: 'ed' });
			const natural = naturalSize(canvas.querySelector('svg'));
			dims.textContent = natural ? `${natural.w | 0} × ${natural.h | 0}` : '';
			const teams = model.teams.length;
			const inters = model.interactions.length;
			statusText.textContent = `${teams} team${teams === 1 ? '' : 's'}, ${inters} interaction${inters === 1 ? '' : 's'} · no errors`;
			status.classList.remove('error');
			setStatusJumpable(false);
			lastError = null;
			lastErrorMessage = null;
			titleEl.textContent = model.title?.trim() || 'Untitled diagram';
			document.title = pageTitle(model.title);
			const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
			renderStatus.textContent = `rendered in ${Math.max(0, Math.round(t1 - t0))} ms`;
			renderApiGrid();
		} catch (e) {
			const parseErr = e instanceof ParseError ? e : null;
			statusText.textContent = e instanceof Error ? e.message : String(e);
			status.classList.add('error');
			lastError = parseErr ? parseErr.line : null;
			lastErrorMessage = parseErr ? parseErr.message : null;
			setStatusJumpable(parseErr != null);
			const hasLastGoodRender = canvas.querySelector('svg') != null;
			if (hasLastGoodRender) {
				renderStatus.textContent = parseErr
					? `showing last good render · fix line ${parseErr.line}`
					: 'showing last good render';
			} else {
				renderStatus.textContent = 'Fix the source to see the diagram.';
				canvas.innerHTML = '<p class="empty">Fix the source to see the diagram.</p>';
			}
		}
		syncViewport();
		updateGutter();
		updateHighlight();
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
		// The diagram pane had no layout while hidden: re-fit now that it does.
		if (showDiagram) syncViewport();
	}

	status.addEventListener('click', jumpToError);
	status.addEventListener('keydown', (e) => {
		if (e.key !== 'Enter' && e.key !== ' ') return;
		e.preventDefault();
		jumpToError();
	});

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

	// ── pane controls ──────────────────────────────────────────────────────────
	for (const mode of PANE_MODES)
		paneButtons[mode].addEventListener('click', () => setPaneMode(mode, paneButtons[mode]));

	splitter.addEventListener('pointerdown', (e) => {
		if (e.button !== 0) return;
		e.preventDefault();
		drag = { pointerId: e.pointerId };
		splitter.classList.add('is-dragging');
		try {
			splitter.setPointerCapture(e.pointerId);
		} catch {
			// pointer capture is a nicety; the document listeners below still end the drag
		}
	});

	function moveDivider(e: PointerEvent) {
		if (!drag) return;
		const extent = workExtent();
		if (extent <= 0) return;
		const rect = work.getBoundingClientRect();
		const pos = stacked() ? e.clientY - rect.top : e.clientX - rect.left;
		setRatio(pos / extent);
	}

	function endDrag() {
		if (!drag) return;
		try {
			splitter.releasePointerCapture(drag.pointerId);
		} catch {
			// already released
		}
		drag = null;
		splitter.classList.remove('is-dragging');
		persist();
	}

	splitter.addEventListener('pointermove', moveDivider);
	splitter.addEventListener('pointerup', endDrag);
	splitter.addEventListener('pointercancel', endDrag);
	splitter.addEventListener('dblclick', () => {
		setRatio(DEFAULT_RATIO);
		persist();
	});

	splitter.addEventListener('keydown', (e) => {
		const [less, more] = stacked() ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight'];
		const step = e.shiftKey ? RATIO_STEP_COARSE : RATIO_STEP;
		let next: number | null = null;
		if (e.key === less) next = ws.ratio - step;
		else if (e.key === more) next = ws.ratio + step;
		else if (e.key === 'Home') next = 0;
		else if (e.key === 'End') next = 1;
		else if (e.key === 'Enter' || e.key === ' ') next = DEFAULT_RATIO;
		if (next === null) return;
		e.preventDefault();
		setRatio(next);
		persist();
	});

	// ── renderer viewport ──────────────────────────────────────────────────────
	zoomIn.addEventListener('click', () => setZoom(nextZoom(ws.zoom)));
	zoomOut.addEventListener('click', () => setZoom(prevZoom(ws.zoom)));
	zoomReset.addEventListener('click', () => setZoom(1));
	fitBtn.addEventListener('click', () => {
		if (ws.fit) {
			// Stop tracking the viewport but stay at the scale the user is looking at.
			ws.fit = false;
			updateViewportControls();
			persist();
			return;
		}
		applyFit();
	});

	canvas.addEventListener(
		'wheel',
		(e) => {
			// Plain wheel scrolls (pans) the viewport; ctrl/⌘ — and trackpad pinch — zooms.
			if (!e.ctrlKey && !e.metaKey) return;
			e.preventDefault();
			setZoom(ws.zoom * Math.exp(-e.deltaY / WHEEL_ZOOM_DIVISOR), { x: e.clientX, y: e.clientY });
		},
		{ passive: false }
	);

	canvas.addEventListener('keydown', (e) => {
		if (e.ctrlKey || e.metaKey || e.altKey) return;
		if (e.key === '+' || e.key === '=') setZoom(nextZoom(ws.zoom));
		else if (e.key === '-' || e.key === '_') setZoom(prevZoom(ws.zoom));
		else if (e.key === '0') setZoom(1);
		else if (e.key === 'f' || e.key === 'F') applyFit();
		else return;
		e.preventDefault();
	});

	canvas.addEventListener('pointerdown', (e) => {
		panned = false;
		if (e.button !== 0 || !canPan()) return;
		pan = {
			pointerId: e.pointerId,
			x: e.clientX,
			y: e.clientY,
			left: canvas.scrollLeft,
			top: canvas.scrollTop
		};
	});

	canvas.addEventListener('pointermove', (e) => {
		if (!pan) return;
		const dx = e.clientX - pan.x;
		const dy = e.clientY - pan.y;
		if (!panned) {
			if (dx * dx + dy * dy < PAN_THRESHOLD_PX * PAN_THRESHOLD_PX) return;
			panned = true;
			canvas.classList.add('is-panning');
			try {
				canvas.setPointerCapture(pan.pointerId);
			} catch {
				// pointer capture is a nicety; panning still tracks moves over the canvas
			}
		}
		e.preventDefault();
		canvas.scrollLeft = pan.left - dx;
		canvas.scrollTop = pan.top - dy;
	});

	function endPan() {
		if (!pan) return;
		try {
			canvas.releasePointerCapture(pan.pointerId);
		} catch {
			// already released
		}
		pan = null;
		canvas.classList.remove('is-panning');
	}

	canvas.addEventListener('pointerup', endPan);
	canvas.addEventListener('pointercancel', endPan);

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
		if (panned) {
			// The press was a pan, not a pick.
			panned = false;
			return;
		}
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

	// Any viewport change — divider drag, pane mode, window resize, the pane stacking at
	// narrow widths — re-fits the diagram so the layout is never left stale or clipped.
	const onViewportChange = () => applyLayout();
	const observer =
		typeof ResizeObserver === 'function' ? new ResizeObserver(onViewportChange) : null;
	observer?.observe(canvas);
	addEventListener('resize', onViewportChange);
	narrow?.addEventListener('change', onViewportChange);

	disposers.set(root, () => {
		clearTimeout(timer);
		clearTimeout(toastTimer);
		media?.removeEventListener('change', renderNow);
		observer?.disconnect();
		removeEventListener('resize', onViewportChange);
		narrow?.removeEventListener('change', onViewportChange);
		popovers.dispose();
	});

	updateHighlight();
	selectTab('diagram');
	applyLayout();
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
