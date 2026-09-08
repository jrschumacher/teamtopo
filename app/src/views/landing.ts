/**
 * Landing page: nav, hero with a live typing demo of the catalog, feature cards, the "free"
 * section with the email signup, and a footer. Element ids and classes are a contract with
 * the visual design (docs/landing-design.md); keep them stable.
 */
import { render, teamApi } from '@lib/teamtopo';
import { countInteractions, countTeams, highlight } from '../lib/highlight';
import { escapeHtml } from '../lib/markdown';
import { mountWebAnalytics, webAnalyticsToken } from '../lib/webAnalytics';
import { footerHtml, navHtml } from './chrome';
import { renderSignup } from './subscribe';
import './landing.css';

export interface CatalogEntry {
	name: string;
	title: string;
	source: string;
}

type Theme = 'light' | 'dark';

/** Characters typed per tick and the tick interval; together they set the typing speed. */
const CHARS_PER_TICK = 3;
const TICK_MS = 24;
/** How long a finished diagram stays on screen before the demo moves to the next example. */
const HOLD_MS = 5000;

const disposers = new WeakMap<HTMLElement, () => void>();

export function renderLanding(root: HTMLElement): void {
	disposers.get(root)?.();
	document.title = 'teamtopo';
	root.innerHTML = shell();
	mountWebAnalytics(webAnalyticsToken());

	let live = true;
	const cleanups: (() => void)[] = [() => (live = false)];
	disposers.set(root, () => {
		for (const fn of cleanups.splice(0)) fn();
	});

	const signup = root.querySelector<HTMLElement>('#signup');
	if (signup) renderSignup(signup);

	void loadCatalog().then(
		(catalog) => {
			if (!live) return;
			if (catalog.length === 0) {
				setDemoMessage(root, 'No examples found.');
				return;
			}
			cleanups.push(startDemo(root, catalog));
			fillTeamApiSnippet(root, catalog);
		},
		() => setDemoMessage(root, 'The example catalog could not be loaded.')
	);
}

export async function loadCatalog(): Promise<CatalogEntry[]> {
	const res = await fetch('/catalog.json');
	if (!res.ok) throw new Error(`catalog.json: ${res.status}`);
	const data: unknown = await res.json();
	if (!Array.isArray(data)) throw new Error('catalog.json: not an array');
	return data.filter(isCatalogEntry);
}

function isCatalogEntry(x: unknown): x is CatalogEntry {
	if (typeof x !== 'object' || x === null) return false;
	const e = x as Record<string, unknown>;
	return typeof e.name === 'string' && typeof e.title === 'string' && typeof e.source === 'string';
}

// ---------------------------------------------------------------------------
// Hero demo

interface DemoState {
	index: number;
	typed: number;
	paused: boolean;
	hovering: boolean;
	timer: ReturnType<typeof setTimeout> | null;
	lastGoodSvg: string;
}

function startDemo(root: HTMLElement, catalog: CatalogEntry[]): () => void {
	const sourceEl = root.querySelector<HTMLElement>('#hero-source');
	const gutterEl = root.querySelector<HTMLElement>('#hero-gutter');
	const diagramEl = root.querySelector<HTMLElement>('#hero-diagram');
	const dimsEl = root.querySelector<HTMLElement>('#hero-dims');
	const tabsEl = root.querySelector<HTMLElement>('#hero-catalog');
	const pauseBtn = root.querySelector<HTMLButtonElement>('#hero-pause');
	const demoEl = root.querySelector<HTMLElement>('#hero-demo');
	const statusEl = root.querySelector<HTMLElement>('#hero-status');
	const statusDotEl = root.querySelector<HTMLElement>('#hero-status-dot');
	const statusTextEl = root.querySelector<HTMLElement>('#hero-status-text');
	if (!sourceEl || !diagramEl || !tabsEl || !pauseBtn || !demoEl) return () => {};

	const reduced = prefersReducedMotion();
	const state: DemoState = {
		index: 0,
		typed: 0,
		paused: false,
		hovering: false,
		timer: null,
		lastGoodSvg: ''
	};
	const cleanups: (() => void)[] = [];

	tabsEl.innerHTML = catalog
		.map(
			(e, i) =>
				`<button type="button" role="tab" class="hero-tab" data-index="${i}" data-name="${escapeHtml(e.name)}" aria-selected="${i === 0}" aria-controls="hero-source">` +
				`<span>${escapeHtml(e.title)}</span>` +
				`<span class="tab-track"></span><span class="tab-progress"></span>` +
				`</button>`
		)
		.join('');

	const isRunning = () => !reduced && !state.paused && !state.hovering;

	const renderSource = (text: string): void => {
		if (!sourceEl) return;
		const caret = isRunning() && text.length < catalog[state.index].source.length;
		sourceEl.innerHTML =
			highlight(text) + (caret ? '<span class="caret" aria-hidden="true"></span>' : '');
		if (gutterEl) {
			const lines = text.length === 0 ? 0 : text.split('\n').length;
			gutterEl.textContent = Array.from({ length: lines }, (_, i) => i + 1).join('\n');
		}
	};

	const updateStatus = (text: string): void => {
		const entry = catalog[state.index];
		const typedSource = entry.source.slice(0, state.typed);
		const teams = countTeams(typedSource);
		const interactions = countInteractions(typedSource);
		const done = state.typed >= entry.source.length;
		let tone: 'gutter' | 'accent' | 'ok';
		let label: string;
		if (text === 'paused') {
			tone = 'gutter';
			label = 'Paused';
		} else if (done) {
			tone = 'ok';
			label = `${teams} teams, ${interactions} interactions`;
		} else {
			tone = 'accent';
			label = `Rendering… ${teams} teams, ${interactions} interactions`;
		}
		if (statusTextEl) statusTextEl.textContent = label;
		if (statusDotEl) statusDotEl.dataset.tone = tone;
		if (statusEl) statusEl.setAttribute('aria-label', label);
		if (dimsEl) dimsEl.textContent = done ? 'rendered' : '';
	};

	const updateProgress = (): void => {
		const entry = catalog[state.index];
		const pct = entry.source.length === 0 ? 0 : (state.typed / entry.source.length) * 100;
		const bar = tabsEl.querySelector<HTMLElement>(
			`.hero-tab[data-index="${state.index}"] .tab-progress`
		);
		if (bar) bar.style.width = `${Math.min(100, pct)}%`;
	};

	const paint = (source: string) => {
		try {
			state.lastGoodSvg = render(source, { theme: currentTheme(), idPrefix: 'hero-' });
			diagramEl.innerHTML = state.lastGoodSvg;
			diagramEl.dataset.state = 'ok';
		} catch {
			// Mid-typing the source is usually incomplete; keep the last good diagram.
			diagramEl.dataset.state = 'stale';
		}
		updateProgress();
	};

	const showFull = () => {
		const entry = catalog[state.index];
		state.typed = entry.source.length;
		renderSource(entry.source);
		paint(entry.source);
		updateStatus('done');
	};

	const stopTimer = () => {
		if (state.timer !== null) clearTimeout(state.timer);
		state.timer = null;
	};

	const schedule = (ms: number) => {
		stopTimer();
		if (!isRunning()) return;
		state.timer = setTimeout(tick, ms);
	};

	const tick = () => {
		state.timer = null;
		if (!root.isConnected || !root.contains(sourceEl)) {
			dispose();
			return;
		}
		const entry = catalog[state.index];
		if (state.typed >= entry.source.length) {
			select((state.index + 1) % catalog.length);
			return;
		}
		const next = Math.min(entry.source.length, state.typed + CHARS_PER_TICK);
		const chunk = entry.source.slice(state.typed, next);
		state.typed = next;
		renderSource(entry.source.slice(0, next));
		if (chunk.includes('\n') || next === entry.source.length) paint(entry.source.slice(0, next));
		else updateProgress();
		updateStatus(next === entry.source.length ? 'done' : 'typing');
		schedule(next === entry.source.length ? HOLD_MS : TICK_MS);
	};

	const select = (index: number) => {
		state.index = index;
		state.typed = 0;
		for (const tab of tabsEl.querySelectorAll<HTMLElement>('.hero-tab')) {
			tab.setAttribute('aria-selected', String(Number(tab.dataset.index) === index));
			const bar = tab.querySelector<HTMLElement>('.tab-progress');
			if (bar) bar.style.width = '0%';
		}
		if (reduced) {
			showFull();
			return;
		}
		renderSource('');
		updateStatus('typing');
		if (isRunning()) schedule(TICK_MS);
		else showFull();
	};

	const onTabClick = (ev: Event) => {
		const tab = (ev.target as Element | null)?.closest<HTMLElement>('.hero-tab');
		if (!tab) return;
		select(Number(tab.dataset.index));
	};

	const setPaused = (paused: boolean) => {
		state.paused = paused;
		pauseBtn.setAttribute('aria-pressed', String(paused));
		pauseBtn.textContent = paused ? 'Play' : 'Pause';
		pauseBtn.setAttribute('aria-label', paused ? 'Play the demo' : 'Pause the demo');
		renderSource(catalog[state.index].source.slice(0, state.typed));
		updateStatus(paused ? 'paused' : 'typing');
		if (paused) stopTimer();
		else schedule(TICK_MS);
	};

	const setHovering = (hovering: boolean) => {
		if (state.hovering === hovering) return;
		state.hovering = hovering;
		renderSource(catalog[state.index].source.slice(0, state.typed));
		updateStatus(hovering ? 'paused' : 'typing');
		if (hovering) stopTimer();
		else schedule(TICK_MS);
	};

	const onFocusOut = (ev: FocusEvent) => {
		const to = ev.relatedTarget as Node | null;
		if (!to || !demoEl.contains(to)) setHovering(false);
	};

	const dispose = () => {
		stopTimer();
		for (const fn of cleanups.splice(0)) fn();
	};

	listen(tabsEl, 'click', onTabClick, cleanups);
	if (reduced) {
		pauseBtn.hidden = true;
	} else {
		listen(pauseBtn, 'click', () => setPaused(!state.paused), cleanups);
		listen(demoEl, 'mouseenter', () => setHovering(true), cleanups);
		listen(demoEl, 'mouseleave', () => setHovering(false), cleanups);
		listen(demoEl, 'focusin', () => setHovering(true), cleanups);
		listen(demoEl, 'focusout', onFocusOut as EventListener, cleanups);
	}
	cleanups.push(onThemeChange(() => paint(catalog[state.index].source.slice(0, state.typed))));

	demoEl.dataset.motion = reduced ? 'reduced' : 'animated';
	select(0);
	return dispose;
}

function setDemoMessage(root: HTMLElement, message: string): void {
	const diagramEl = root.querySelector<HTMLElement>('#hero-diagram');
	if (diagramEl) {
		diagramEl.textContent = message;
		diagramEl.dataset.state = 'error';
	}
	const statusTextEl = root.querySelector<HTMLElement>('#hero-status-text');
	if (statusTextEl) statusTextEl.textContent = '';
}

function listen<K extends keyof HTMLElementEventMap>(
	el: HTMLElement,
	type: K,
	handler: EventListener,
	cleanups: (() => void)[]
): void {
	el.addEventListener(type, handler);
	cleanups.push(() => el.removeEventListener(type, handler));
}

function prefersReducedMotion(): boolean {
	return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function currentTheme(): Theme {
	return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
		? 'dark'
		: 'light';
}

function onThemeChange(fn: () => void): () => void {
	if (typeof matchMedia !== 'function') return () => {};
	const mq = matchMedia('(prefers-color-scheme: dark)');
	if (typeof mq.addEventListener !== 'function') return () => {};
	mq.addEventListener('change', fn);
	return () => mq.removeEventListener('change', fn);
}

// ---------------------------------------------------------------------------
// Team API snippet (capped visually to ~4 lines via CSS)

function fillTeamApiSnippet(root: HTMLElement, catalog: CatalogEntry[]): void {
	const el = root.querySelector<HTMLElement>('#feature-team-api-snippet');
	if (!el) return;
	const entry = catalog.find((e) => e.name === 'ecommerce') ?? catalog[0];
	const teamId = entry.name === 'ecommerce' ? 'checkout' : firstTeamId(entry.source);
	if (!teamId) return;
	try {
		const md = teamApi(entry.source, teamId);
		// The header and the bullet list are enough to show the shape; tables follow.
		const head = md.split('\n### ')[0].trimEnd();
		el.textContent = head === md.trimEnd() ? head : `${head}\n…`;
	} catch {
		el.textContent = '';
	}
}

function firstTeamId(source: string): string | null {
	const m =
		/^\s*(?:stream|stream-aligned|sa|enabling|en|subsystem|complicated-subsystem|cs|platform|pf|group)\s+([A-Za-z_][A-Za-z0-9_.]*)/m.exec(
			source
		);
	return m ? m[1] : null;
}

// ---------------------------------------------------------------------------
// Static shell

interface Feature {
	id: string;
	title: string;
	body: string;
	illustration: string;
}

const FEATURES: Feature[] = [
	{
		id: 'syntax',
		title: 'A text syntax for org design',
		body: 'A dozen lines describe an organisation: four team types, three interaction modes, comments and attributes.',
		illustration: `<pre class="feature-snippet"><code><span class="tok-kw-stream">stream</span>   checkout <span class="tok-str">"Checkout"</span></code><code><span class="tok-kw-en">enabling</span> devex    <span class="tok-str">"DevEx"</span></code><code><span class="tok-kw-pf">platform</span> infra    <span class="tok-str">"Infra"</span></code></pre>`
	},
	{
		id: 'layout',
		title: 'Layout that follows the book',
		body: 'Lanes for stream teams, overlays for enabling and subsystem teams, wedges for X-as-a-Service, platform groupings. No boxes and arrows.',
		illustration: `<div class="feature-illus" aria-hidden="true">
			<div class="il-lane il-lane-1"></div>
			<div class="il-lane il-lane-2"></div>
			<div class="il-lane il-lane-3"></div>
			<div class="il-enabling-bar"></div>
			<div class="il-subsystem"></div>
			<div class="il-facilitating"></div>
		</div>`
	},
	{
		id: 'team-api',
		title: 'A Team API page for every team',
		body: 'Generated from the diagram in the Team Topologies template — Markdown out, and always in sync with the picture.',
		illustration: `<pre class="feature-snippet" id="feature-team-api-snippet"></pre>`
	},
	{
		id: 'share',
		title: 'Share with a link',
		body: 'A view link and an edit link, nothing else. No accounts on either end.',
		illustration: `<div class="il-links" aria-hidden="true">
			<span class="il-pill"><b>view</b><span class="il-pill-url">teamtopo.dev/d/8f3k2</span></span>
			<span class="il-pill il-pill-edit"><b>edit</b><span class="il-pill-url">teamtopo.dev/d/8f3k2#key</span></span>
		</div>`
	},
	{
		id: 'private',
		title: 'Private by default',
		body: 'Diagrams are encrypted client-side; the key lives in the link fragment and never reaches us. Our servers hold ciphertext.',
		illustration: `<div class="il-private" aria-hidden="true">
			<span class="il-private-line">you see: <span class="tok-kw-stream">stream checkout</span></span>
			<span class="il-private-line">we store: <span class="il-cipher">0x9f2a&hellip;c41b</span></span>
		</div>`
	},
	{
		id: 'history',
		title: 'Version history',
		body: 'Every save is kept. Go back to any earlier version of a diagram.',
		illustration: `<div class="il-history" aria-hidden="true">
			<div class="il-history-col">
				<div class="il-history-bars">
					<span class="il-history-bar"></span>
					<span class="il-history-bar"></span>
					<span class="il-history-bar il-history-bar--platform"></span>
				</div>
				<span class="il-history-label">as-is</span>
			</div>
			<span class="il-history-arrow">&rarr;</span>
			<div class="il-history-col">
				<div class="il-history-bars">
					<span class="il-history-bar"></span>
					<span class="il-history-bar"></span>
					<span class="il-history-bar"></span>
					<span class="il-history-bar il-history-bar--platform"></span>
				</div>
				<span class="il-history-label">to-be</span>
			</div>
		</div>`
	},
	{
		id: 'library',
		title: 'Also a CLI and a library',
		body: `A zero-dependency JavaScript library and a CLI for CI pipelines and docs sites. MIT licensed, on GitHub today; the npm package is coming.`,
		illustration: `<pre class="feature-snippet feature-snippet--term"><code><span class="tok-prompt">$</span> npx --yes \\</code><code>  github:jrschumacher/teamtopo \\</code><code>  org.tt &gt; org.svg</code></pre>`
	},
	{
		id: 'skill',
		title: 'A Skill for coding agents',
		body: 'An agent Skill teaches Claude Code and other harnesses the syntax, so you can draft and evolve topologies from your terminal.',
		illustration: `<pre class="feature-snippet feature-snippet--term"><code><span class="tok-prompt">$</span> npx skills add jrschumacher/teamtopo</code><code><span class="tok-prompt">&gt;</span> split checkout into two stream teams</code><code><span class="tok-dim">org.tt updated and parses</span></code></pre>`
	}
];

function shell(): string {
	return `<div class="landing">
	${navHtml('#features')}

	<header class="hero" id="hero">
		<div class="hero-copy">
			<h1 class="hero-title">Describe your team topology in text.<br>Get the book&rsquo;s diagrams &mdash; and a Team&nbsp;API for every team.</h1>
			<p class="hero-lede">A dozen lines become a Team Topologies diagram drawn the way the book draws it, plus a Team&nbsp;API document per team that never drifts out of sync. Think Mermaid, for org design.</p>
			<p class="hero-ctas">
				<a class="cta cta-primary" id="cta-editor" href="/new">Open the editor</a>
				<a class="cta cta-secondary" id="cta-examples" href="#hero-demo">Browse examples</a>
			</p>
			<p class="trust-note" id="trust-note">Free, no account. Diagrams are encrypted in your browser; we never see them.</p>
		</div>
		<div class="hero-demo" id="hero-demo">
			<div class="hero-demo-bar">
				<div class="hero-catalog" id="hero-catalog" role="tablist" aria-label="Examples"></div>
				<button type="button" class="hero-pause" id="hero-pause" aria-pressed="false" aria-label="Pause the demo">Pause</button>
			</div>
			<div class="hero-panes">
				<div class="hero-pane hero-pane-source">
					<div class="pane-head">Source<span class="spacer"></span><span class="pane-ext">.tt</span></div>
					<div class="hero-code">
						<pre class="hero-gutter" id="hero-gutter" aria-hidden="true"></pre>
						<pre class="hero-source" id="hero-source" aria-label="Diagram source" aria-live="off"></pre>
					</div>
					<div class="hero-status" id="hero-status">
						<span class="status-dot" id="hero-status-dot"></span><span id="hero-status-text"></span>
					</div>
				</div>
				<div class="hero-pane hero-pane-diagram">
					<div class="pane-head">Diagram<span class="spacer"></span><span class="pane-ext" id="hero-dims"></span></div>
					<div class="hero-diagram" id="hero-diagram" aria-label="Rendered diagram" data-state="empty"></div>
				</div>
			</div>
		</div>
	</header>

	<section class="features" id="features" aria-labelledby="features-title">
		<h2 class="section-title" id="features-title">Everything the diagram knows, put to work</h2>
		<p class="section-lede">The text is the source of truth; diagrams, documents, links and history all follow from it.</p>
		<ul class="features-list" id="features-list">
			${FEATURES.map(featureCard).join('\n\t\t\t')}
		</ul>
	</section>

	<section class="free" id="free" aria-labelledby="free-title">
		<div class="free-inner">
			<h2 class="section-title" id="free-title">Free, and staying that way</h2>
			<p class="section-lede">Diagrams render in your browser and our servers store only small encrypted blobs, so teamtopo costs almost nothing to run. It is free to use, and there is no paid tier planned.</p>
			<div class="signup" id="signup"></div>
		</div>
	</section>

	${footerHtml()}
</div>`;
}

function featureCard(f: Feature): string {
	return `<li class="feature" id="feature-${f.id}">
				${f.illustration}
				<h3 class="feature-title">${f.title}</h3>
				<p class="feature-body">${f.body}</p>
			</li>`;
}
