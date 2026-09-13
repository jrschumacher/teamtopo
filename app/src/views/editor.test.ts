import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/api';
import type { OpenedDoc, Version } from '../lib/types';
import { MAX_ZOOM, MIN_ZOOM, naturalSize, WORKSPACE_KEY } from '../lib/workspace';
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
		expect(document.title).toBe('Shop · teamtopo');
		type(root, SRC.replace('title Shop', 'title Renamed Co'));
		vi.advanceTimersByTime(200);
		expect(root.querySelector('#doc-title')!.textContent).toBe('Renamed Co');
		expect(document.title).toBe('Renamed Co · teamtopo');
	});

	it('falls back to "Untitled diagram" when the source has no title', () => {
		renderEditor(root, makeDoc({ source: 'teamTopology\n  stream a "A"\n' }));
		expect(root.querySelector('#doc-title')!.textContent).toBe('Untitled diagram');
		expect(document.title).toBe('teamtopo');
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

	it('marks the failing line in the highlight layer with the error message as a title', () => {
		vi.useFakeTimers();
		renderEditor(root, makeDoc());
		type(root, 'teamTopology\n  stream a "A"\n  bogus line here\n');
		vi.advanceTimersByTime(200);
		const marked = root.querySelector('#highlight .ed-line-error');
		expect(marked).not.toBeNull();
		expect(marked!.getAttribute('title')).toMatch(/^Line 3:/);
		expect(marked!.textContent).toBe('  bogus line here');
	});

	it('clears the highlight line mark once the source parses again', () => {
		vi.useFakeTimers();
		renderEditor(root, makeDoc());
		type(root, 'teamTopology\n  stream a "A"\n  bogus line here\n');
		vi.advanceTimersByTime(200);
		expect(root.querySelector('#highlight .ed-line-error')).not.toBeNull();
		type(root, SRC);
		vi.advanceTimersByTime(200);
		expect(root.querySelector('#highlight .ed-line-error')).toBeNull();
		expect(root.querySelector('#gutter span.err')).toBeNull();
	});

	it('marks the render status as stale with the failing line, then restores timing on success', () => {
		vi.useFakeTimers();
		renderEditor(root, makeDoc());
		expect(root.querySelector('#render-status')!.textContent).toMatch(/^rendered in \d+ ms$/);
		type(root, 'teamTopology\n  stream a "A"\n  bogus line here\n');
		vi.advanceTimersByTime(200);
		expect(root.querySelector('#render-status')!.textContent).toBe(
			'showing last good render · fix line 3'
		);
		type(root, SRC);
		vi.advanceTimersByTime(200);
		expect(root.querySelector('#render-status')!.textContent).toMatch(/^rendered in \d+ ms$/);
	});

	it('says to fix the source when there is no last good render yet', () => {
		vi.useFakeTimers();
		renderEditor(root, null, { starter: 'teamTopology\n  bogus line here\n' });
		vi.advanceTimersByTime(200);
		expect(root.querySelector('#render-status')!.textContent).toBe(
			'Fix the source to see the diagram.'
		);
	});

	it('jumps the caret to the failing line when the status strip is clicked', () => {
		vi.useFakeTimers();
		renderEditor(root, makeDoc());
		type(root, 'teamTopology\n  stream a "A"\n  bogus line here\n');
		vi.advanceTimersByTime(200);
		const status = root.querySelector<HTMLElement>('#status')!;
		expect(status.getAttribute('role')).toBe('button');
		expect(status.getAttribute('tabindex')).toBe('0');
		status.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		const ta = root.querySelector<HTMLTextAreaElement>('#src')!;
		expect(document.activeElement).toBe(ta);
		expect(ta.selectionStart).toBe(ta.value.indexOf('  bogus line here'));
		expect(ta.selectionEnd).toBe(ta.selectionStart);
		expect(ta.scrollTop).toBe(40);
	});

	it('does not mark a line or make the strip jumpable for a non-ParseError failure', async () => {
		vi.useFakeTimers();
		const teamtopo = await import('@lib/teamtopo');
		const spy = vi.spyOn(teamtopo, 'parse').mockImplementation(() => {
			throw new Error('boom');
		});
		renderEditor(root, makeDoc());
		type(root, SRC + '  stream search "Search"\n');
		vi.advanceTimersByTime(200);
		expect(root.querySelector('#status')!.classList.contains('error')).toBe(true);
		expect(root.querySelector('#status-text')!.textContent).toBe('boom');
		expect(root.querySelector('#gutter span.err')).toBeNull();
		expect(root.querySelector('#highlight .ed-line-error')).toBeNull();
		const status = root.querySelector<HTMLElement>('#status')!;
		expect(status.getAttribute('role')).toBeNull();
		expect(status.hasAttribute('tabindex')).toBe(false);
		spy.mockRestore();
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

	describe('workspace panes and renderer viewport', () => {
		/** happy-dom does no layout: give an element the box a browser would have given it. */
		function stubBox(
			el: Element,
			box: { w: number; h: number; scrollW?: number; scrollH?: number }
		) {
			for (const [prop, value] of [
				['clientWidth', box.w],
				['clientHeight', box.h],
				['scrollWidth', box.scrollW ?? box.w],
				['scrollHeight', box.scrollH ?? box.h]
			] as const) {
				Object.defineProperty(el, prop, { value, configurable: true });
			}
			el.getBoundingClientRect = () =>
				({
					x: 0,
					y: 0,
					left: 0,
					top: 0,
					width: box.w,
					height: box.h,
					right: box.w,
					bottom: box.h,
					toJSON: () => ({})
				}) as DOMRect;
		}

		const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
		const mode = () => $('#work').dataset.paneMode;
		const split = () => $('#work').style.getPropertyValue('--ed-split');
		const zoomText = () => $('#zoom-level').textContent;
		const svgSize = () => {
			const svg = root.querySelector('#canvas svg')!;
			return { w: Number(svg.getAttribute('width')), h: Number(svg.getAttribute('height')) };
		};
		const natural = () => naturalSize(root.querySelector('#canvas svg'))!;
		const resize = () => window.dispatchEvent(new Event('resize'));
		const key = (el: Element, init: KeyboardEventInit) =>
			el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
		const pointer = (el: Element, type: string, init: PointerEventInit = {}) =>
			el.dispatchEvent(
				new PointerEvent(type, {
					bubbles: true,
					cancelable: true,
					pointerId: 1,
					button: 0,
					...init
				})
			);

		it('opens in split view with a divider between the panes', () => {
			renderEditor(root, makeDoc());
			expect(mode()).toBe('split');
			expect($('#pane-split').getAttribute('aria-pressed')).toBe('true');
			expect($('#pane-editor').getAttribute('aria-pressed')).toBe('false');
			const divider = $('#split');
			expect(divider.getAttribute('role')).toBe('separator');
			expect(divider.getAttribute('aria-orientation')).toBe('vertical');
			expect(divider.tabIndex).toBe(0);
			expect(divider.getAttribute('aria-valuenow')).toBe('40');
			expect(split()).toBe('40.00%');
		});

		it('collapses to editor-only and back to split from the always-visible switch', () => {
			renderEditor(root, makeDoc());
			$('#pane-editor').click();
			expect(mode()).toBe('editor');
			expect($('#pane-editor').getAttribute('aria-pressed')).toBe('true');
			// The restore control lives in the header, so it survives the collapse.
			expect($('#pane-split').isConnected).toBe(true);
			$('#pane-split').click();
			expect(mode()).toBe('split');
			expect($('#pane-split').getAttribute('aria-pressed')).toBe('true');
		});

		it('collapses to renderer-only and moves focus out of the pane it hides', () => {
			renderEditor(root, makeDoc());
			$('#src').focus();
			$('#pane-renderer').click();
			expect(mode()).toBe('renderer');
			expect(document.activeElement).toBe($('#pane-renderer'));

			$('#canvas').focus();
			$('#pane-editor').click();
			expect(mode()).toBe('editor');
			expect(document.activeElement).toBe($('#pane-editor'));
		});

		it('leaves focus alone when the hidden pane did not hold it', () => {
			renderEditor(root, makeDoc());
			$('#src').focus();
			$('#pane-editor').click();
			expect(document.activeElement).toBe($('#src'));
		});

		it('resizes the panes from the keyboard, clamped to the pane minimums', () => {
			renderEditor(root, makeDoc());
			const divider = $('#split');
			stubBox($('#work'), { w: 1000, h: 600 });

			key(divider, { key: 'ArrowRight' });
			expect(divider.getAttribute('aria-valuenow')).toBe('42');
			expect(split()).toBe('42.00%');
			key(divider, { key: 'ArrowRight', shiftKey: true });
			expect(divider.getAttribute('aria-valuenow')).toBe('52');
			key(divider, { key: 'ArrowLeft' });
			expect(divider.getAttribute('aria-valuenow')).toBe('50');

			// 260px minimum per pane at 1000px wide → 26%…74%.
			key(divider, { key: 'End' });
			expect(divider.getAttribute('aria-valuenow')).toBe('74');
			key(divider, { key: 'Home' });
			expect(divider.getAttribute('aria-valuenow')).toBe('26');
			key(divider, { key: 'Enter' });
			expect(divider.getAttribute('aria-valuenow')).toBe('40');
		});

		it('resizes the panes by dragging the divider', () => {
			renderEditor(root, makeDoc());
			const divider = $('#split');
			stubBox($('#work'), { w: 1000, h: 600 });

			pointer(divider, 'pointerdown', { clientX: 400, clientY: 300 });
			expect(divider.classList.contains('is-dragging')).toBe(true);
			pointer(divider, 'pointermove', { clientX: 600, clientY: 300 });
			expect(split()).toBe('60.00%');
			pointer(divider, 'pointermove', { clientX: 990, clientY: 300 });
			expect(split()).toBe('74.00%');
			pointer(divider, 'pointerup', { clientX: 990, clientY: 300 });
			expect(divider.classList.contains('is-dragging')).toBe(false);

			// The drag is over: further moves do not resize.
			pointer(divider, 'pointermove', { clientX: 300, clientY: 300 });
			expect(split()).toBe('74.00%');
		});

		it('resets the split on a double-click of the divider', () => {
			renderEditor(root, makeDoc());
			stubBox($('#work'), { w: 1000, h: 600 });
			key($('#split'), { key: 'End' });
			expect(split()).toBe('74.00%');
			$('#split').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
			expect(split()).toBe('40.00%');
		});

		it('remembers pane mode, split ratio and zoom across a reload', () => {
			renderEditor(root, makeDoc());
			stubBox($('#work'), { w: 1000, h: 600 });
			key($('#split'), { key: 'ArrowRight' });
			$('#zoom-in').click();
			$('#pane-renderer').click();
			expect(zoomText()).toBe('125%');

			const next = document.createElement('div');
			document.body.appendChild(next);
			renderEditor(next, makeDoc());
			expect(next.querySelector<HTMLElement>('#work')!.dataset.paneMode).toBe('renderer');
			expect(next.querySelector<HTMLElement>('#work')!.style.getPropertyValue('--ed-split')).toBe(
				'42.00%'
			);
			expect(next.querySelector('#zoom-level')!.textContent).toBe('125%');
			next.remove();
		});

		it('starts from the defaults when the stored workspace is unreadable', () => {
			localStorage.setItem(WORKSPACE_KEY, '{ broken');
			renderEditor(root, makeDoc());
			expect(mode()).toBe('split');
			expect(split()).toBe('40.00%');
			expect(zoomText()).toBe('100%');
		});

		it('renders normally when localStorage itself throws', () => {
			vi.stubGlobal('localStorage', {
				getItem: () => {
					throw new Error('blocked');
				},
				setItem: () => {
					throw new Error('blocked');
				},
				removeItem: () => {
					throw new Error('blocked');
				}
			});
			renderEditor(root, makeDoc());
			expect(mode()).toBe('split');
			expect(zoomText()).toBe('100%');
			expect(() => $('#zoom-in').click()).not.toThrow();
			expect(zoomText()).toBe('125%');
		});

		it('zooms through a fixed ladder, scaling the SVG but never its viewBox', () => {
			renderEditor(root, makeDoc());
			const nat = natural();
			const viewBox = root.querySelector('#canvas svg')!.getAttribute('viewBox');
			expect(zoomText()).toBe('100%');

			$('#zoom-in').click();
			expect(zoomText()).toBe('125%');
			expect(svgSize()).toEqual({
				w: Math.round(nat.w * 1.25),
				h: Math.round(nat.h * 1.25)
			});
			// Scaling the element, not the coordinate system: the diagram stays vector-sharp.
			expect(root.querySelector('#canvas svg')!.getAttribute('viewBox')).toBe(viewBox);

			$('#zoom-out').click();
			$('#zoom-out').click();
			expect(zoomText()).toBe('75%');
			$('#zoom-reset').click();
			expect(zoomText()).toBe('100%');
			expect(svgSize()).toEqual({ w: nat.w, h: nat.h });
			expect($('#zoom-reset').getAttribute('aria-label')).toBe('Zoom 100%, reset to 100%');
		});

		it('keeps zoom inside its bounds and disables the control at each end', () => {
			renderEditor(root, makeDoc());
			for (let i = 0; i < 12; i++) $('#zoom-in').click();
			expect(zoomText()).toBe(`${MAX_ZOOM * 100}%`);
			expect($<HTMLButtonElement>('#zoom-in').disabled).toBe(true);
			expect($<HTMLButtonElement>('#zoom-out').disabled).toBe(false);

			for (let i = 0; i < 14; i++) $('#zoom-out').click();
			expect(zoomText()).toBe(`${MIN_ZOOM * 100}%`);
			expect($<HTMLButtonElement>('#zoom-out').disabled).toBe(true);
			expect($<HTMLButtonElement>('#zoom-in').disabled).toBe(false);
		});

		it('fits the diagram to the viewport and re-fits when the viewport changes', () => {
			renderEditor(root, makeDoc());
			const nat = natural();
			// Fit is the default; 24px of canvas padding on each side.
			stubBox($('#canvas'), { w: 400, h: 300 });
			const fitted = Math.min(352 / nat.w, 252 / nat.h);

			resize();
			expect($('#fit').getAttribute('aria-pressed')).toBe('true');
			expect(zoomText()).toBe(`${Math.round(fitted * 100)}%`);
			expect(svgSize()).toEqual({
				w: Math.round(nat.w * fitted),
				h: Math.round(nat.h * fitted)
			});

			// A wider pane re-fits on its own, with no stale scale left behind.
			stubBox($('#canvas'), { w: 800, h: 600 });
			resize();
			const refitted = Math.min(752 / nat.w, 552 / nat.h);
			expect(zoomText()).toBe(`${Math.round(refitted * 100)}%`);
			expect(svgSize()).toEqual({
				w: Math.round(nat.w * refitted),
				h: Math.round(nat.h * refitted)
			});
		});

		it('re-fits after collapsing, restoring and switching panes', () => {
			renderEditor(root, makeDoc());
			const nat = natural();
			stubBox($('#canvas'), { w: 400, h: 300 });
			resize();
			const narrowFit = Math.round(Math.min(352 / nat.w, 252 / nat.h) * 100);
			expect(zoomText()).toBe(`${narrowFit}%`);

			// Renderer-only hands the diagram the whole workspace.
			stubBox($('#canvas'), { w: 1000, h: 700 });
			$('#pane-renderer').click();
			const wideFit = Math.round(Math.min(952 / nat.w, 652 / nat.h) * 100);
			expect(zoomText()).toBe(`${wideFit}%`);

			// Editor-only leaves the diagram without a viewport: the last good scale stands.
			$('#pane-editor').click();
			expect(zoomText()).toBe(`${wideFit}%`);

			stubBox($('#canvas'), { w: 400, h: 300 });
			$('#pane-split').click();
			expect(zoomText()).toBe(`${narrowFit}%`);
		});

		it('turns fit off on a manual zoom, and fits again on demand', () => {
			renderEditor(root, makeDoc());
			const nat = natural();
			stubBox($('#canvas'), { w: 400, h: 300 });
			resize();
			expect($('#fit').getAttribute('aria-pressed')).toBe('true');

			$('#zoom-in').click();
			expect($('#fit').getAttribute('aria-pressed')).toBe('false');
			// A resize no longer moves the zoom the user chose.
			const chosen = zoomText();
			stubBox($('#canvas'), { w: 900, h: 700 });
			resize();
			expect(zoomText()).toBe(chosen);

			$('#fit').click();
			expect($('#fit').getAttribute('aria-pressed')).toBe('true');
			expect(zoomText()).toBe(`${Math.round(Math.min(852 / nat.w, 652 / nat.h) * 100)}%`);
		});

		it('releases fit without moving the diagram when Fit is pressed again', () => {
			renderEditor(root, makeDoc());
			stubBox($('#canvas'), { w: 400, h: 300 });
			resize();
			const fitted = zoomText();
			$('#fit').click();
			expect($('#fit').getAttribute('aria-pressed')).toBe('false');
			expect(zoomText()).toBe(fitted);
			// …and it stays put when the pane changes size, because fit is off now.
			stubBox($('#canvas'), { w: 900, h: 700 });
			resize();
			expect(zoomText()).toBe(fitted);
		});

		it('zooms with ctrl/⌘ + wheel and leaves a plain wheel to scroll', () => {
			renderEditor(root, makeDoc());
			const canvas = $('#canvas');
			stubBox(canvas, { w: 400, h: 300 });

			const plain = new WheelEvent('wheel', { deltaY: -120, cancelable: true, bubbles: true });
			canvas.dispatchEvent(plain);
			expect(plain.defaultPrevented).toBe(false);
			expect(zoomText()).toBe('100%');

			const pinch = new WheelEvent('wheel', {
				deltaY: -180,
				clientX: 200,
				clientY: 150,
				cancelable: true,
				bubbles: true
			});
			// happy-dom drops modifier keys from the WheelEvent init.
			Object.defineProperty(pinch, 'ctrlKey', { value: true });
			canvas.dispatchEvent(pinch);
			expect(pinch.defaultPrevented).toBe(true);
			expect(zoomText()).toBe('272%'); // e¹ ≈ 2.718
			expect($('#fit').getAttribute('aria-pressed')).toBe('false');
		});

		it('zooms and fits from the keyboard with the canvas focused', () => {
			renderEditor(root, makeDoc());
			const canvas = $('#canvas');
			stubBox(canvas, { w: 400, h: 300 });
			const nat = natural();

			key(canvas, { key: '+' });
			expect(zoomText()).toBe('125%');
			key(canvas, { key: '-' });
			expect(zoomText()).toBe('100%');
			key(canvas, { key: '+' });
			key(canvas, { key: '0' });
			expect(zoomText()).toBe('100%');
			key(canvas, { key: 'f' });
			expect(zoomText()).toBe(`${Math.round(Math.min(352 / nat.w, 252 / nat.h) * 100)}%`);
			expect($('#fit').getAttribute('aria-pressed')).toBe('true');
		});

		it('pans the viewport by dragging, without opening the team under the pointer', () => {
			renderEditor(root, makeDoc());
			const canvas = $('#canvas');
			// Zoomed in: the diagram overflows its viewport, so the canvas can pan.
			stubBox(canvas, { w: 400, h: 300, scrollW: 1200, scrollH: 900 });
			canvas.scrollLeft = 100;
			canvas.scrollTop = 50;
			$('#zoom-in').click();
			expect(canvas.classList.contains('can-pan')).toBe(true);

			const team = root.querySelector<SVGElement>('#canvas .tt-node[data-id="checkout"]')!;
			pointer(team, 'pointerdown', { clientX: 200, clientY: 150 });
			pointer(canvas, 'pointermove', { clientX: 160, clientY: 120 });
			expect(canvas.classList.contains('is-panning')).toBe(true);
			expect(canvas.scrollLeft).toBe(140);
			expect(canvas.scrollTop).toBe(80);
			pointer(canvas, 'pointerup', { clientX: 160, clientY: 120 });
			expect(canvas.classList.contains('is-panning')).toBe(false);

			team.dispatchEvent(new MouseEvent('click', { bubbles: true }));
			expect(location.pathname).toBe('/new');

			// A press that did not pan still picks the team.
			pointer(team, 'pointerdown', { clientX: 200, clientY: 150 });
			pointer(canvas, 'pointerup', { clientX: 200, clientY: 150 });
			team.dispatchEvent(new MouseEvent('click', { bubbles: true }));
			expect(location.pathname).toBe('/d/doc1/team/checkout');
		});

		it('reports the unscaled diagram size while zoomed', () => {
			renderEditor(root, makeDoc());
			const nat = natural();
			const dims = $('#dims').textContent;
			expect(dims).toBe(`${nat.w | 0} × ${nat.h | 0}`);
			$('#zoom-in').click();
			expect($('#dims').textContent).toBe(dims);
		});
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
