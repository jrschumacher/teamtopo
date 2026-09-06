import { describe, expect, it } from 'vitest';
import { matchRoute } from './router';

describe('matchRoute', () => {
	it('matches the route table', () => {
		expect(matchRoute('/')).toEqual({ name: 'home', params: {} });
		expect(matchRoute('/new')).toEqual({ name: 'new', params: {} });
		expect(matchRoute('/d/abc')).toEqual({ name: 'doc', params: { id: 'abc' } });
		expect(matchRoute('/d/abc/v/00000000000001-zz9a')).toEqual({
			name: 'version',
			params: { id: 'abc', vid: '00000000000001-zz9a' }
		});
		expect(matchRoute('/d/abc/team/checkout')).toEqual({
			name: 'team',
			params: { id: 'abc', teamId: 'checkout' }
		});
	});

	it('tolerates a trailing slash and decodes segments', () => {
		expect(matchRoute('/new/')).toEqual({ name: 'new', params: {} });
		expect(matchRoute('/d/a%20b')).toEqual({ name: 'doc', params: { id: 'a b' } });
	});

	it('returns null for unknown paths', () => {
		expect(matchRoute('/nope')).toBeNull();
		expect(matchRoute('/d')).toBeNull();
		expect(matchRoute('/d/abc/team')).toBeNull();
		expect(matchRoute('/d/abc/x/y')).toBeNull();
	});
});
