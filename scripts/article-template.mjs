/**
 * article-template.mjs — HTML documents for the articles pipeline.
 *
 *   page({ title, body, meta })   one article
 *   index({ articles, meta })     the listing
 *
 * Inline CSS only, plain styling, stable class names (.article, .article-meta,
 * .article-body, .article-list, .diagram) so a designer can restyle later.
 */
import { escapeHtml as esc } from './markdown.mjs';

export const REPO_URL = 'https://github.com/jrschumacher/teamtopo';
export const SITE_TITLE = 'teamtopo articles';
export const FOOTER_NOTE = 'Shapes and Team API template © Team Topologies, CC BY-SA 4.0. Not affiliated with or endorsed by Team Topologies.';

export const CSS = `
:root { color-scheme: light dark; --fg: #1d1d1f; --bg: #fff; --muted: #6b6b70; --rule: #dcdce0; --code-bg: #f4f4f6; --link: #0b57d0; }
@media (prefers-color-scheme: dark) {
  :root { --fg: #e6e6ea; --bg: #141416; --muted: #9a9aa2; --rule: #333338; --code-bg: #1f1f23; --link: #8ab4f8; }
}
html { background: var(--bg); color: var(--fg); }
body { margin: 0; font: 17px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
main { max-width: 70ch; margin: 0 auto; padding: 2rem 1.25rem 4rem; }
a { color: var(--link); }
h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 2em 0 0.6em; }
h1 { font-size: 2rem; margin-top: 0.5em; }
h2 { font-size: 1.5rem; }
h3 { font-size: 1.2rem; }
code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.9em; }
code { background: var(--code-bg); padding: 0.1em 0.3em; border-radius: 3px; }
pre { background: var(--code-bg); padding: 1rem; border-radius: 6px; overflow-x: auto; line-height: 1.45; }
pre code { background: none; padding: 0; }
blockquote { margin: 1em 0; padding: 0 1em; border-left: 3px solid var(--rule); color: var(--muted); }
hr { border: 0; border-top: 1px solid var(--rule); margin: 2.5em 0; }
.table-wrap { overflow-x: auto; margin: 1em 0; }
table { border-collapse: collapse; font-size: 0.92em; min-width: 100%; }
th, td { border: 1px solid var(--rule); padding: 0.45em 0.7em; text-align: left; vertical-align: top; }
th { background: var(--code-bg); }
figure.diagram { margin: 1.5em 0; overflow-x: auto; }
figure.diagram svg { max-width: 100%; height: auto; display: block; }
.site-nav { display: flex; gap: 1em; font-size: 0.9em; color: var(--muted); }
.article-meta { color: var(--muted); font-size: 0.9em; margin-bottom: 2em; }
.article-meta .tags a { margin-right: 0.5em; }
.article-summary { font-size: 1.1em; color: var(--muted); margin-top: 0; }
.article-list { list-style: none; padding: 0; }
.article-list li { padding: 1.25em 0; border-top: 1px solid var(--rule); }
.article-list h2 { margin: 0 0 0.25em; font-size: 1.25rem; }
.article-list p { margin: 0.4em 0; }
footer { margin-top: 4em; padding-top: 1.5em; border-top: 1px solid var(--rule); color: var(--muted); font-size: 0.85em; }
`;

const join = (base, ...parts) => [base.replace(/\/+$/, ''), ...parts].join('/');

function document({ title, description, type, url, feedUrl, head = '', content }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:type" content="${type}">
${url ? `<meta property="og:url" content="${esc(url)}">\n` : ''}<link rel="alternate" type="application/rss+xml" title="${esc(SITE_TITLE)}" href="${esc(feedUrl)}">
${head}<style>${CSS}</style>
</head>
<body>
<main>
${content}
<footer>
<p>${esc(FOOTER_NOTE)}</p>
<p><a href="${REPO_URL}">teamtopo on GitHub</a></p>
</footer>
</main>
</body>
</html>
`;
}

function formatDate(date) {
  const d = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? date : d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

function tagsHtml(tags) {
  return tags.length ? `<span class="tags">${tags.map((t) => `<span class="tag">${esc(t)}</span>`).join(' ')}</span>` : '';
}

/**
 * @param {{ title: string, body: string, meta: { description: string, date: string, author: string,
 *   tags: string[], base: string, slug: string } }} args
 */
export function page({ title, body, meta }) {
  const base = meta.base ?? '/articles';
  const url = join(base, meta.slug || '', '');
  const content = `<nav class="site-nav"><a href="${esc(join(base, ''))}">All articles</a> <a href="${REPO_URL}">GitHub</a></nav>
<article class="article">
<header>
<h1>${esc(title)}</h1>
${meta.description ? `<p class="article-summary">${esc(meta.description)}</p>\n` : ''}<p class="article-meta">${meta.author ? `<span class="author">${esc(meta.author)}</span> · ` : ''}<time datetime="${esc(meta.date)}">${esc(formatDate(meta.date))}</time>${meta.tags?.length ? ' · ' + tagsHtml(meta.tags) : ''}</p>
</header>
<div class="article-body">
${body}</div>
</article>`;
  return document({
    title, description: meta.description || '', type: 'article', url,
    feedUrl: join(base, 'feed.xml'),
    head: `<meta property="article:published_time" content="${esc(meta.date)}">\n${meta.author ? `<meta name="author" content="${esc(meta.author)}">\n` : ''}`,
    content,
  });
}

/**
 * @param {{ articles: Array<{ slug: string, title: string, date: string, summary: string, tags: string[] }>, meta?: { base?: string } }} args
 */
export function index({ articles, meta = {} }) {
  const base = meta.base ?? '/articles';
  const items = articles.map((a) => `<li>
<h2><a href="${esc(join(base, a.slug, ''))}">${esc(a.title)}</a></h2>
<p class="article-meta"><time datetime="${esc(a.date)}">${esc(formatDate(a.date))}</time>${a.tags?.length ? ' · ' + tagsHtml(a.tags) : ''}</p>
<p>${esc(a.summary)}</p>
</li>`).join('\n');
  const content = `<nav class="site-nav"><a href="${REPO_URL}">GitHub</a> <a href="${esc(join(base, 'feed.xml'))}">RSS</a></nav>
<h1>${esc(SITE_TITLE)}</h1>
<ul class="article-list">
${items}
</ul>`;
  return document({
    title: SITE_TITLE, description: 'Articles on Team Topologies and team design, from the teamtopo project.',
    type: 'website', url: join(base, ''), feedUrl: join(base, 'feed.xml'), content,
  });
}
