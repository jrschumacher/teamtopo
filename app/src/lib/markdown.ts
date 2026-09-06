/**
 * A small Markdown -> HTML renderer for the subset `teamApi()` (and text typed into
 * api-block fields) can produce: ATX headings, paragraphs, bullet lists, pipe tables,
 * and the inline forms `**bold**`, `` `code` ``, and `[text](url)`. Anything else is
 * escaped and rendered as plain text — this is not a general Markdown parser.
 */

export function escapeHtml(s: string): string {
	return s.replace(
		/[&<>"]/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c
	);
}

const RE_HEADING = /^(#{1,6})\s+(.*)$/;
const RE_BULLET = /^[*-]\s+(.*)$/;
const RE_TABLE_ROW = /^\|.*\|$/;
const RE_TABLE_SEPARATOR = /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$/;

function renderInline(text: string): string {
	let out = escapeHtml(text);
	out = out.replace(/`([^`]+)`/g, (_m, code: string) => `<code>${code}</code>`);
	out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label: string, url: string) => {
		return `<a href="${url}">${label}</a>`;
	});
	out = out.replace(/\*\*([^*]+)\*\*/g, (_m, bold: string) => `<strong>${bold}</strong>`);
	return out;
}

function splitTableRow(line: string): string[] {
	const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
	return trimmed.split('|').map((cell) => cell.trim());
}

export function renderMarkdown(source: string): string {
	const lines = source.split(/\r?\n/);
	const out: string[] = [];
	let i = 0;

	while (i < lines.length) {
		const line = lines[i];

		if (line.trim() === '') {
			i++;
			continue;
		}

		const heading = RE_HEADING.exec(line);
		if (heading) {
			const level = heading[1].length;
			out.push(`<h${level}>${renderInline(heading[2].trim())}</h${level}>`);
			i++;
			continue;
		}

		if (RE_BULLET.test(line)) {
			const items: string[] = [];
			while (i < lines.length && RE_BULLET.test(lines[i])) {
				const m = RE_BULLET.exec(lines[i])!;
				items.push(`<li>${renderInline(m[1])}</li>`);
				i++;
			}
			out.push(`<ul>${items.join('')}</ul>`);
			continue;
		}

		if (RE_TABLE_ROW.test(line) && i + 1 < lines.length && RE_TABLE_SEPARATOR.test(lines[i + 1])) {
			const headCells = splitTableRow(line);
			i += 2;
			const bodyRows: string[][] = [];
			while (i < lines.length && RE_TABLE_ROW.test(lines[i])) {
				bodyRows.push(splitTableRow(lines[i]));
				i++;
			}
			const thead = `<thead><tr>${headCells
				.map((c) => `<th>${renderInline(c)}</th>`)
				.join('')}</tr></thead>`;
			const tbody = `<tbody>${bodyRows
				.map((row) => `<tr>${row.map((c) => `<td>${renderInline(c)}</td>`).join('')}</tr>`)
				.join('')}</tbody>`;
			out.push(`<table>${thead}${tbody}</table>`);
			continue;
		}

		const para: string[] = [];
		while (
			i < lines.length &&
			lines[i].trim() !== '' &&
			!RE_HEADING.test(lines[i]) &&
			!RE_BULLET.test(lines[i]) &&
			!RE_TABLE_ROW.test(lines[i])
		) {
			para.push(lines[i].trim());
			i++;
		}
		out.push(`<p>${renderInline(para.join(' '))}</p>`);
	}

	return out.join('');
}
