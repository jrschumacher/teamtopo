/**
 * Syntax highlighting for `.tt` source, shared by the landing hero demo and the editor.
 * Wraps tokens in `<span>` so `textContent` (used by tests and screen readers) still
 * equals exactly the input source. See docs/landing-design.md for the token->class map.
 */
import { escapeHtml } from './markdown';

const KEYWORD_RE =
	/^(\s*)(teamTopology|title|flow|legend|api|stream-aligned|stream|sa|enabling|en|complicated-subsystem|subsystem|cs|platform|pf|group)\b/;
const TOKEN_RE = /("(?:[^"\\]|\\.)*")|(<-->|<->|-->|<--|~~>|<~~)|(\[[^\]]*\])/g;

function keywordClass(kw: string): string {
	if (kw === 'teamTopology' || kw === 'title' || kw === 'flow' || kw === 'legend' || kw === 'api')
		return 'tok-directive';
	if (kw === 'stream-aligned' || kw === 'stream' || kw === 'sa') return 'tok-kw-stream';
	if (kw === 'enabling' || kw === 'en') return 'tok-kw-en';
	if (kw === 'complicated-subsystem' || kw === 'subsystem' || kw === 'cs') return 'tok-kw-cs';
	if (kw === 'platform' || kw === 'pf') return 'tok-kw-pf';
	return 'tok-kw-group';
}

function highlightLine(line: string): string {
	if (/^\s*(%%|\/\/)/.test(line)) return `<span class="tok-comment">${escapeHtml(line)}</span>`;

	let out = '';
	let rest = line;
	const kwMatch = KEYWORD_RE.exec(rest);
	if (kwMatch) {
		out += escapeHtml(kwMatch[1]);
		out += `<span class="${keywordClass(kwMatch[2])}">${escapeHtml(kwMatch[2])}</span>`;
		rest = rest.slice(kwMatch[0].length);
	}

	let last = 0;
	TOKEN_RE.lastIndex = 0;
	let m: RegExpExecArray | null;
	while ((m = TOKEN_RE.exec(rest))) {
		out += escapeHtml(rest.slice(last, m.index));
		if (m[1]) out += `<span class="tok-str">${escapeHtml(m[1])}</span>`;
		else if (m[2]) out += `<span class="tok-arrow">${escapeHtml(m[2])}</span>`;
		else if (m[3]) out += `<span class="tok-attrs">${escapeHtml(m[3])}</span>`;
		last = TOKEN_RE.lastIndex;
	}
	out += escapeHtml(rest.slice(last));
	return out;
}

/** Team declaration keywords, matched at the start of a line (see src/teamtopo.js TYPE_ALIAS). */
export const TEAM_KEYWORD_RE =
	/^\s*(stream-aligned|stream|sa|enabling|en|complicated-subsystem|subsystem|cs|platform|pf|group)\b/gm;
/** Interaction arrow tokens (see src/teamtopo.js ARROW). */
export const ARROW_RE = /(<-->|<->|-->|<--|~~>|<~~)/g;

export function countTeams(text: string): number {
	return (text.match(TEAM_KEYWORD_RE) ?? []).length;
}

export function countInteractions(text: string): number {
	return (text.match(ARROW_RE) ?? []).length;
}

export interface HighlightError {
	/** 1-based line number, matching `ParseError.line`. */
	line: number;
	message: string;
}

/**
 * Highlights every line of `text`, joined back with `\n`. When `error` names a line,
 * that line is wrapped in a `.ed-line-error` span carrying the message as a `title`
 * so the editor can paint an error band + wavy underline and show it on hover.
 */
export function highlight(text: string, error?: HighlightError | null): string {
	return text
		.split('\n')
		.map((line, i) => {
			const rendered = highlightLine(line);
			if (!error || i + 1 !== error.line) return rendered;
			return `<span class="ed-line-error" title="${escapeHtml(error.message)}">${rendered}</span>`;
		})
		.join('\n');
}
