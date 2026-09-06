import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { OpenedDoc, Version } from '../lib/types';
import { renderViewer } from './viewer';

const SRC = [
	'teamTopology',
	'  title Shop <b>bold</b>',
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
		canEdit: false,
		links: { view: '/d/doc1#k=KEY' },
		fragment: '#k=KEY',
		...overrides
	};
}

describe('renderViewer', () => {
	let root: HTMLElement;

	beforeEach(() => {
		root = document.createElement('div');
		document.body.appendChild(root);
		history.replaceState(null, '', '/d/doc1#k=KEY');
	});
	afterEach(() => root.remove());

	it('renders the diagram, escaped title, team links and versions', () => {
		renderViewer(root, makeDoc());
		expect(root.querySelector('#canvas svg')).not.toBeNull();
		expect(root.querySelector('h1')!.textContent).toBe('Shop <b>bold</b>');
		expect(root.querySelector('h1 b')).toBeNull();
		const teams = [...root.querySelectorAll<HTMLAnchorElement>('.team-list a')].map((a) =>
			a.getAttribute('href')
		);
		expect(teams).toEqual(['/d/doc1/team/checkout#k=KEY', '/d/doc1/team/infra#k=KEY']);
		const versions = [...root.querySelectorAll<HTMLAnchorElement>('.versions a')].map((a) =>
			a.getAttribute('href')
		);
		expect(versions).toEqual([`/d/doc1/v/${V2.id}#k=KEY`, `/d/doc1/v/${V1.id}#k=KEY`]);
		expect(root.querySelector('#open-editor')).toBeNull();
		expect(root.querySelector('.version-bar')).toBeNull();
	});

	it('shows an open-editor link when the doc can be edited', () => {
		renderViewer(
			root,
			makeDoc({
				canEdit: true,
				links: { view: '/d/doc1#k=KEY', edit: '/d/doc1#s=SECRET' },
				fragment: '#s=SECRET'
			})
		);
		expect(root.querySelector<HTMLAnchorElement>('#open-editor')!.getAttribute('href')).toBe(
			'/d/doc1#s=SECRET'
		);
	});

	it('shows the version bar with a back-to-latest link for a version', () => {
		renderViewer(root, makeDoc({ version: V1 }), { versionId: V1.id });
		const bar = root.querySelector('.version-bar')!;
		expect(bar.textContent).toMatch(/Viewing version/);
		expect(bar.querySelector('a')!.getAttribute('href')).toBe('/d/doc1#k=KEY');
		const tagged = root.querySelector('.versions .tag')!.closest('li')!;
		expect(tagged.querySelector('a')!.getAttribute('href')).toContain(V1.id);
	});

	it('navigates to the team page when a team is clicked', () => {
		renderViewer(root, makeDoc());
		const g = root.querySelector<SVGElement>('#canvas .tt-node[data-id="infra"]')!;
		g.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		expect(location.pathname).toBe('/d/doc1/team/infra');
		expect(location.hash).toBe('#k=KEY');
	});

	it('reports a syntax error instead of throwing', () => {
		renderViewer(root, makeDoc({ source: 'nonsense' }));
		expect(root.querySelector('#canvas .empty')!.textContent).toMatch(/syntax error/);
	});
});
