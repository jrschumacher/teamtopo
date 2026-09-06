#!/usr/bin/env node
/**
 * articles.mjs — builds the articles site from content/articles/*.md.
 *
 *   node scripts/articles.mjs [--out <dir>] [--base <url-prefix>]
 *
 *   --out   output directory (default public/articles)
 *   --base  URL prefix the pages are served under (default /articles)
 *
 * Writes <out>/<slug>/index.html per article, <out>/index.html (non-draft, newest
 * first) and <out>/feed.xml (RSS 2.0). ```teamtopo fences are rendered to inline SVG.
 * Zero dependencies, so the hosted app's build can call it with its own --out.
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname, basename, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { render } from '../src/teamtopo.js';
import { renderMarkdown, escapeHtml as esc } from './markdown.mjs';
import { page, index, SITE_TITLE } from './article-template.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const CONTENT_DIR = join(here, '..', 'content', 'articles');
export const REQUIRED_KEYS = ['title', 'date', 'author', 'summary', 'tags'];

// ───────────────────────── front matter ─────────────────────────

/**
 * Parses the YAML-ish front matter block at the top of an article.
 * Returns { meta, body, bodyLine } where bodyLine is the 1-based line the body starts on.
 */
export function parseFrontMatter(source, name = 'article') {
  const lines = String(source).replace(/\r\n?/g, '\n').split('\n');
  if (lines[0].trim() !== '---') throw new Error(`${name}: missing front matter (expected "---" on line 1)`);
  let end = -1;
  for (let i = 1; i < lines.length; i++) if (lines[i].trim() === '---') { end = i; break; }
  if (end < 0) throw new Error(`${name}: unterminated front matter (no closing "---")`);

  const raw = {};
  for (let i = 1; i < end; i++) {
    const line = lines[i];
    if (/^\s*(#|$)/.test(line)) continue;
    const m = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!m) throw new Error(`${name}:${i + 1}: cannot parse front matter line "${line}"`);
    raw[m[1]] = m[2].trim().replace(/^(["'])(.*)\1$/, '$2');
  }

  const missing = REQUIRED_KEYS.filter((k) => !raw[k]);
  if (missing.length) throw new Error(`${name}: front matter is missing required key(s): ${missing.join(', ')}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw.date) || Number.isNaN(Date.parse(raw.date))) {
    throw new Error(`${name}: front matter "date" must be YYYY-MM-DD, got "${raw.date}"`);
  }

  const meta = {
    ...raw,
    tags: raw.tags.split(',').map((t) => t.trim()).filter(Boolean),
    draft: /^(true|yes|1)$/i.test(raw.draft || ''),
  };
  return { meta, body: lines.slice(end + 1).join('\n'), bodyLine: end + 2 };
}

export const slugOf = (file) => basename(file).replace(/\.md$/i, '');

// ───────────────────────── rendering ─────────────────────────

/** Renders an article body to HTML; a broken teamtopo fence throws naming the article and line. */
export function renderBody(body, { name = 'article', bodyLine = 1 } = {}) {
  let n = 0;
  const fence = (lang, code, line) => {
    if (lang !== 'teamtopo') return undefined;
    n++;
    try {
      const svg = render(code, { theme: 'light', idPrefix: `tt${n}` });
      return `<figure class="diagram">${svg}</figure>`;
    } catch (e) {
      const at = typeof e.line === 'number' ? line + e.line : line;
      throw new Error(`${name}:${at}: teamtopo diagram: ${e.detail || e.message}`);
    }
  };
  return renderMarkdown(body, { fence, lineOffset: bodyLine - 1 });
}

/** Reads every article in a directory; returns them newest first. */
export function loadArticles(dir = CONTENT_DIR) {
  const files = readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
  const articles = files.map((f) => {
    const source = readFileSync(join(dir, f), 'utf8');
    const { meta, body, bodyLine } = parseFrontMatter(source, f);
    return { ...meta, slug: slugOf(f), file: f, html: renderBody(body, { name: f, bodyLine }) };
  });
  return articles.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.title.localeCompare(b.title)));
}

const rfc822 = (date) => new Date(`${date}T00:00:00Z`).toUTCString();
const joinUrl = (base, ...parts) => [base.replace(/\/+$/, ''), ...parts].join('/');

export function feed(articles, { base = '/articles' } = {}) {
  const items = articles.map((a) => `  <item>
    <title>${esc(a.title)}</title>
    <link>${esc(joinUrl(base, a.slug, ''))}</link>
    <guid isPermaLink="false">${esc(a.slug)}</guid>
    <pubDate>${rfc822(a.date)}</pubDate>
    <author>${esc(a.author)}</author>
    <description>${esc(a.summary)}</description>
${a.tags.map((t) => `    <category>${esc(t)}</category>`).join('\n')}
  </item>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>${esc(SITE_TITLE)}</title>
  <link>${esc(joinUrl(base, ''))}</link>
  <description>Articles on Team Topologies and team design, from the teamtopo project.</description>
  <atom:link href="${esc(joinUrl(base, 'feed.xml'))}" rel="self" type="application/rss+xml"/>
${articles.length ? `  <lastBuildDate>${rfc822(articles[0].date)}</lastBuildDate>\n` : ''}${items}
</channel>
</rss>
`;
}

// ───────────────────────── build ─────────────────────────

export function build({ contentDir = CONTENT_DIR, out = 'public/articles', base = '/articles', log = () => {} } = {}) {
  const all = loadArticles(contentDir);
  const published = all.filter((a) => !a.draft);
  mkdirSync(out, { recursive: true });
  const written = [];
  for (const a of all) {
    const dir = join(out, a.slug);
    mkdirSync(dir, { recursive: true });
    const html = page({
      title: a.title, body: a.html,
      meta: { description: a.summary, date: a.date, author: a.author, tags: a.tags, base, slug: a.slug },
    });
    writeFileSync(join(dir, 'index.html'), html);
    written.push(join(dir, 'index.html'));
    log(`wrote ${join(dir, 'index.html')}${a.draft ? ' (draft, unlisted)' : ''}`);
  }
  writeFileSync(join(out, 'index.html'), index({ articles: published, meta: { base } }));
  writeFileSync(join(out, 'feed.xml'), feed(published, { base }));
  written.push(join(out, 'index.html'), join(out, 'feed.xml'));
  log(`wrote ${join(out, 'index.html')}, ${join(out, 'feed.xml')} (${published.length} article${published.length === 1 ? '' : 's'})`);
  return { articles: all, published, written };
}

function main() {
  const args = process.argv.slice(2);
  const flag = (name, dflt) => (args.includes(name) ? args[args.indexOf(name) + 1] : dflt);
  const out = resolve(flag('--out', 'public/articles'));
  const base = flag('--base', '/articles');
  try {
    build({ out, base, log: console.log });
  } catch (e) {
    console.error(`articles: ${e.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
