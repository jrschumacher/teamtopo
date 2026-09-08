import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ATTRIBUTION_HTML } from './chrome';
import { EFFECTIVE_DATE, renderLegal } from './legal';

let root: HTMLElement;

beforeEach(() => {
	root = document.createElement('div');
	document.body.appendChild(root);
});

afterEach(() => {
	root.remove();
});

describe('renderLegal', () => {
	it('renders the privacy page with the landing chrome and the tab title', () => {
		renderLegal(root, 'privacy');
		expect(document.title).toBe('Privacy · teamtopo');
		expect(root.querySelector('#landing-nav')).not.toBeNull();
		expect(root.querySelector('#site-footer')).not.toBeNull();
		expect(root.querySelector('.legal-title')?.textContent).toBe('Privacy');
		expect(root.querySelector('time')?.getAttribute('datetime')).toBe(EFFECTIVE_DATE.iso);
		const text = root.querySelector('.legal-doc')?.textContent ?? '';
		expect(text).toContain('AES-256-GCM');
		expect(text).toContain('teamtopo.draft');
		expect(text).toContain('hello@teamtopo.dev');
		expect(root.querySelector('.legal-doc a[href="mailto:hello@teamtopo.dev"]')).not.toBeNull();
	});

	it('renders the terms page with the footer attribution wording verbatim', () => {
		renderLegal(root, 'terms');
		expect(document.title).toBe('Terms · teamtopo');
		expect(root.querySelector('.legal-title')?.textContent).toBe('Terms');
		expect(root.querySelector('.legal-doc')?.innerHTML).toContain(ATTRIBUTION_HTML);
		expect(root.querySelector('#attribution')?.innerHTML).toBe(ATTRIBUTION_HTML);
		expect(root.querySelector('.legal-doc')?.textContent).not.toContain('governing law');
	});

	it('links Features to the landing anchor and the footer to both legal pages', () => {
		renderLegal(root, 'terms');
		expect(root.querySelector<HTMLAnchorElement>('.nav-link')?.getAttribute('href')).toBe(
			'/#features'
		);
		expect(root.querySelector('#footer-privacy')?.getAttribute('href')).toBe('/privacy');
		expect(root.querySelector('#footer-terms')?.getAttribute('href')).toBe('/terms');
	});
});
