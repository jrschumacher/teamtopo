import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpenedDoc, Version } from '../lib/types';
import { readApiBlock } from '../lib/apiblock';
import { renderTeamView } from './team';

const SRC = [
	'teamTopology',
	'  stream checkout "Checkout" [size=7, note="Owns checkout, chargebacks and refunds."]',
	'  stream search "Search"',
	'  platform infra "Infra"',
	'  infra --> checkout : CI [duration=ongoing]',
	'  checkout <--> search : pairing [duration="until Q3"]',
	'  checkout ~~> search : recommendations [soon]',
	'  api checkout {',
	'    focus: the checkout experience end to end',
	'    sync: 09:30 UTC',
	'    budget: 50k',
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

function clickAction(root: HTMLElement, action: string): void {
	const el = root.querySelector<HTMLElement>(`[data-action="${action}"]`);
	if (!el) throw new Error(`no [data-action="${action}"] in the rendered page`);
	el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
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
		expect(root.querySelector('[data-action="enter-edit"]')).toBeNull();
	});

	it('shows a prefilled edit form and saves an updated source through doc.save', async () => {
		const saved: string[] = [];
		const save = vi.fn(async (source: string) => {
			saved.push(source);
			return { id: 'v2', at: new Date().toISOString(), size: source.length } as Version;
		});
		renderTeamView(root, makeDoc({ canEdit: true, save }), 'checkout');

		expect(root.querySelector('form')).toBeNull();
		clickAction(root, 'enter-edit');

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
		// edit mode closes back to view mode on a successful save
		expect(root.querySelector('form')).toBeNull();
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

	it('toggles into edit mode and Cancel discards the draft without saving', () => {
		const save = vi.fn();
		renderTeamView(root, makeDoc({ canEdit: true, save }), 'checkout');

		clickAction(root, 'enter-edit');
		const syncInput = root.querySelector('input[name="sync"]') as HTMLInputElement;
		syncInput.value = 'something else entirely';

		clickAction(root, 'cancel-edit');

		expect(root.querySelector('form')).toBeNull();
		expect(save).not.toHaveBeenCalled();
		expect(root.textContent).toContain('09:30 UTC');
	});

	it('Escape cancels edit mode like Cancel does', () => {
		renderTeamView(root, makeDoc({ canEdit: true, save: vi.fn() }), 'checkout');

		clickAction(root, 'enter-edit');
		const form = root.querySelector('form');
		expect(form).not.toBeNull();

		const syncInput = form!.querySelector('input[name="sync"]') as HTMLInputElement;
		syncInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

		expect(root.querySelector('form')).toBeNull();
	});

	it('maps api fields into their groups and lists an unrecognized field under Other', () => {
		renderTeamView(root, makeDoc(), 'checkout');

		const groupTitles = Array.from(root.querySelectorAll('.tm-section-title')).map(
			(el) => el.textContent
		);
		expect(groupTitles).toEqual(
			expect.arrayContaining([
				'Mission',
				'What we own',
				'Service level expectations',
				'Working with us',
				'Right now',
				'Other'
			])
		);
		// "budget" has no home in the five canonical groups
		expect(root.textContent).toContain('Budget');
		expect(root.textContent).toContain('50k');
		// documented fields show their value; undocumented ones say so
		expect(root.textContent).toContain('not documented yet');
	});

	it('shows the team size and note on the hero card', () => {
		renderTeamView(root, makeDoc(), 'checkout');
		expect(root.textContent).toContain('7 people');
		expect(root.textContent).toContain('Owns checkout, chargebacks and refunds.');
	});

	it('lists interactions in both directions plus a dashed "soon" list', () => {
		renderTeamView(root, makeDoc(), 'checkout');

		expect(root.textContent).toContain('Teams we currently interact with');
		// checkout is the "to" side of infra --> checkout
		expect(root.textContent).toContain('X-as-a-Service');
		expect(root.textContent).toContain('CI');
		expect(root.textContent).toContain('ongoing');
		// checkout is the "from" side of checkout <--> search
		expect(root.textContent).toContain('Collaboration');
		expect(root.textContent).toContain('until Q3');

		expect(root.textContent).toContain('Expected to interact with soon');
		expect(root.textContent).toContain('Facilitating');
		expect(root.textContent).toContain('recommendations');
		expect(root.querySelector('.tm-inter-soon')).not.toBeNull();
	});

	it('highlights the current team’s shape in the diagram aside', () => {
		renderTeamView(root, makeDoc(), 'checkout');
		const svg = root.querySelector('#team-diagram svg');
		expect(svg).not.toBeNull();
		const highlighted = root.querySelector('[data-id="checkout"].tt-team-highlight');
		expect(highlighted).not.toBeNull();
	});
});
