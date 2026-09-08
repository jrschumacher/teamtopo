import { afterEach, describe, expect, it, vi } from 'vitest';
import { matchRoute, startRouter, type Route } from './router';

describe('matchRoute', () => {
	it('matches the route table', () => {
		expect(matchRoute('/')).toEqual({ name: 'home', params: {} });
		expect(matchRoute('/new')).toEqual({ name: 'new', params: {} });
		expect(matchRoute('/privacy')).toEqual({ name: 'privacy', params: {} });
		expect(matchRoute('/terms')).toEqual({ name: 'terms', params: {} });
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

describe('startRouter', () => {
	let stop: (() => void) | undefined;
	let root: HTMLElement;

	/** A render that draws a page with an in-page anchor target and a few links. */
	function draw(route: Route | null, el: HTMLElement): void {
		el.innerHTML =
			`<p data-route="${route?.name ?? 'none'}"></p>` +
			'<a id="to-features" href="#features">Features</a>' +
			'<a id="to-home-features" href="/#features">Features</a>' +
			'<a id="to-privacy" href="/privacy">Privacy</a>' +
			'<a id="to-doc" href="/d/abc">Doc</a>' +
			'<section id="features"></section>';
	}

	function boot(path: string): ReturnType<typeof vi.fn> {
		history.replaceState(null, '', path);
		root = document.createElement('div');
		document.body.appendChild(root);
		const render = vi.fn(draw);
		stop = startRouter(root, render);
		return render;
	}

	function click(id: string): MouseEvent {
		const a = document.getElementById(id);
		if (!a) throw new Error(`missing #${id}`);
		const ev = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
		a.dispatchEvent(ev);
		return ev;
	}

	afterEach(() => {
		stop?.();
		root.remove();
		vi.restoreAllMocks();
		history.replaceState(null, '', '/');
	});

	it('a hash-only link on the current route scrolls to the anchor without re-rendering', () => {
		const scroll = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
		const render = boot('/');
		expect(render).toHaveBeenCalledTimes(1);
		const sentinel = root.querySelector('#features');

		click('to-features');

		expect(render).toHaveBeenCalledTimes(1);
		expect(location.pathname).toBe('/');
		expect(location.hash).toBe('#features');
		expect(root.querySelector('#features')).toBe(sentinel);
		expect(scroll).toHaveBeenCalledTimes(1);
		expect(scroll.mock.instances[0]).toBe(sentinel);

		// `/#features` while already on `/` is the same in-page anchor.
		click('to-home-features');
		expect(render).toHaveBeenCalledTimes(1);
		expect(scroll).toHaveBeenCalledTimes(2);
	});

	it('a hash link from another route navigates there and then scrolls to the anchor', () => {
		const scroll = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
		const render = boot('/privacy');
		expect(render).toHaveBeenLastCalledWith({ name: 'privacy', params: {} }, root);

		click('to-home-features');

		expect(render).toHaveBeenCalledTimes(2);
		expect(render).toHaveBeenLastCalledWith({ name: 'home', params: {} }, root);
		expect(location.pathname).toBe('/');
		expect(location.hash).toBe('#features');
		expect(scroll).toHaveBeenCalledTimes(1);
		expect(scroll.mock.instances[0]).toBe(root.querySelector('#features'));
	});

	it('a path change still navigates and carries a key fragment along', () => {
		const render = boot('/#k=viewkey');
		click('to-doc');
		expect(render).toHaveBeenCalledTimes(2);
		expect(render).toHaveBeenLastCalledWith({ name: 'doc', params: { id: 'abc' } }, root);
		expect(location.pathname).toBe('/d/abc');
		expect(location.hash).toBe('#k=viewkey');

		click('to-privacy');
		expect(render).toHaveBeenLastCalledWith({ name: 'privacy', params: {} }, root);
	});
});
