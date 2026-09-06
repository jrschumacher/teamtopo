import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpenedDoc, Version } from '../lib/types';
import { readApiBlock } from '../lib/apiblock';
import { renderTeamView } from './team';

const SRC = [
	'teamTopology',
	'  stream checkout "Checkout"',
	'  stream search "Search"',
	'  platform infra "Infra"',
	'  infra --> checkout : CI',
	'  api checkout {',
	'    focus: the checkout experience end to end',
	'    sync: 09:30 UTC',
	'  }',
	''
].join('\n');

function makeDoc(overrides: Partial<OpenedDoc> = {}): OpenedDoc {
	return {
		id: 'doc1',
		source: SRC,
		version: null,
		versions: [],
		canEdit: false,
		links: { view: '/d/doc1#k=abc' },
		fragment: '#k=abc',
		...overrides
	};
}

describe('renderTeamView', () => {
	let root: HTMLElement;

	beforeEach(() => {
		root = document.createElement('div');
	});

	it('renders the team focus text and a breadcrumb back to the diagram', () => {
		renderTeamView(root, makeDoc(), 'checkout');
		expect(root.textContent).toContain('the checkout experience end to end');
		const back = root.querySelector('a[href^="/d/doc1"]') as HTMLAnchorElement | null;
		expect(back).not.toBeNull();
		expect(back!.getAttribute('href')).toBe('/d/doc1#k=abc');
	});

	it('lists every other team with fragment-preserving hrefs', () => {
		renderTeamView(root, makeDoc(), 'checkout');
		const links = Array.from(root.querySelectorAll('a')).map((a) => a.getAttribute('href'));
		expect(links).toContain('/d/doc1/team/search#k=abc');
		expect(links).toContain('/d/doc1/team/infra#k=abc');
		// the current team is not listed as "another team"
		expect(links).not.toContain('/d/doc1/team/checkout#k=abc');
	});

	it('shows no edit form for a read-only doc', () => {
		renderTeamView(root, makeDoc({ canEdit: false }), 'checkout');
		expect(root.querySelector('form')).toBeNull();
	});

	it('shows a prefilled edit form and saves an updated source through doc.save', async () => {
		const saved: string[] = [];
		const save = vi.fn(async (source: string) => {
			saved.push(source);
			return { id: 'v2', at: new Date().toISOString(), size: source.length } as Version;
		});
		renderTeamView(root, makeDoc({ canEdit: true, save }), 'checkout');

		const form = root.querySelector('form');
		expect(form).not.toBeNull();
		const syncInput = form!.querySelector('input[name="sync"]') as HTMLInputElement;
		expect(syncInput.value).toBe('09:30 UTC');

		syncInput.value = '14:00 UTC';
		form!.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
		await Promise.resolve();
		await Promise.resolve();

		expect(save).toHaveBeenCalledTimes(1);
		expect(saved).toHaveLength(1);
		const newSource = saved[0];
		expect(readApiBlock(newSource, 'checkout')).toEqual({
			focus: 'the checkout experience end to end',
			sync: '14:00 UTC'
		});
	});

	it('shows a friendly message and the team list for an unknown team id', () => {
		renderTeamView(root, makeDoc(), 'nope');
		expect(root.textContent).toContain('nope');
		expect(root.textContent?.toLowerCase()).toContain('no team');
		const links = Array.from(root.querySelectorAll('a')).map((a) => a.getAttribute('href'));
		expect(links).toContain('/d/doc1/team/checkout#k=abc');
		expect(links).toContain('/d/doc1/team/search#k=abc');
	});

	it('escapes user-controlled text such as the team label', () => {
		const src = SRC.replace('"Checkout"', '"<img src=x onerror=alert(1)>"');
		renderTeamView(root, makeDoc({ source: src }), 'checkout');
		expect(root.innerHTML).not.toContain('<img src=x');
	});
});
