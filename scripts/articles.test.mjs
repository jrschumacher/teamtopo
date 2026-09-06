import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseFrontMatter, slugOf, renderBody, loadArticles, build, feed } from './articles.mjs';

const FM = `---
title: Hello
date: 2026-09-05
author: Ryan
summary: A summary.
tags: a, b
---
`;

function tmpContent(files) {
  const dir = mkdtempSync(join(tmpdir(), 'teamtopo-articles-'));
  const content = join(dir, 'content');
  mkdirSync(content);
  for (const [name, text] of Object.entries(files)) writeFileSync(join(content, name), text);
  return { dir, content, out: join(dir, 'out') };
}

test('parseFrontMatter reads keys, splits tags, reports body line', () => {
  const { meta, body, bodyLine } = parseFrontMatter(`${FM}\nBody here.\n`);
  assert.equal(meta.title, 'Hello');
  assert.equal(meta.date, '2026-09-05');
  assert.equal(meta.author, 'Ryan');
  assert.equal(meta.summary, 'A summary.');
  assert.deepEqual(meta.tags, ['a', 'b']);
  assert.equal(meta.draft, false);
  assert.equal(body.trim(), 'Body here.');
  assert.equal(bodyLine, 8);
});

test('parseFrontMatter: draft flag and quoted values', () => {
  const { meta } = parseFrontMatter(FM.replace('---\n$', '').replace(/---\n$/, 'draft: true\ntitle: "Quoted: yes"\n---\n'));
  assert.equal(meta.draft, true);
  assert.equal(meta.title, 'Quoted: yes');
});

test('parseFrontMatter: missing keys produce a clear error naming them', () => {
  assert.throws(() => parseFrontMatter('---\ntitle: x\ndate: 2026-01-01\n---\n', 'post.md'),
    /post\.md: front matter is missing required key\(s\): author, summary, tags/);
  assert.throws(() => parseFrontMatter('no front matter', 'post.md'), /post\.md: missing front matter/);
  assert.throws(() => parseFrontMatter('---\ntitle: x\n', 'post.md'), /unterminated front matter/);
  assert.throws(() => parseFrontMatter(FM.replace('2026-09-05', 'Sept 5'), 'post.md'), /"date" must be YYYY-MM-DD/);
});

test('slug is the filename without extension', () => {
  assert.equal(slugOf('agentic-teams-on-team-topologies.md'), 'agentic-teams-on-team-topologies');
  assert.equal(slugOf('/x/y/Hello-World.MD'), 'Hello-World');
});

test('a teamtopo fence renders inline SVG in a figure', () => {
  const html = renderBody('Intro\n\n```teamtopo\nteamTopology\n  title T\n  stream a "A"\n  platform p "P"\n  p --> a\n```\n');
  assert.match(html, /<figure class="diagram"><svg /);
  assert.match(html, /data-teamtopo=/);
  assert.equal(html.includes('<pre>'), false);
});

test('a broken teamtopo fence fails naming the article and line', () => {
  const src = `${FM}\nPara.\n\n\`\`\`teamtopo\nteamTopology\n  stream a\n  a --> nope\n\`\`\`\n`;
  const { body, bodyLine } = parseFrontMatter(src, 'bad.md');
  // the fence opens on line 11 of the file; the bad line is line 14
  assert.throws(() => renderBody(body, { name: 'bad.md', bodyLine }), /^Error: bad\.md:14: teamtopo diagram: .*nope/);
});

test('HTML in article markdown is escaped', () => {
  const html = renderBody('<script>x</script>\n\n```teamtopo\nteamTopology\n  stream a "<b>A</b>"\n```\n');
  assert.equal(html.includes('<script>'), false);
  assert.equal(html.includes('<b>A</b>'), false);
  assert.match(html, /&lt;b&gt;A&lt;\/b&gt;/);
});

test('loadArticles orders newest first and build excludes drafts from index and feed', () => {
  const { content, out } = tmpContent({
    'old.md': FM.replace('Hello', 'Old').replace('2026-09-05', '2025-01-01') + '\nOld body.\n',
    'new.md': FM.replace('Hello', 'New') + '\nNew body.\n',
    'mid.md': FM.replace('Hello', 'Mid').replace('2026-09-05', '2026-03-03') + '\nMid body.\n',
    'wip.md': FM.replace('Hello', 'Wip').replace(/---\n$/, 'draft: true\n---\n') + '\nDraft body.\n',
  });
  const articles = loadArticles(content);
  assert.deepEqual(articles.map((a) => a.slug), ['new', 'wip', 'mid', 'old']);

  const result = build({ contentDir: content, out, base: '/blog' });
  assert.deepEqual(result.published.map((a) => a.slug), ['new', 'mid', 'old']);
  for (const slug of ['new', 'mid', 'old', 'wip']) assert.ok(existsSync(join(out, slug, 'index.html')), `${slug}/index.html`);

  const idx = readFileSync(join(out, 'index.html'), 'utf8');
  assert.equal(idx.includes('Wip'), false);
  assert.ok(idx.indexOf('>New<') < idx.indexOf('>Mid<') && idx.indexOf('>Mid<') < idx.indexOf('>Old<'));
  assert.match(idx, /href="\/blog\/new\/"/);
  assert.match(idx, /<ul class="article-list">/);
  assert.match(idx, /A summary\./);
  assert.match(idx, /<time datetime="2026-09-05">/);
  assert.match(idx, /class="tag">a</);

  const rss = readFileSync(join(out, 'feed.xml'), 'utf8');
  assert.match(rss, /<rss version="2.0"/);
  assert.equal((rss.match(/<item>/g) || []).length, 3);
  assert.equal(rss.includes('Wip'), false);
  assert.match(rss, /<link>\/blog\/new\/<\/link>/);
  assert.match(rss, /<pubDate>Sat, 05 Sep 2026 00:00:00 GMT<\/pubDate>/);

  const pageHtml = readFileSync(join(out, 'new', 'index.html'), 'utf8');
  assert.match(pageHtml, /<title>New<\/title>/);
  assert.match(pageHtml, /<meta name="description" content="A summary\.">/);
  assert.match(pageHtml, /<meta property="og:type" content="article">/);
  assert.match(pageHtml, /<link rel="alternate" type="application\/rss\+xml"[^>]*href="\/blog\/feed\.xml">/);
  assert.match(pageHtml, /<article class="article">/);
  assert.match(pageHtml, /<div class="article-body">\n<p>New body\.<\/p>/);
  assert.match(pageHtml, /href="\/blog\/">All articles</);
  assert.match(pageHtml, /https:\/\/github\.com\/jrschumacher\/teamtopo/);
  assert.match(pageHtml, /Not affiliated with or endorsed by Team Topologies\./);
  assert.equal(pageHtml.includes('<link rel="stylesheet"'), false);
});

test('build fails on a broken diagram, naming the article and line', () => {
  const { content, out } = tmpContent({ 'bad.md': `${FM}\n\`\`\`teamtopo\nnot a diagram\n\`\`\`\n` });
  assert.throws(() => build({ contentDir: content, out }), /bad\.md:\d+: teamtopo diagram/);
});

test('feed escapes XML special characters', () => {
  const rss = feed([{ slug: 'x', title: 'A & B <C>', date: '2026-01-01', author: 'R', summary: 'S "q"', tags: ['t'] }]);
  assert.match(rss, /<title>A &amp; B &lt;C&gt;<\/title>/);
  assert.match(rss, /<category>t<\/category>/);
});
