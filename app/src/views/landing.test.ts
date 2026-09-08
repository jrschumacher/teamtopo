import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderLanding, type CatalogEntry } from './landing';
import { renderSignup } from './subscribe';

vi.mock('./subscribe', () => ({ renderSignup: vi.fn() }));

const catalog: CatalogEntry[] = [
	{
		name: 'ecommerce',
		title: 'E-commerce product organisation',
		source:
			'teamTopology\n  title E-commerce\n  stream checkout "Checkout"\n  platform infra "Infra"\n  infra --> checkout : Kubernetes\n  api checkout {\n    focus: the checkout experience\n  }\n'
	},
	{
		name: 'minimal',
		title: 'Minimal',
		source: 'teamTopology\n  stream app "App"\n  platform infra "Platform"\n  infra --> app\n'
	}
];

let root: HTMLElement;
let reducedMotion = false;

function stubMatchMedia(): void {
	vi.stubGlobal(
		'matchMedia',
		vi.fn((query: string) => ({
			matches: query.includes('prefers-reduced-motion') ? reducedMotion : false,
			media: query,
			addEventListener: vi.fn(),
			removeEventListener: vi.fn()
		}))
	);
}

function stubFetch(body: unknown = catalog, ok = true): void {
	vi.stubGlobal(
		'fetch',
		vi.fn(() => Promise.resolve({ ok, status: ok ? 200 : 500, json: () => Promise.resolve(body) }))
	);
}

async function flush(): Promise<void> {
	// Two promise hops: fetch resolves, then res.json() resolves.
	for (let i = 0; i < 4; i++) await Promise.resolve();
}

const q = <T extends Element = HTMLElement>(sel: string): T => {
	const el = root.querySelector<T>(sel);
	if (!el) throw new Error(`missing ${sel}`);
	return el;
};

beforeEach(() => {
	vi.useFakeTimers();
	reducedMotion = false;
	stubMatchMedia();
	stubFetch();
	root = document.createElement('div');
	document.body.appendChild(root);
});

afterEach(() => {
	root.remove();
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

describe('renderLanding', () => {
	it('renders the shell synchronously with the stable ids', () => {
		renderLanding(root);
		for (const id of [
			'hero',
			'hero-demo',
			'hero-source',
			'hero-diagram',
			'hero-catalog',
			'hero-pause',
			'cta-editor',
			'cta-examples',
			'trust-note',
			'features',
			'features-list',
			'free',
			'signup',
			'site-footer',
			'attribution',
			'footer-github'
		]) {
			expect(root.querySelector(`#${id}`), id).not.toBeNull();
		}
		expect(q<HTMLAnchorElement>('#cta-editor').getAttribute('href')).toBe('/new');
		expect(q<HTMLAnchorElement>('#cta-examples').getAttribute('href')).toBe('#hero-demo');
		expect(root.querySelectorAll('.feature')).toHaveLength(8);
		for (const id of [
			'feature-syntax',
			'feature-layout',
			'feature-team-api',
			'feature-share',
			'feature-private',
			'feature-history',
			'feature-library',
			'feature-skill'
		]) {
			expect(root.querySelector(`#${id}`), id).not.toBeNull();
		}
		expect(q('#attribution').textContent).toContain('not affiliated with or endorsed by');
		expect(q<HTMLAnchorElement>('#footer-github').getAttribute('href')).toBe(
			'https://github.com/jrschumacher/teamtopo'
		);
		expect(fetch).toHaveBeenCalledWith('/catalog.json');
	});

	it('calls renderSignup with the signup container', () => {
		renderLanding(root);
		expect(renderSignup).toHaveBeenCalledTimes(1);
		expect(renderSignup).toHaveBeenCalledWith(q('#signup'));
	});

	it('shows the first example title in the catalog tabs once the catalog resolves', async () => {
		renderLanding(root);
		expect(q('#hero-catalog').children).toHaveLength(0);
		await flush();
		const tabs = q('#hero-catalog').querySelectorAll('.hero-tab');
		expect(tabs).toHaveLength(2);
		expect(tabs[0].textContent).toBe('E-commerce product organisation');
		expect(tabs[0].getAttribute('aria-selected')).toBe('true');
	});

	it('types the source in and re-renders the diagram live, keeping the last good render', async () => {
		renderLanding(root);
		await flush();
		expect(q('#hero-source').textContent).toBe('');
		vi.advanceTimersByTime(24 * 3);
		const partial = q('#hero-source').textContent ?? '';
		expect(partial.length).toBeGreaterThan(0);
		expect(partial.length).toBeLessThan(catalog[0].source.length);
		expect(catalog[0].source.startsWith(partial)).toBe(true);
		// Enough ticks to pass the third line: a diagram is rendered by then and the
		// partially typed fourth line (a parse error) leaves it in place.
		vi.advanceTimersByTime(24 * 30);
		expect(q('#hero-diagram').innerHTML).toMatch(/^<svg/);
		expect(['ok', 'stale']).toContain(q('#hero-diagram').dataset.state);
		// Finish typing: full source, fresh diagram.
		vi.advanceTimersByTime(24 * 100);
		expect(q('#hero-source').textContent).toBe(catalog[0].source);
		expect(q('#hero-diagram').dataset.state).toBe('ok');
	});

	it('advances to the next example after the hold and wraps around', async () => {
		renderLanding(root);
		await flush();
		vi.advanceTimersByTime(24 * 100 + 5000);
		expect(q('.hero-tab[aria-selected="true"]').textContent).toBe('Minimal');
		expect(catalog[1].source.startsWith(q('#hero-source').textContent ?? '')).toBe(true);
	});

	it('pauses on hover and via the pause control', async () => {
		renderLanding(root);
		await flush();
		vi.advanceTimersByTime(24 * 3);
		const before = q('#hero-source').textContent;
		q('#hero-demo').dispatchEvent(new Event('mouseenter'));
		vi.advanceTimersByTime(24 * 20);
		expect(q('#hero-source').textContent).toBe(before);
		q('#hero-demo').dispatchEvent(new Event('mouseleave'));
		vi.advanceTimersByTime(24 * 3);
		expect(q('#hero-source').textContent?.length).toBeGreaterThan(before?.length ?? 0);

		const pause = q<HTMLButtonElement>('#hero-pause');
		pause.click();
		expect(pause.getAttribute('aria-pressed')).toBe('true');
		const paused = q('#hero-source').textContent;
		vi.advanceTimersByTime(24 * 20);
		expect(q('#hero-source').textContent).toBe(paused);
		pause.click();
		expect(pause.getAttribute('aria-pressed')).toBe('false');
		vi.advanceTimersByTime(24 * 3);
		expect(q('#hero-source').textContent?.length).toBeGreaterThan(paused?.length ?? 0);
	});

	it('shows a status line with team and interaction counts while typing', async () => {
		renderLanding(root);
		await flush();
		vi.advanceTimersByTime(24 * 30);
		const status = q('#hero-status-text').textContent ?? '';
		expect(status).toMatch(/Rendering…\s+\d+\s+teams?,\s+\d+\s+interactions?/);
	});

	it('shows the finished status text and no ellipsis once typing completes', async () => {
		renderLanding(root);
		await flush();
		vi.advanceTimersByTime(24 * 100);
		expect(q('#hero-source').textContent).toBe(catalog[0].source);
		const status = q('#hero-status-text').textContent ?? '';
		expect(status).toMatch(/^\d+\s+teams?,\s+\d+\s+interactions?$/);
	});

	it('shows Paused in the status line while the pause control is engaged', async () => {
		renderLanding(root);
		await flush();
		vi.advanceTimersByTime(24 * 3);
		q<HTMLButtonElement>('#hero-pause').click();
		expect(q('#hero-status-text').textContent).toBe('Paused');
	});

	it('clicking the second tab switches the source', async () => {
		renderLanding(root);
		await flush();
		vi.advanceTimersByTime(24 * 5);
		q<HTMLButtonElement>('.hero-tab[data-index="1"]').click();
		expect(q('.hero-tab[data-index="1"]').getAttribute('aria-selected')).toBe('true');
		expect(q('.hero-tab[data-index="0"]').getAttribute('aria-selected')).toBe('false');
		vi.advanceTimersByTime(24 * 3);
		const typed = q('#hero-source').textContent ?? '';
		expect(typed.length).toBeGreaterThan(0);
		expect(catalog[1].source.startsWith(typed)).toBe(true);
	});

	it('with reduced motion shows the full source and diagram immediately, still switchable', async () => {
		reducedMotion = true;
		renderLanding(root);
		await flush();
		expect(q('#hero-source').textContent).toBe(catalog[0].source);
		expect(q('#hero-diagram').innerHTML).toMatch(/^<svg/);
		expect(q<HTMLButtonElement>('#hero-pause').hidden).toBe(true);
		expect(q('#hero-demo').dataset.motion).toBe('reduced');
		expect(vi.getTimerCount()).toBe(0);

		q<HTMLButtonElement>('.hero-tab[data-index="1"]').click();
		expect(q('#hero-source').textContent).toBe(catalog[1].source);
		expect(q('#hero-diagram').innerHTML).toMatch(/^<svg/);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('fills the Team API snippet from the e-commerce example', async () => {
		renderLanding(root);
		await flush();
		const snippet = q('#feature-team-api-snippet').textContent ?? '';
		expect(snippet).toContain('# Team API: Checkout');
		expect(snippet).toContain('the checkout experience');
	});

	it('stops the previous animation when re-rendered into the same root', async () => {
		renderLanding(root);
		await flush();
		vi.advanceTimersByTime(24 * 3);
		const oldSource = q('#hero-source');
		renderLanding(root);
		await flush();
		expect(q('#hero-source')).not.toBe(oldSource);
		vi.advanceTimersByTime(24 * 10);
		// One typing timer for the new demo only.
		expect(vi.getTimerCount()).toBe(1);
		expect(oldSource.textContent?.length).toBeLessThan(10);
	});

	it('shows a message when the catalog cannot be loaded', async () => {
		stubFetch(null, false);
		renderLanding(root);
		await flush();
		expect(q('#hero-diagram').dataset.state).toBe('error');
		expect(q('#hero-diagram').textContent).toContain('could not be loaded');
		expect(vi.getTimerCount()).toBe(0);
	});
});
