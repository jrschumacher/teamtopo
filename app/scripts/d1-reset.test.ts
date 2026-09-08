import { describe, expect, it } from 'vitest';
import {
	assertSafeToReset,
	dropTableSql,
	parseWranglerConfig,
	resolveDatabaseNames,
	stripJsonComments,
	tablesToDrop
} from './d1-reset.mjs';

describe('stripJsonComments', () => {
	it('removes // line comments without touching string contents', () => {
		const input = '{\n  // a comment\n  "a": 1, // trailing\n  "url": "https://example.com"\n}';
		const parsed = JSON.parse(stripJsonComments(input));
		expect(parsed).toEqual({ a: 1, url: 'https://example.com' });
	});

	it('removes /* */ block comments', () => {
		const input = '{ /* block */ "a": 1 }';
		expect(JSON.parse(stripJsonComments(input))).toEqual({ a: 1 });
	});
});

describe('parseWranglerConfig', () => {
	it('parses a jsonc document with comments into an object', () => {
		const text = '{\n  // comment\n  "name": "app"\n}';
		expect(parseWranglerConfig(text)).toEqual({ name: 'app' });
	});
});

describe('resolveDatabaseNames', () => {
	const config = {
		d1_databases: [{ binding: 'DB', database_name: 'teamtopo', database_id: 'prod-id' }],
		env: {
			preview: {
				d1_databases: [
					{ binding: 'DB', database_name: 'teamtopo-preview', database_id: 'preview-id' }
				]
			}
		}
	};

	it('reads the production and preview database_name for a binding', () => {
		expect(resolveDatabaseNames(config)).toEqual({
			prodName: 'teamtopo',
			previewName: 'teamtopo-preview'
		});
	});

	it('throws when the top-level binding is missing', () => {
		expect(() => resolveDatabaseNames({ env: config.env })).toThrow(/no top-level/);
	});

	it('throws when the preview env binding is missing', () => {
		expect(() => resolveDatabaseNames({ d1_databases: config.d1_databases })).toThrow(
			/no env\.preview/
		);
	});
});

describe('assertSafeToReset', () => {
	it('refuses when the preview database name equals production', () => {
		const result = assertSafeToReset({ prodName: 'teamtopo', previewName: 'teamtopo' });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toMatch(/refusing to reset/);
	});

	it('allows when the preview database name differs from production', () => {
		const result = assertSafeToReset({ prodName: 'teamtopo', previewName: 'teamtopo-preview' });
		expect(result.ok).toBe(true);
	});
});

describe('tablesToDrop', () => {
	it('drops every table including d1_migrations', () => {
		expect(tablesToDrop(['subscribers', 'd1_migrations'])).toEqual([
			'subscribers',
			'd1_migrations'
		]);
	});

	it('protects sqlite_ and _cf_ internal tables', () => {
		expect(tablesToDrop(['subscribers', 'sqlite_sequence', '_cf_KV'])).toEqual(['subscribers']);
	});
});

describe('dropTableSql', () => {
	it('builds a DROP TABLE IF EXISTS statement with the name quoted', () => {
		expect(dropTableSql('subscribers')).toBe('DROP TABLE IF EXISTS "subscribers";');
	});

	it('escapes embedded double quotes', () => {
		expect(dropTableSql('weird"name')).toBe('DROP TABLE IF EXISTS "weird""name";');
	});
});
