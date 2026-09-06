/**
 * markdown.mjs — a small, dependency-free Markdown → HTML renderer.
 *
 * Covers the subset the articles use: ATX headings (with slug ids), paragraphs,
 * **bold**, *italic*, `code`, [links](url), ordered and unordered lists (nested),
 * GFM tables with an alignment row, fenced code blocks, horizontal rules and
 * blockquotes. Raw HTML is never passed through: every piece of text is escaped.
 *
 *   renderMarkdown(source, { fence })
 *     fence(lang, code, line) may return HTML for a fenced block, or undefined to
 *     fall back to <pre><code class="language-…">. `line` is the 1-based source
 *     line of the opening fence, for error messages.
 */

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function slugify(text) {
  return text.toLowerCase()
    .replace(/[`*_~\[\]()]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim().replace(/\s+/g, '-').replace(/-+/g, '-') || 'section';
}

const RE_HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const RE_FENCE = /^(```+|~~~+)\s*([\w+-]*)\s*$/;
const RE_HR = /^(?:-{3,}|\*{3,}|_{3,})\s*$/;
const RE_LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const RE_QUOTE = /^>\s?(.*)$/;
const RE_TABLE_ALIGN = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;

const isBlank = (l) => l === undefined || /^\s*$/.test(l);
const isTableRow = (l) => l !== undefined && l.includes('|');
const startsBlock = (l) => isBlank(l) || RE_HEADING.test(l) || RE_FENCE.test(l) || RE_HR.test(l)
  || RE_LIST.test(l) || RE_QUOTE.test(l);

// ───────────────────────── inline ─────────────────────────

function inlineText(s) {
  let out = escapeHtml(s);
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text, href) => `<a href="${href}">${text}</a>`);
  out = out.replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\*(?=\S)([^*\n]*?\S)\*/g, '<em>$1</em>');
  out = out.replace(/ {2,}\n/g, '<br>\n');
  return out;
}

export function renderInline(s) {
  // code spans first so nothing inside them is touched
  const parts = s.split(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/);
  let html = '';
  for (let i = 0; i < parts.length; i++) {
    if (i % 3 === 0) html += inlineText(parts[i]);
    else if (i % 3 === 2) html += `<code>${escapeHtml(parts[i].trim())}</code>`;
  }
  return html;
}

// ───────────────────────── blocks ─────────────────────────

function parseTableRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
}

function alignments(line) {
  return parseTableRow(line).map((c) => {
    const l = c.startsWith(':'), r = c.endsWith(':');
    return l && r ? 'center' : r ? 'right' : l ? 'left' : null;
  });
}

function renderTable(lines) {
  const align = alignments(lines[1]);
  const cell = (tag, text, i) => `<${tag}${align[i] ? ` style="text-align:${align[i]}"` : ''}>${renderInline(text)}</${tag}>`;
  const row = (tag, line) => `<tr>${parseTableRow(line).map((c, i) => cell(tag, c, i)).join('')}</tr>`;
  const head = `<thead>${row('th', lines[0])}</thead>`;
  const body = lines.slice(2).map((l) => row('td', l)).join('\n');
  return `<div class="table-wrap"><table>\n${head}\n${body ? `<tbody>\n${body}\n</tbody>\n` : ''}</table></div>`;
}

function renderList(lines, ctx) {
  const first = RE_LIST.exec(lines[0]);
  const ordered = /\d/.test(first[2]);
  const indent = first[1].length;
  const items = [];
  for (const line of lines) {
    const m = RE_LIST.exec(line);
    if (m && m[1].length === indent) items.push({ text: m[3], rest: [] });
    else if (items.length) items.push.apply(items[items.length - 1].rest, [line]);
  }
  const html = items.map(({ text, rest }) => {
    let inner = renderInline(text);
    while (rest.length && isBlank(rest[rest.length - 1])) rest.pop();
    if (rest.length) {
      const stripped = rest.map((l) => (isBlank(l) ? '' : l.replace(new RegExp(`^\\s{1,${indent + 4}}`), '')));
      inner += '\n' + renderBlocks(stripped, ctx).trim();
    }
    return `<li>${inner}</li>`;
  }).join('\n');
  const start = ordered && first[2] !== '1.' && first[2] !== '1)' ? ` start="${parseInt(first[2], 10)}"` : '';
  return `<${ordered ? 'ol' : 'ul'}${start}>\n${html}\n</${ordered ? 'ol' : 'ul'}>`;
}

function renderBlocks(lines, ctx) {
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) { i++; continue; }

    let m;
    if ((m = RE_FENCE.exec(line))) {
      const marker = m[1], lang = m[2], open = i;
      const code = [];
      i++;
      while (i < lines.length && !(lines[i].startsWith(marker) && /^\s*$/.test(lines[i].slice(marker.length)))) code.push(lines[i++]);
      i++; // closing fence (or EOF)
      const text = code.join('\n');
      const custom = ctx.fence ? ctx.fence(lang, text, ctx.offset + open + 1) : undefined;
      out.push(custom !== undefined ? custom
        : `<pre><code${lang ? ` class="language-${escapeHtml(lang)}"` : ''}>${escapeHtml(text)}</code></pre>`);
      continue;
    }
    if ((m = RE_HEADING.exec(line))) {
      const level = m[1].length;
      let id = slugify(m[2]);
      if (ctx.ids.has(id)) { let n = 2; while (ctx.ids.has(`${id}-${n}`)) n++; id = `${id}-${n}`; }
      ctx.ids.add(id);
      out.push(`<h${level} id="${id}">${renderInline(m[2])}</h${level}>`);
      i++; continue;
    }
    if (RE_HR.test(line)) { out.push('<hr>'); i++; continue; }
    if (RE_QUOTE.test(line)) {
      const quoted = [];
      while (i < lines.length && RE_QUOTE.test(lines[i])) quoted.push(RE_QUOTE.exec(lines[i++])[1]);
      out.push(`<blockquote>\n${renderBlocks(quoted, { ...ctx, offset: ctx.offset + i - quoted.length }).trim()}\n</blockquote>`);
      continue;
    }
    if (isTableRow(line) && RE_TABLE_ALIGN.test(lines[i + 1] || '')) {
      const rows = [];
      while (i < lines.length && isTableRow(lines[i]) && !isBlank(lines[i])) rows.push(lines[i++]);
      out.push(renderTable(rows));
      continue;
    }
    if ((m = RE_LIST.exec(line))) {
      const indent = m[1].length;
      const ordered = /\d/.test(m[2]);
      const sameList = (lm) => lm && lm[1].length === indent && /\d/.test(lm[2]) === ordered;
      const block = [line];
      i++;
      while (i < lines.length) {
        const l = lines[i];
        if (isBlank(l)) {
          // a loose list continues if the next non-blank line is another item or indented content
          let j = i; while (j < lines.length && isBlank(lines[j])) j++;
          const next = lines[j];
          const nm = next !== undefined && RE_LIST.exec(next);
          if (sameList(nm) || (next !== undefined && /^\s{2,}\S/.test(next) && !(nm && nm[1].length < indent))) {
            while (i < j) block.push(lines[i++]);
            continue;
          }
          break;
        }
        const lm = RE_LIST.exec(l);
        if (sameList(lm)) { block.push(l); i++; continue; }
        if (lm && lm[1].length === indent) break; // a list of the other type starts here
        if (/^\s{2,}\S/.test(l) && (!lm || lm[1].length > indent)) { block.push(l); i++; continue; }
        if (!startsBlock(l) && !isBlank(l) && !/^\s/.test(l) && block.length && !isBlank(block[block.length - 1])) {
          block.push(l); i++; continue; // lazy continuation line
        }
        break;
      }
      out.push(renderList(block, { ...ctx, offset: ctx.offset + i - block.length }));
      continue;
    }
    // paragraph
    const para = [line];
    i++;
    while (i < lines.length && !startsBlock(lines[i]) && !(isTableRow(lines[i]) && RE_TABLE_ALIGN.test(lines[i + 1] || ''))) para.push(lines[i++]);
    out.push(`<p>${renderInline(para.join('\n').trim())}</p>`);
  }
  return out.join('\n') + (out.length ? '\n' : '');
}

export function renderMarkdown(source, opts = {}) {
  const lines = String(source).replace(/\r\n?/g, '\n').split('\n');
  return renderBlocks(lines, { fence: opts.fence, ids: new Set(), offset: opts.lineOffset || 0 });
}

export default renderMarkdown;
