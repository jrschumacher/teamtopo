import { describe, expect, it } from 'vitest';
import { parse, teamApi } from '@lib/teamtopo';
import ecommerce from '../../../examples/ecommerce.tt?raw';
import { escapeHtml, renderMarkdown } from './markdown';

describe('escapeHtml', () => {
	it('escapes the HTML-significant characters', () => {
		expect(escapeHtml(`<script>&"</script>`)).toBe('&lt;script&gt;&amp;&quot;&lt;/script&gt;');
	});
});

describe('renderMarkdown', () => {
	it('renders an ATX heading', () => {
		expect(renderMarkdown('# Team API: Checkout')).toBe('<h1>Team API: Checkout</h1>');
		expect(renderMarkdown("### What we're working on")).toBe("<h3>What we're working on</h3>");
	});

	it('renders a paragraph', () => {
		expect(renderMarkdown('Date: 2026-01-02')).toBe('<p>Date: 2026-01-02</p>');
	});

	it('renders a bullet list', () => {
		expect(renderMarkdown('* one\n* two\n* three')).toBe(
			'<ul><li>one</li><li>two</li><li>three</li></ul>'
		);
	});

	it('renders a table with a header separator row', () => {
		const md = ['| A | B |', '| --- | --- |', '| 1 | 2 |', '| 3 | 4 |'].join('\n');
		expect(renderMarkdown(md)).toBe(
			'<table><thead><tr><th>A</th><th>B</th></tr></thead>' +
				'<tbody><tr><td>1</td><td>2</td></tr><tr><td>3</td><td>4</td></tr></tbody></table>'
		);
	});

	it('renders bold text', () => {
		expect(renderMarkdown('this is **bold** text')).toBe(
			'<p>this is <strong>bold</strong> text</p>'
		);
	});

	it('renders inline code', () => {
		expect(renderMarkdown('run `npm test` first')).toBe('<p>run <code>npm test</code> first</p>');
	});

	it('renders a link', () => {
		expect(renderMarkdown('see [the docs](https://example.com/x)')).toBe(
			'<p>see <a href="https://example.com/x">the docs</a></p>'
		);
	});

	it('escapes HTML injected through a team label or api field', () => {
		const md = '# Team API: <img src=x onerror=alert(1)>\n\n* focus: "><script>alert(2)</script>';
		const html = renderMarkdown(md);
		expect(html).not.toContain('<img');
		expect(html).not.toContain('<script>alert(2)');
		expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
		expect(html).toContain('&lt;script&gt;alert(2)&lt;/script&gt;');
	});

	it('escapes a literal "<" that appears in field text, e.g. an SLE like "p95 < 300 ms"', () => {
		expect(renderMarkdown('SLE: p95 < 300 ms')).toBe('<p>SLE: p95 &lt; 300 ms</p>');
	});

	it('renders the actual output of teamApi() for a real example end to end', () => {
		const md = teamApi(parse(ecommerce), 'checkout', { date: '2026-01-02' });
		const html = renderMarkdown(md);
		expect(html).toContain('<h1>Team API: Checkout</h1>');
		expect(html).toContain("<h3>What we're currently working on</h3>");
		expect(html).toContain('<p>Date: 2026-01-02</p>');
		expect(html).toContain(
			'<li>Software owned and evolved by this team: checkout-service, cart-ui</li>'
		);
		expect(html).toContain('99.9% availability, p95 &lt; 300 ms');
		expect(html).toContain('<table><thead><tr><th>Team name/focus</th>');
		expect(html).toContain('<td>Infrastructure Platform</td>');
	});
});
