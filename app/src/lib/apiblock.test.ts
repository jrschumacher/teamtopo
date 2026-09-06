import { describe, expect, it } from 'vitest';
import { parse, teamApi } from '@lib/teamtopo';
import ecommerce from '../../../examples/ecommerce.tt?raw';
import { ApiBlockValueError, UnknownTeamError, readApiBlock, writeApiBlock } from './apiblock';

describe('readApiBlock', () => {
	it('reads the fields from an existing block, keyed by canonical name', () => {
		const fields = readApiBlock(ecommerce, 'checkout');
		expect(fields).toEqual({
			focus: 'the checkout experience end to end',
			software: 'checkout-service, cart-ui',
			sle: '99.9% availability, p95 < 300 ms',
			versioning: 'semver, two releases of deprecation notice',
			wiki: 'checkout, cart, basket',
			chat: '#checkout #checkout-alerts',
			sync: '09:30 UTC',
			workingon: 'migrating to the new payments API',
			waysofworking: 'trunk-based development, pairing on Tuesdays',
			improvements: 'shared on-call rotation with Accounts'
		});
	});

	it('returns an empty object for a team with no api block', () => {
		expect(readApiBlock(ecommerce, 'search')).toEqual({});
	});

	it('throws UnknownTeamError for a team id not in the diagram', () => {
		expect(() => readApiBlock(ecommerce, 'nope')).toThrow(UnknownTeamError);
	});
});

describe('writeApiBlock', () => {
	const src = ['teamTopology', '  stream checkout "Checkout"', '  stream search "Search"', ''].join(
		'\n'
	);

	it('inserts a new block at the end when none exists', () => {
		const out = writeApiBlock(src, 'checkout', { focus: 'the checkout flow' });
		expect(out).not.toBe(src);
		expect(out.startsWith(src.trimEnd())).toBe(true);
		expect(readApiBlock(out, 'checkout')).toEqual({ focus: 'the checkout flow' });
		// everything before the new block is untouched
		expect(out.slice(0, src.trimEnd().length)).toBe(src.trimEnd());
	});

	it('replaces an existing block in place, preserving the rest of the file', () => {
		const before = readApiBlock(ecommerce, 'checkout');
		const out = writeApiBlock(ecommerce, 'checkout', { ...before, sync: '10:00 UTC' });
		expect(readApiBlock(out, 'checkout')).toEqual({ ...before, sync: '10:00 UTC' });
		// the other team's declaration and everything outside the block is untouched
		expect(out).toContain('stream   search     "Search & Discovery"  [size=6]');
		expect(out).toContain('infra    --> checkout, search, accounts');
		// only one "api checkout {" block remains
		expect(out.match(/api\s+checkout\s*\{/gi)?.length).toBe(1);
	});

	it('removes a field by setting it to an empty string', () => {
		const before = readApiBlock(ecommerce, 'checkout');
		expect(before.sync).toBe('09:30 UTC');
		const out = writeApiBlock(ecommerce, 'checkout', { ...before, sync: '' });
		const after = readApiBlock(out, 'checkout');
		expect(after.sync).toBeUndefined();
		expect(after.focus).toBe(before.focus);
	});

	it('keeps existing field order, then appends new fields in TEAM_API_FIELDS order', () => {
		const out = writeApiBlock(src, 'checkout', { sle: '99.9%', focus: 'checkout flow' });
		const m = /api checkout \{\n([\s\S]*?)\n\s*\}/.exec(out);
		expect(m).not.toBeNull();
		const fieldLines = m![1]
			.split('\n')
			.map((l) => l.trim())
			.filter(Boolean);
		// TEAM_API_FIELDS order: focus before sle
		expect(fieldLines[0].startsWith('focus:')).toBe(true);
		expect(fieldLines[1].startsWith('sle:')).toBe(true);

		const out2 = writeApiBlock(out, 'checkout', { sle: '99.9%', focus: 'checkout flow' });
		// re-writing with the same fields preserves the on-disk order (sle stays first now)
		const m2 = /api checkout \{\n([\s\S]*?)\n\s*\}/.exec(out2);
		const fieldLines2 = m2![1]
			.split('\n')
			.map((l) => l.trim())
			.filter(Boolean);
		expect(fieldLines2).toEqual(fieldLines);
	});

	it('throws UnknownTeamError for a team id not in the diagram', () => {
		expect(() => writeApiBlock(src, 'nope', { focus: 'x' })).toThrow(UnknownTeamError);
	});

	it('rejects a multi-line field value: the parser has no continuation syntax for api fields', () => {
		expect(() => writeApiBlock(src, 'checkout', { focus: 'line one\nline two' })).toThrow(
			ApiBlockValueError
		);
	});

	it('round-trips: parse(writeApiBlock(src, id, readApiBlock(src, id))) matches parse(src)', () => {
		for (const id of ['checkout', 'search', 'accounts', 'infra']) {
			const fields = readApiBlock(ecommerce, id);
			const rewritten = writeApiBlock(ecommerce, id, fields);
			expect(teamApi(parse(rewritten), id)).toBe(teamApi(parse(ecommerce), id));
		}
	});
});
