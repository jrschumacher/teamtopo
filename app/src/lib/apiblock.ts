/**
 * Text-level editing of `api <team> { ... }` blocks. See docs/app-intent.md and the
 * "Team API blocks" section of the library README for the syntax this mirrors.
 *
 * This module re-implements the parser's line-scanning rules for the `api` block
 * (comment handling, field-line shape, field-name aliasing) so edits round-trip
 * byte-for-byte with everything outside the block. It calls into `@lib/teamtopo`'s
 * `parse()` for team lookups and field-value resolution rather than duplicating that.
 */
import { parse, TEAM_API_FIELDS, type Node } from '@lib/teamtopo';

export class UnknownTeamError extends Error {
	readonly teamId: string;
	constructor(teamId: string) {
		super(`no team "${teamId}" in this diagram`);
		this.name = 'UnknownTeamError';
		this.teamId = teamId;
	}
}

export class ApiBlockValueError extends Error {
	readonly field: string;
	constructor(field: string, message: string) {
		super(message);
		this.name = 'ApiBlockValueError';
		this.field = field;
	}
}

// Mirrors teamtopo.js: identifiers, the "api <id> {" opener, and a "field: value" line.
const ID = '[A-Za-z_][A-Za-z0-9_.]*';
const RE_API_OPEN = new RegExp(`^api\\s+(${ID})\\s*\\{$`, 'i');
const RE_API_FIELD = /^([^:]+?)\s*:\s*(.*)$/;

/** Mirrors teamtopo.js stripComment: inside an api block only "%%" starts a comment. */
function stripComment(line: string, slashes: boolean): string {
	let inQuote = false;
	for (let i = 0; i < line.length; i++) {
		const c = line[i];
		if (c === '"' && line[i - 1] !== '\\') inQuote = !inQuote;
		else if (
			!inQuote &&
			((c === '%' && line[i + 1] === '%') || (slashes && c === '/' && line[i + 1] === '/'))
		) {
			return line.slice(0, i);
		}
	}
	return line;
}

/** Mirrors teamtopo.js apiKey: normalises a field name for alias matching. */
function apiKey(s: string): string {
	return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function canonicalKeyFor(rawName: string): string | null {
	const key = apiKey(rawName);
	const spec = TEAM_API_FIELDS.find((f) => f.aliases.includes(key));
	return spec ? spec.key : null;
}

/** Mirrors the library's private apiField(): first alias present on the node wins. */
function fieldValue(node: Node, canonicalKey: string): string {
	const spec = TEAM_API_FIELDS.find((f) => f.key === canonicalKey);
	if (!spec || !node.api) return '';
	for (const alias of spec.aliases) {
		if (node.api[alias] !== undefined) return node.api[alias];
	}
	return '';
}

interface BlockLocation {
	openIdx: number;
	closeIdx: number;
	firstFieldIndent: string | null;
}

/** Scans the whole file the way the parser does, looking for the api block for `teamId`. */
function locateApiBlock(lines: string[], teamId: string): BlockLocation | null {
	let insideApi = false;
	let openIdx = -1;
	let openId = '';
	for (let i = 0; i < lines.length; i++) {
		const stripped = stripComment(lines[i], !insideApi).trim();
		if (!stripped) continue;
		if (insideApi) {
			if (stripped === '}') {
				if (openId === teamId) {
					let firstFieldIndent: string | null = null;
					for (let j = openIdx + 1; j < i; j++) {
						const fieldLine = stripComment(lines[j], false).trim();
						if (!fieldLine) continue;
						firstFieldIndent = indentOf(lines[j]);
						break;
					}
					return { openIdx, closeIdx: i, firstFieldIndent };
				}
				insideApi = false;
			}
			continue;
		}
		const m = RE_API_OPEN.exec(stripped);
		if (m) {
			insideApi = true;
			openId = m[1];
			openIdx = i;
		}
	}
	return null;
}

function indentOf(line: string): string {
	return /^[ \t]*/.exec(line)?.[0] ?? '';
}

/** Order canonical keys appear in the existing block's field lines, first occurrence wins. */
function existingFieldOrder(lines: string[], block: BlockLocation): string[] {
	const order: string[] = [];
	for (let i = block.openIdx + 1; i < block.closeIdx; i++) {
		const line = stripComment(lines[i], false).trim();
		if (!line) continue;
		const fm = RE_API_FIELD.exec(line);
		if (!fm) continue;
		const key = canonicalKeyFor(fm[1].trim());
		if (key && !order.includes(key)) order.push(key);
	}
	return order;
}

/** Read the `api <teamId> { ... }` block's fields, keyed by TEAM_API_FIELDS canonical name. */
export function readApiBlock(source: string, teamId: string): Record<string, string> {
	const model = parse(source);
	const node = model.index[teamId];
	if (!node) throw new UnknownTeamError(teamId);

	const result: Record<string, string> = {};
	for (const spec of TEAM_API_FIELDS) {
		const value = fieldValue(node, spec.key);
		if (value !== '') result[spec.key] = value;
	}
	return result;
}

/**
 * Write `fields` (canonical TEAM_API_FIELDS keys) into the `api <teamId> { ... }` block,
 * replacing it in place or inserting a new one at the end of the file. Everything else in
 * `source` — comments, indentation, other teams — is preserved byte for byte.
 */
export function writeApiBlock(
	source: string,
	teamId: string,
	fields: Record<string, string>
): string {
	const model = parse(source);
	const node = model.index[teamId];
	if (!node) throw new UnknownTeamError(teamId);

	for (const [key, value] of Object.entries(fields)) {
		if (value.includes('\n') || value.includes('\r')) {
			throw new ApiBlockValueError(
				key,
				`field "${key}" cannot contain a line break — the api block has no continuation syntax`
			);
		}
	}

	const lines = source.split(/\r?\n/);
	const block = locateApiBlock(lines, teamId);
	const existingOrder = block ? existingFieldOrder(lines, block) : [];

	const has = (key: string) => (fields[key] ?? '').trim() !== '';
	const finalKeys: string[] = [
		...existingOrder.filter(has),
		...TEAM_API_FIELDS.map((f) => f.key).filter((k) => !existingOrder.includes(k) && has(k))
	];

	const openIndent = block ? indentOf(lines[block.openIdx]) : indentOf(lines[node.line - 1] ?? '');
	const fieldIndent = block?.firstFieldIndent ?? `${openIndent}  `;
	const closeIndent = block ? indentOf(lines[block.closeIdx]) : openIndent;

	const blockLines = [
		`${openIndent}api ${teamId} {`,
		...finalKeys.map((k) => `${fieldIndent}${k}: ${fields[k]}`),
		`${closeIndent}}`
	];

	if (block) {
		lines.splice(block.openIdx, block.closeIdx - block.openIdx + 1, ...blockLines);
	} else {
		if (lines.length && lines[lines.length - 1].trim() !== '') lines.push('');
		lines.push(...blockLines);
	}
	return lines.join('\n');
}
