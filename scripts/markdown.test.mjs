import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown, renderInline, slugify, escapeHtml } from './markdown.mjs';

const md = (s, o) => renderMarkdown(s, o).trim();

test('headings h1-h6 get slug ids', () => {
  for (let n = 1; n <= 6; n++) {
    assert.equal(md(`${'#'.repeat(n)} Stage 0: What agents do`), `<h${n} id="stage-0-what-agents-do">Stage 0: What agents do</h${n}>`);
  }
  assert.equal(slugify('Agents, defined'), 'agents-defined');
});

test('duplicate heading ids are disambiguated', () => {
  const out = md('## Notes\n\n## Notes');
  assert.match(out, /id="notes"/);
  assert.match(out, /id="notes-2"/);
});

test('paragraphs, bold, italic, inline code and links', () => {
  assert.equal(md('teams *have*, not **are**. See `x` and [TT](https://teamtopologies.com).'),
    '<p>teams <em>have</em>, not <strong>are</strong>. See <code>x</code> and <a href="https://teamtopologies.com">TT</a>.</p>');
  assert.equal(md('line one\nline two\n\nnext'), '<p>line one\nline two</p>\n<p>next</p>');
});

test('inline code is not styled and is escaped', () => {
  assert.equal(renderInline('a `**b** <i>` c'), 'a <code>**b** &lt;i&gt;</code> c');
  assert.equal(renderInline('`` a`b ``'), '<code>a`b</code>');
});

test('unordered and ordered lists with one level of nesting', () => {
  assert.equal(md('- a\n- b\n  - c\n  - d\n- e'),
    '<ul>\n<li>a</li>\n<li>b\n<ul>\n<li>c</li>\n<li>d</li>\n</ul></li>\n<li>e</li>\n</ul>');
  assert.equal(md('1. one\n2. two'), '<ol>\n<li>one</li>\n<li>two</li>\n</ol>');
  assert.equal(md('3. three'), '<ol start="3">\n<li>three</li>\n</ol>');
});

test('a list followed by a list of the other type stays separate', () => {
  const out = md('- a\n- b\n\n1. one\n2. two');
  assert.equal((out.match(/<ul>/g) || []).length, 1);
  assert.equal((out.match(/<ol>/g) || []).length, 1);
});

test('list items may contain inline markup', () => {
  assert.equal(md('- **Scope.** bounded'), '<ul>\n<li><strong>Scope.</strong> bounded</li>\n</ul>');
});

test('GFM tables with alignment row', () => {
  const out = md('| Claim | Status | N |\n|:---|:---:|---:|\n| a | **b** | 1 |\n| c | d | 2 |');
  assert.match(out, /^<div class="table-wrap"><table>/);
  assert.match(out, /<thead><tr><th style="text-align:left">Claim<\/th><th style="text-align:center">Status<\/th><th style="text-align:right">N<\/th><\/tr><\/thead>/);
  assert.match(out, /<tr><td style="text-align:left">a<\/td><td style="text-align:center"><strong>b<\/strong><\/td><td style="text-align:right">1<\/td><\/tr>/);
  assert.equal((out.match(/<tr>/g) || []).length, 3);
  // no alignment → plain cells
  assert.equal(md('| a |\n|---|\n| b |'), '<div class="table-wrap"><table>\n<thead><tr><th>a</th></tr></thead>\n<tbody>\n<tr><td>b</td></tr>\n</tbody>\n</table></div>');
});

test('fenced code blocks escape contents and carry a language class', () => {
  assert.equal(md('```js\nif (a < b) { **x** }\n```'), '<pre><code class="language-js">if (a &lt; b) { **x** }</code></pre>');
  assert.equal(md('```\n  * * *\n-->\n```'), '<pre><code>  * * *\n--&gt;</code></pre>');
});

test('fence hook receives language, code and the 1-based source line', () => {
  const calls = [];
  const out = md('intro\n\n```teamtopo\nteamTopology\n  stream a\n```\n\n```js\nx\n```', {
    fence: (lang, code, line) => { calls.push([lang, line]); return lang === 'teamtopo' ? `<figure>${code.length}</figure>` : undefined; },
  });
  assert.deepEqual(calls, [['teamtopo', 3], ['js', 8]]);
  assert.match(out, /<figure>\d+<\/figure>/);
  assert.match(out, /<pre><code class="language-js">x<\/code><\/pre>/);
});

test('horizontal rules and blockquotes', () => {
  assert.equal(md('a\n\n---\n\nb'), '<p>a</p>\n<hr>\n<p>b</p>');
  assert.equal(md('> quoted *text*\n> continues'), '<blockquote>\n<p>quoted <em>text</em>\ncontinues</p>\n</blockquote>');
});

test('raw HTML is escaped everywhere', () => {
  assert.equal(md('<script>alert(1)</script>'), '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
  assert.equal(md('# <b>x</b>'), '<h1 id="bxb">&lt;b&gt;x&lt;/b&gt;</h1>');
  assert.equal(md('| <i>a</i> |\n|---|\n| b |').includes('<i>'), false);
  assert.equal(md('- <img src=x onerror=1>').includes('<img'), false);
  assert.equal(escapeHtml(`<a href="x">'&`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;');
});

test('link text and href are escaped', () => {
  assert.equal(renderInline('[<b>](http://x/?a=1&b=2)'), '<a href="http://x/?a=1&amp;b=2">&lt;b&gt;</a>');
});
