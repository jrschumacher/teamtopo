import { describe, expect, it } from 'vitest';
import { editLink, parseFragment, teamLink, versionLink, viewLink } from './links';

describe('parseFragment', () => {
	it('reads the secret from #s=', () => {
		expect(parseFragment('#s=abc_-1')).toEqual({ secret: 'abc_-1' });
	});

	it('reads the view key from #k=', () => {
		expect(parseFragment('#k=xyz')).toEqual({ viewKey: 'xyz' });
	});

	it('tolerates a missing hash sign and extra params', () => {
		expect(parseFragment('k=xyz&other=1')).toEqual({ viewKey: 'xyz' });
	});

	it('returns an empty object for no or unknown fragment', () => {
		expect(parseFragment('')).toEqual({});
		expect(parseFragment('#')).toEqual({});
		expect(parseFragment('#src=abc')).toEqual({});
		expect(parseFragment('#s=')).toEqual({});
	});
});

describe('link builders', () => {
	it('builds edit and view links per the contract', () => {
		expect(editLink('id1', 'SECRET')).toBe('/d/id1#s=SECRET');
		expect(viewLink('id1', 'KEY')).toBe('/d/id1#k=KEY');
	});

	it('builds team and version links carrying the fragment', () => {
		expect(teamLink('id1', 'checkout', '#k=KEY')).toBe('/d/id1/team/checkout#k=KEY');
		expect(versionLink('id1', '00000000000001-abcd', '#s=S')).toBe(
			'/d/id1/v/00000000000001-abcd#s=S'
		);
	});

	it('encodes path segments', () => {
		expect(teamLink('a b', 'x/y', '')).toBe('/d/a%20b/team/x%2Fy');
	});

	it('round-trips through parseFragment', () => {
		const link = viewLink('id1', 'KEY');
		expect(parseFragment(link.slice(link.indexOf('#')))).toEqual({ viewKey: 'KEY' });
	});
});
