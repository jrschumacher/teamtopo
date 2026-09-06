/**
 * Landing page: hero with a live typing demo of the catalog, an examples gallery, feature
 * cards, the "free" section with the email signup, and a footer. Element ids and classes
 * are a contract with the visual design that replaces this styling later; keep them stable.
 */
import { render, teamApi } from '@lib/teamtopo';
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

const GITHUB_URL = 'https://github.com/jrschumacher/teamtopo';

const disposers = new WeakMap<HTMLElement, () => void>();

export function renderLanding(root: HTMLElement): void {
	disposers.get(root)?.();
	root.innerHTML = shell();

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
			fillExamples(root, catalog);
			fillTeamApiSnippet(root, catalog);
		},
		() => setDemoMessage(root, 'The example catalog could not be loaded.')
	);
}

async function loadCatalog(): Promise<CatalogEntry[]> {
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
	const diagramEl = root.querySelector<HTMLElement>('#hero-diagram');
	const tabsEl = root.querySelector<HTMLElement>('#hero-catalog');
	const pauseBtn = root.querySelector<HTMLButtonElement>('#hero-pause');
	const demoEl = root.querySelector<HTMLElement>('#hero-demo');
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
				`<button type="button" role="tab" class="hero-tab" data-index="${i}" data-name="${escapeHtml(e.name)}" aria-selected="${i === 0}" aria-controls="hero-source">${escapeHtml(e.title)}</button>`
		)
		.join('');

	const showFull = () => {
		const entry = catalog[state.index];
		state.typed = entry.source.length;
		sourceEl.textContent = entry.source;
		paint(entry.source);
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
	};

	const stopTimer = () => {
		if (state.timer !== null) clearTimeout(state.timer);
		state.timer = null;
	};

	const isRunning = () => !reduced && !state.paused && !state.hovering;

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
		sourceEl.textContent = entry.source.slice(0, next);
		if (chunk.includes('\n') || next === entry.source.length) paint(entry.source.slice(0, next));
		schedule(next === entry.source.length ? HOLD_MS : TICK_MS);
	};

	const select = (index: number) => {
		state.index = index;
		state.typed = 0;
		for (const tab of tabsEl.querySelectorAll<HTMLElement>('.hero-tab')) {
			tab.setAttribute('aria-selected', String(Number(tab.dataset.index) === index));
		}
		if (reduced) {
			showFull();
			return;
		}
		sourceEl.textContent = '';
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
		if (paused) stopTimer();
		else schedule(TICK_MS);
	};

	const setHovering = (hovering: boolean) => {
		if (state.hovering === hovering) return;
		state.hovering = hovering;
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
// Examples gallery and Team API snippet

function fillExamples(root: HTMLElement, catalog: CatalogEntry[]): void {
	const list = root.querySelector<HTMLElement>('#examples-list');
	if (!list) return;
	const theme = currentTheme();
	list.innerHTML = catalog
		.map((e) => {
			const svg = safeRender(e.source, theme, `ex-${e.name}-`);
			return `<li class="example" data-name="${escapeHtml(e.name)}">
	<h3 class="example-title">${escapeHtml(e.title)}</h3>
	<div class="example-diagram">${svg}</div>
	<a class="example-open" href="/new?example=${encodeURIComponent(e.name)}">Open in editor</a>
</li>`;
		})
		.join('');
}

function safeRender(source: string, theme: Theme, idPrefix: string): string {
	try {
		return render(source, { theme, idPrefix });
	} catch (e) {
		return `<p class="render-error">${escapeHtml(e instanceof Error ? e.message : String(e))}</p>`;
	}
}

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
	extra?: string;
}

const FEATURES: Feature[] = [
	{
		id: 'syntax',
		title: 'Text syntax',
		body: 'A dozen lines describe a topology: four team types, three interaction modes, comments and attributes. Diff it, review it, keep it in git.'
	},
	{
		id: 'layout',
		title: 'Layout that follows the book',
		body: 'Stream-aligned lanes, platforms beneath, enabling bars crossing the teams they help, XaaS wedges and collaboration bridges drawn as in Team Topologies.'
	},
	{
		id: 'team-api',
		title: 'A Team API page per team',
		body: 'Every team gets a Team API document generated from the diagram, ready to fill in and share.',
		extra: '<pre class="feature-snippet" id="feature-team-api-snippet"></pre>'
	},
	{
		id: 'share',
		title: 'Share by link',
		body: 'Two links per diagram: one to edit, one to view. Send the view link and nobody can change your work.'
	},
	{
		id: 'private',
		title: 'Private by default',
		body: 'Your browser encrypts the source before it leaves. We store ciphertext and the key stays in your link.'
	},
	{
		id: 'history',
		title: 'Version history',
		body: 'Every save keeps a snapshot. Go back to any earlier version of a diagram.'
	},
	{
		id: 'library',
		title: 'CLI and MIT library',
		body: `Render from the command line or embed the zero-dependency library in your own tools. <a href="${GITHUB_URL}">Source on GitHub</a>.`
	}
];

function shell(): string {
	return `<div class="landing">
	<header class="hero" id="hero">
		<div class="hero-copy">
			<h1 class="hero-title">Team Topologies diagrams from a few lines of text</h1>
			<p class="hero-lede">Describe your teams and how they interact. teamtopo lays them out the way the book draws them and writes a Team API page for every team.</p>
			<p class="hero-ctas">
				<a class="cta cta-primary" id="cta-editor" href="/new">Open the editor</a>
				<a class="cta cta-secondary" id="cta-examples" href="#examples">Browse examples</a>
			</p>
			<p class="trust-note" id="trust-note">Free, no account. Diagrams are encrypted in your browser; we never see them.</p>
		</div>
		<div class="hero-demo" id="hero-demo">
			<div class="hero-demo-bar">
				<div class="hero-catalog" id="hero-catalog" role="tablist" aria-label="Examples"></div>
				<button type="button" class="hero-pause" id="hero-pause" aria-pressed="false" aria-label="Pause the demo">Pause</button>
			</div>
			<div class="hero-panes">
				<pre class="hero-source" id="hero-source" aria-label="Diagram source" aria-live="off"></pre>
				<div class="hero-diagram" id="hero-diagram" aria-label="Rendered diagram" data-state="empty"></div>
			</div>
		</div>
	</header>

	<section class="examples" id="examples" aria-labelledby="examples-title">
		<h2 class="section-title" id="examples-title">Examples</h2>
		<ul class="examples-list" id="examples-list"></ul>
	</section>

	<section class="features" id="features" aria-labelledby="features-title">
		<h2 class="section-title" id="features-title">What you get</h2>
		<ul class="features-list" id="features-list">
			${FEATURES.map(featureCard).join('\n\t\t\t')}
		</ul>
	</section>

	<section class="free" id="free" aria-labelledby="free-title">
		<h2 class="section-title" id="free-title">Free</h2>
		<p>teamtopo is free to use. Diagrams are tiny, the server only stores ciphertext, and hosting that costs next to nothing. There is no paid tier and none is planned.</p>
		<p>If you want to hear when something changes, leave an email. Double opt-in, never linked to a diagram, unsubscribe any time.</p>
		<div class="signup" id="signup"></div>
	</section>

	<footer class="site-footer" id="site-footer">
		<p class="attribution" id="attribution">Shapes and Team API template &copy; Team Topologies, <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>. Not affiliated with or endorsed by Team Topologies.</p>
		<p class="footer-links"><a id="footer-github" href="${GITHUB_URL}">GitHub</a></p>
	</footer>
</div>`;
}

function featureCard(f: Feature): string {
	return `<li class="feature" id="feature-${f.id}">
				<h3 class="feature-title">${f.title}</h3>
				<p class="feature-body">${f.body}</p>
				${f.extra ?? ''}
			</li>`;
}

function escapeHtml(s: string): string {
	return s.replace(
		/[&<>"]/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c
	);
}
