#!/usr/bin/env node
// Resets the disposable preview D1 database before every preview build: drops every table,
// including d1_migrations, so `wrangler d1 migrations apply --env preview` reapplies from
// scratch and branches never accumulate schema drift. Refuses to run unless env.preview's
// database_name differs from the top-level (production) one — that guard is what makes this
// script safe to invoke from any branch or build. See docs/app-followups.md and
// wrangler.jsonc's env.preview comment block for the promotion-door rules this depends on.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
export const WRANGLER_CONFIG_PATH = path.resolve(here, '../wrangler.jsonc');

/**
 * Strips // and slash-star block comments from JSONC text so it can be JSON.parse'd. Tracks
 * whether we're inside a string literal so "https://example.com" style values survive intact.
 * No deps — this is the entire jsonc-parsing story for this script.
 */
export function stripJsonComments(text) {
	let out = '';
	let inString = false;
	let inLineComment = false;
	let inBlockComment = false;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		const next = text[i + 1];
		if (inLineComment) {
			if (c === '\n') {
				inLineComment = false;
				out += c;
			}
			continue;
		}
		if (inBlockComment) {
			if (c === '*' && next === '/') {
				inBlockComment = false;
				i++;
			}
			continue;
		}
		if (inString) {
			out += c;
			if (c === '\\') {
				out += next;
				i++;
				continue;
			}
			if (c === '"') inString = false;
			continue;
		}
		if (c === '"') {
			inString = true;
			out += c;
			continue;
		}
		if (c === '/' && next === '/') {
			inLineComment = true;
			i++;
			continue;
		}
		if (c === '/' && next === '*') {
			inBlockComment = true;
			i++;
			continue;
		}
		out += c;
	}
	return out;
}

export function parseWranglerConfig(text) {
	return JSON.parse(stripJsonComments(text));
}

/** Reads the production and preview database_name for `binding` out of a parsed wrangler
 * config. Throws (a config bug, not a runtime decision) when either side is missing. */
export function resolveDatabaseNames(config, envName = 'preview', binding = 'DB') {
	const prod = (config.d1_databases ?? []).find((d) => d.binding === binding);
	const preview = (config.env?.[envName]?.d1_databases ?? []).find((d) => d.binding === binding);
	if (!prod) throw new Error(`no top-level d1_databases entry with binding "${binding}"`);
	if (!preview) {
		throw new Error(`no env.${envName} d1_databases entry with binding "${binding}"`);
	}
	return { prodName: prod.database_name, previewName: preview.database_name };
}

/** The safety guard: refuses when the preview database name equals production's. Everything
 * else in this script assumes this passed. */
export function assertSafeToReset({ prodName, previewName }) {
	if (prodName === previewName) {
		return {
			ok: false,
			reason: `refusing to reset: preview database_name "${previewName}" is the same as production's. Set env.preview d1_databases[0].database_name to a distinct (disposable) database before running this.`
		};
	}
	return { ok: true, value: undefined };
}

const PROTECTED_PREFIXES = ['sqlite_', '_cf_'];

/** Every real table gets dropped, including d1_migrations — the point is that the next
 * `migrations apply` believes nothing has run and reapplies from scratch. Only sqlite's own
 * internal tables and Cloudflare's `_cf_*` bookkeeping tables are protected. */
export function tablesToDrop(tableNames) {
	return tableNames.filter((name) => !PROTECTED_PREFIXES.some((p) => name.startsWith(p)));
}

export function dropTableSql(tableName) {
	const escaped = tableName.replace(/"/g, '""');
	return `DROP TABLE IF EXISTS "${escaped}";`;
}

function listTables(envName, binding) {
	const out = execFileSync(
		'wrangler',
		[
			'd1',
			'execute',
			binding,
			'--env',
			envName,
			'--remote',
			'--json',
			'-c',
			'wrangler.jsonc',
			'--command',
			"SELECT name FROM sqlite_master WHERE type='table'"
		],
		{ encoding: 'utf8' }
	);
	const parsed = JSON.parse(out);
	const rows = parsed[0]?.results ?? [];
	return rows.map((r) => r.name);
}

function dropTable(envName, binding, tableName) {
	execFileSync(
		'wrangler',
		[
			'd1',
			'execute',
			binding,
			'--env',
			envName,
			'--remote',
			'-c',
			'wrangler.jsonc',
			'--command',
			dropTableSql(tableName)
		],
		{ stdio: 'inherit' }
	);
}

async function main() {
	const envName = 'preview';
	const binding = 'DB';
	const text = readFileSync(WRANGLER_CONFIG_PATH, 'utf8');
	const config = parseWranglerConfig(text);
	const names = resolveDatabaseNames(config, envName, binding);
	const guard = assertSafeToReset(names);
	if (!guard.ok) {
		console.error(`[d1-reset] ${guard.reason}`);
		process.exit(1);
	}

	console.log(`[d1-reset] resetting ${names.previewName} (env.${envName})...`);
	const tables = tablesToDrop(listTables(envName, binding));
	for (const table of tables) {
		console.log(`[d1-reset] dropping ${table}`);
		dropTable(envName, binding, table);
	}
	console.log(`[d1-reset] done — ${tables.length} table(s) dropped.`);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
	main().catch((err) => {
		console.error(err);
		process.exit(1);
	});
}
