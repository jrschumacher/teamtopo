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
		expect(root.querySelector('#status-text')!.textContent).toBe('2 teams, 1 interaction');
	});

	it('disables Save until the source changes, then enables it', () => {
		vi.useFakeTimers();
		renderEditor(root, makeDoc());
		const save = root.querySelector<HTMLButtonElement>('#save')!;
		expect(save.disabled).toBe(true);
		type(root, SRC + '  stream search "Search"\n');
		expect(save.disabled).toBe(false);
		vi.advanceTimersByTime(200);
		expect(root.querySelector('#status-text')!.textContent).toBe('3 teams, 1 interaction');
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

	it('lists share links with a write-access warning and versions newest first', () => {
		renderEditor(root, makeDoc());
		const view = root.querySelector<HTMLInputElement>('#view-link')!;
		const edit = root.querySelector<HTMLInputElement>('#edit-link')!;
		expect(view.value).toBe(`${location.origin}/d/doc1#k=KEY`);
		expect(edit.value).toBe(`${location.origin}/d/doc1#s=SECRET`);
		expect(root.querySelector('.warn')!.textContent).toMatch(/edit link/i);
		const links = [...root.querySelectorAll<HTMLAnchorElement>('#versions a')].map((a) =>
			a.getAttribute('href')
		);
		expect(links).toEqual([`/d/doc1/v/${V2.id}#s=SECRET`, `/d/doc1/v/${V1.id}#s=SECRET`]);
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
		expect(root.querySelector('#saved-state')!.textContent).toBe('Saved');
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
		const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
			new Response(JSON.stringify({ id: 'new1', version: { ...V0, at: Date.parse(V0.at) } }), {
				status: 201
			})
		);
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

		expect(fetchMock).toHaveBeenCalledTimes(1);
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
		expect(root.querySelector('#share-body img')).toBeNull();
		expect(root.querySelector('#versions b')).toBeNull();
	});
});
