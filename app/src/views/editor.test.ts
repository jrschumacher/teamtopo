import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/api';
import type { OpenedDoc, Version } from '../lib/types';
import { DRAFT_KEY, renderEditor } from './editor';

const SRC = [
	'teamTopology',
	'  title Shop',
	'  stream checkout "Checkout"',
	'  platform infra "Infra"',
	'  infra --> checkout',
	''
].join('\n');

const SRC_WITH_API = [
	'teamTopology',
	'  title Shop',
	'  stream checkout "Checkout"',
	'  platform infra "Infra"',
	'  infra --> checkout',
	'  api checkout {',
	'    focus: the checkout experience',
	'  }',
	''
].join('\n');

const V1: Version = { id: '00000000000001-aaaa', at: '2026-01-01T00:00:00.000Z', size: 10 };
const V2: Version = { id: '00000000000002-bbbb', at: '2026-01-02T00:00:00.000Z', size: 12 };

function makeDoc(overrides: Partial<OpenedDoc> = {}): OpenedDoc {
	return {
		id: 'doc1',
		source: SRC,
		version: V2,
		versions: [V2, V1],
		canEdit: true,
		links: { view: '/d/doc1#k=KEY', edit: '/d/doc1#s=SECRET' },
		fragment: '#s=SECRET',
		save: vi.fn(async (_s: string) => V2),
		...overrides
	};
}

function type(root: HTMLElement, text: string) {
	const ta = root.querySelector<HTMLTextAreaElement>('#src')!;
	ta.value = text;
	ta.dispatchEvent(new Event('input'));
}

const flush = () => new Promise((r) => setTimeout(r, 0));
/** Flush microtasks only, safe under fake timers (fetch/json resolve in two hops). */
async function flushMicrotasks(hops = 4): Promise<void> {
	for (let i = 0; i < hops; i++) await Promise.resolve();
}

/** happy-dom under vitest exposes no localStorage; a Map-backed stand-in is enough. */
function fakeStorage(): Storage {
	const m = new Map<string, string>();
	return {
		get length() {
			return m.size;
		},
		clear: () => m.clear(),
		getItem: (k: string) => m.get(k) ?? null,
		key: (i: number) => [...m.keys()][i] ?? null,
		removeItem: (k: string) => void m.delete(k),
		setItem: (k: string, v: string) => void m.set(k, v)
	};
}

function stubCatalogFetch(catalog: unknown[] = []): ReturnType<typeof vi.fn> {
	const fetchMock = vi.fn<typeof fetch>((input: RequestInfo | URL) => {
		const url = String(input);
		if (url.includes('catalog.json')) {
			return Promise.resolve(new Response(JSON.stringify(catalog), { status: 200 }));
		}
		return Promise.reject(new Error(`unexpected fetch: ${url}`));
	});
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

describe('renderEditor', () => {
	let root: HTMLElement;

	beforeEach(() => {
		root = document.createElement('div');
		document.body.appendChild(root);
		vi.stubGlobal('localStorage', fakeStorage());
		history.replaceState(null, '', '/new');
	});
	afterEach(() => {
		root.remove();
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	it('renders the source, gutter and diagram for an opened doc', () => {
		renderEditor(root, makeDoc());
		expect(root.querySelector<HTMLTextAreaElement>('#src')!.value).toBe(SRC);
		expect(root.querySelectorAll('#gutter span')).toHaveLength(SRC.split('\n').length);
		expect(root.querySelector('#canvas svg')).not.toBeNull();
		expect(root.querySelector('#status-text')!.textContent).toBe(
			'2 teams, 1 interaction · no errors'
		);
	});

	it('derives the header title from the source and updates it live', () => {
		vi.useFakeTimers();
		renderEditor(root, makeDoc());
		expect(root.querySelector('#doc-title')!.textContent).toBe('Shop');
		type(root, SRC.replace('title Shop', 'title Renamed Co'));
		vi.advanceTimersByTime(200);
		expect(root.querySelector('#doc-title')!.textContent).toBe('Renamed Co');
	});

	it('falls back to "Untitled diagram" when the source has no title', () => {
		renderEditor(root, makeDoc({ source: 'teamTopology\n  stream a "A"\n' }));
		expect(root.querySelector('#doc-title')!.textContent).toBe('Untitled diagram');
	});

	it('shows a Saved state pill for an unchanged doc, and Unsaved once edited', () => {
		vi.useFakeTimers();
		renderEditor(root, makeDoc());
		expect(root.querySelector('#state-text')!.textContent).toBe('Saved · encrypted');
		expect(root.querySelector('#state-dot')!.getAttribute('data-tone')).toBe('ok');
		type(root, SRC + '  stream search "Search"\n');
		expect(root.querySelector('#state-text')!.textContent).toBe('Unsaved changes');
	});

	it('disables Save until the source changes, then enables it', () => {
		vi.useFakeTimers();
		renderEditor(root, makeDoc());
		const save = root.querySelector<HTMLButtonElement>('#save')!;
		expect(save.disabled).toBe(true);
		type(root, SRC + '  stream search "Search"\n');
		expect(save.disabled).toBe(false);
		vi.advanceTimersByTime(200);
		expect(root.querySelector('#status-text')!.textContent).toBe(
			'3 teams, 1 interaction · no errors'
		);
	});

	it('shows a parse error and highlights the line', () => {
		vi.useFakeTimers();
		renderEditor(root, makeDoc());
		type(root, 'teamTopology\n  stream a "A"\n  bogus line here\n');
		vi.advanceTimersByTime(200);
		expect(root.querySelector('#status')!.classList.contains('error')).toBe(true);
		const err = root.querySelector('#gutter span.err');
		expect(err?.textContent).toBe('3');
		expect(root.querySelector('#canvas svg')).not.toBeNull();
	});

	it('inserts two spaces on Tab at the caret without moving focus', () => {
		renderEditor(root, makeDoc());
		const ta = root.querySelector<HTMLTextAreaElement>('#src')!;
		ta.value = 'ab';
		ta.focus();
		ta.selectionStart = ta.selectionEnd = 2;
		ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
		expect(ta.value).toBe('ab  ');
		expect(ta.selectionStart).toBe(4);
		expect(document.activeElement).toBe(ta);
	});

	it('removes up to two leading spaces on Shift+Tab', () => {
		renderEditor(root, makeDoc());
		const ta = root.querySelector<HTMLTextAreaElement>('#src')!;
		ta.value = '    stream a "A"';
		ta.focus();
		ta.selectionStart = ta.selectionEnd = 8;
		ta.dispatchEvent(
			new KeyboardEvent('keydown', {
				key: 'Tab',
				shiftKey: true,
				bubbles: true,
				cancelable: true
			})
		);
		expect(ta.value).toBe('  stream a "A"');
		expect(document.activeElement).toBe(ta);
	});

	it('opens the Share popover, marks aria-expanded, and closes on Escape', () => {
		renderEditor(root, makeDoc());
		const btn = root.querySelector<HTMLButtonElement>('#share-btn')!;
		const pop = root.querySelector<HTMLElement>('#share-pop')!;
		expect(pop.hidden).toBe(true);
		btn.click();
		expect(pop.hidden).toBe(false);
		expect(btn.getAttribute('aria-expanded')).toBe('true');
		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
		expect(pop.hidden).toBe(true);
		expect(btn.getAttribute('aria-expanded')).toBe('false');
	});

	it('closes the open popover when the backdrop is clicked, and only one popover is open at a time', () => {
		renderEditor(root, makeDoc());
		const shareBtn = root.querySelector<HTMLButtonElement>('#share-btn')!;
		const historyBtn = root.querySelector<HTMLButtonElement>('#history-btn')!;
		const sharePop = root.querySelector<HTMLElement>('#share-pop')!;
		const historyPop = root.querySelector<HTMLElement>('#history-pop')!;
		shareBtn.click();
		expect(sharePop.hidden).toBe(false);
		historyBtn.click();
		expect(sharePop.hidden).toBe(true);
		expect(historyPop.hidden).toBe(false);
		root.querySelector<HTMLElement>('#backdrop')!.click();
		expect(historyPop.hidden).toBe(true);
	});

	it('shows Copied feedback for a moment after copying a share link', async () => {
		vi.useFakeTimers();
		vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
		renderEditor(root, makeDoc());
		root.querySelector<HTMLButtonElement>('#share-btn')!.click();
		const copyBtn = root.querySelector<HTMLButtonElement>('#copy-view')!;
		copyBtn.click();
		await flushMicrotasks();
		expect(copyBtn.textContent).toBe('Copied');
		vi.advanceTimersByTime(1500);
		expect(copyBtn.textContent).toBe('Copy');
	});

	it('lists share links with a write-access warning and versions newest first', () => {
		renderEditor(root, makeDoc());
		const view = root.querySelector<HTMLInputElement>('#view-link')!;
		const edit = root.querySelector<HTMLInputElement>('#edit-link')!;
		expect(view.value).toBe(`${location.origin}/d/doc1#k=KEY`);
		expect(edit.value).toBe(`${location.origin}/d/doc1#s=SECRET`);
		expect(root.querySelector('.ed-share-warn')!.textContent).toMatch(/edit link/i);
		const links = [...root.querySelectorAll<HTMLAnchorElement>('#versions a')].map((a) =>
			a.getAttribute('href')
		);
		expect(links).toEqual([`/d/doc1/v/${V2.id}#s=SECRET`, `/d/doc1/v/${V1.id}#s=SECRET`]);
		expect(root.querySelector('#versions a.current')?.textContent).toContain('');
	});

	it('shows the Examples popover only on /new, not for an opened doc', async () => {
		stubCatalogFetch([{ name: 'a', title: 'A example', source: SRC }]);
		renderEditor(root, makeDoc());
		expect(root.querySelector('#examples-btn')).toBeNull();

		renderEditor(root, null, { starter: SRC });
		await flushMicrotasks();
		expect(root.querySelector('#examples-btn')).not.toBeNull();
	});

	it('selects a catalog entry from Examples, replacing the source', async () => {
		const entry = {
			name: 'other',
			title: 'Other example',
			source: 'teamTopology\n  stream x "X"\n'
		};
		stubCatalogFetch([entry]);
		renderEditor(root, null, { starter: SRC });
		await flushMicrotasks();
		root.querySelector<HTMLButtonElement>('#examples-btn')!.click();
		const item = root.querySelector<HTMLButtonElement>('[data-example-index="0"]')!;
		item.click();
		expect(root.querySelector<HTMLTextAreaElement>('#src')!.value).toBe(entry.source);
		expect(root.querySelector<HTMLElement>('#examples-pop')!.hidden).toBe(true);
	});

	it('switches between the Diagram and Team APIs tabs', () => {
		renderEditor(root, makeDoc());
		const tabDiagram = root.querySelector<HTMLButtonElement>('#tab-diagram')!;
		const tabApi = root.querySelector<HTMLButtonElement>('#tab-api')!;
		expect(tabDiagram.getAttribute('aria-selected')).toBe('true');
		expect(root.querySelector<HTMLElement>('#panel-api')!.hidden).toBe(true);
		tabApi.click();
		expect(tabApi.getAttribute('aria-selected')).toBe('true');
		expect(tabDiagram.getAttribute('aria-selected')).toBe('false');
		expect(root.querySelector<HTMLElement>('#panel-diagram')!.hidden).toBe(true);
		expect(root.querySelector<HTMLElement>('#panel-api')!.hidden).toBe(false);
	});

	it('renders a Team API card per team, linked to the team page, with fields or the empty note', () => {
		renderEditor(root, makeDoc({ source: SRC_WITH_API }));
		const cards = root.querySelectorAll<HTMLAnchorElement>('.ed-api-card');
		expect(cards).toHaveLength(2);
		const checkout = root.querySelector<HTMLAnchorElement>(
			'.ed-api-card[data-team-id="checkout"]'
		)!;
		expect(checkout.tagName).toBe('A');
		expect(checkout.getAttribute('href')).toBe('/d/doc1/team/checkout#s=SECRET');
		expect(checkout.querySelector('h3')!.textContent).toBe('Checkout');
		expect(checkout.querySelector('.ed-api-chip')!.classList.contains('stream')).toBe(true);
		expect(checkout.querySelector('dd')!.textContent).toContain('checkout experience');
		const infra = root.querySelector<HTMLAnchorElement>('.ed-api-card[data-team-id="infra"]')!;
		expect(infra.querySelector('.ed-api-empty')).not.toBeNull();
		expect(root.querySelector('#api-status')!.textContent).toBe('2 Team API pages generated');
	});

	it('exports the diagram SVG and the Team API markdown as downloads', () => {
		const created: { filename: string }[] = [];
		vi.stubGlobal('URL', {
			createObjectURL: vi.fn(() => 'blob:mock'),
			revokeObjectURL: vi.fn()
		});
		const realCreateElement = document.createElement.bind(document);
		vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
			const el = realCreateElement(tag);
			if (tag === 'a') {
				const anchor = el as HTMLAnchorElement;
				vi.spyOn(anchor, 'click').mockImplementation(() => {
					created.push({ filename: anchor.download });
				});
			}
			return el;
		});
		renderEditor(root, makeDoc());
		root.querySelector<HTMLButtonElement>('#export-svg')!.click();
		root.querySelector<HTMLButtonElement>('#export-md')!.click();
		expect(created).toEqual([{ filename: 'Shop.svg' }, { filename: 'Shop-team-apis.md' }]);
	});

	it('saves with doc.save and refreshes the versions list', async () => {
		const V3: Version = { id: '00000000000003-cccc', at: '2026-01-03T00:00:00.000Z', size: 1 };
		const doc = makeDoc();
		doc.save = vi.fn(async (s: string) => {
			doc.source = s;
			doc.version = V3;
			doc.versions = [V3, ...doc.versions];
			return V3;
		});
		renderEditor(root, doc);
		const next = SRC + '  stream search "Search"\n';
		type(root, next);
		root.querySelector<HTMLButtonElement>('#save')!.click();
		await flush();
		expect(doc.save).toHaveBeenCalledWith(next);
		expect(root.querySelectorAll('#versions a')).toHaveLength(3);
		expect(root.querySelector<HTMLButtonElement>('#save')!.disabled).toBe(true);
		expect(root.querySelector('#state-text')!.textContent).toBe('Saved · encrypted');
	});

	it('offers reload or save-anyway on a stale 409, retrying with latest as base', async () => {
		const V3: Version = { id: '00000000000003-cccc', at: '2026-01-03T00:00:00.000Z', size: 1 };
		const doc = makeDoc();
		const save = vi
			.fn<(s: string) => Promise<Version>>()
			.mockRejectedValueOnce(new ApiError(409, 'stale', 'stale', V3))
			.mockResolvedValueOnce(V3);
		doc.save = save;
		renderEditor(root, doc);
		type(root, SRC + '  stream search "Search"\n');
		root.querySelector<HTMLButtonElement>('#save')!.click();
		await flush();

		const banner = root.querySelector<HTMLElement>('#banner')!;
		expect(banner.hidden).toBe(false);
		expect(banner.textContent).toMatch(/newer version/);
		expect(banner.querySelector('#reload')).not.toBeNull();

		banner.querySelector<HTMLButtonElement>('#save-anyway')!.click();
		await flush();
		expect(save).toHaveBeenCalledTimes(2);
		expect(doc.version).toEqual(V3);
		expect(banner.hidden).toBe(true);
	});

	it('navigates to the team page when a team is clicked in the SVG', () => {
		renderEditor(root, makeDoc());
		const g = root.querySelector<SVGElement>('#canvas .tt-node[data-id="checkout"]')!;
		expect(g).not.toBeNull();
		g.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		expect(location.pathname).toBe('/d/doc1/team/checkout');
		expect(location.hash).toBe('#s=SECRET');
	});

	it('for /new: uses the starter, persists a draft, and creates on save', async () => {
		const V0: Version = { id: '00000000000000-zzzz', at: '2026-01-01T00:00:00.000Z', size: 5 };
		const fetchMock = vi.fn<typeof fetch>((input: RequestInfo | URL) => {
			const url = String(input);
			if (url.includes('catalog.json')) {
				return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
			}
			return Promise.resolve(
				new Response(JSON.stringify({ id: 'new1', version: { ...V0, at: Date.parse(V0.at) } }), {
					status: 201
				})
			);
		});
		vi.stubGlobal('fetch', fetchMock);

		renderEditor(root, null, { starter: SRC });
		expect(root.querySelector<HTMLTextAreaElement>('#src')!.value).toBe(SRC);
		expect(root.querySelector('#edit-link')).toBeNull();
		const save = root.querySelector<HTMLButtonElement>('#save')!;
		expect(save.disabled).toBe(false);

		const next = SRC + '  stream search "Search"\n';
		type(root, next);
		await vi.waitFor(() => expect(localStorage.getItem(DRAFT_KEY)).toBe(next));

		save.click();
		await vi.waitFor(() => expect(root.querySelector('#edit-link')).not.toBeNull());

		const docPosts = fetchMock.mock.calls.filter((c) => !String(c[0]).includes('catalog.json'));
		expect(docPosts).toHaveLength(1);
		expect(location.pathname).toBe('/d/new1');
		expect(location.hash).toMatch(/^#s=[A-Za-z0-9_-]{43}$/);
		expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
		expect(root.querySelector<HTMLInputElement>('#edit-link')!.value).toBe(
			`${location.origin}${location.pathname}${location.hash}`
		);
		expect(root.querySelector<HTMLButtonElement>('#save')!.disabled).toBe(true);
	});

	it('for /new: prefers a stored draft over the starter unless resetDraft', () => {
		localStorage.setItem(DRAFT_KEY, 'teamTopology\n  stream d "Draft"\n');
		renderEditor(root, null, { starter: SRC });
		expect(root.querySelector<HTMLTextAreaElement>('#src')!.value).toContain('Draft');
		renderEditor(root, null, { starter: SRC, resetDraft: true });
		expect(root.querySelector<HTMLTextAreaElement>('#src')!.value).toBe(SRC);
	});

	it('escapes user-derived text in the share panel and versions', () => {
		const doc = makeDoc({
			links: { view: '/d/doc1#k=<img src=x onerror=alert(1)>' },
			versions: [{ id: 'v', at: '<b>not-a-date</b>', size: 1 }]
		});
		renderEditor(root, doc);
		expect(root.querySelector('#share-pop img')).toBeNull();
		expect(root.querySelector('#versions b')).toBeNull();
	});
});
