import { describe, expect, it } from 'vitest';
import { parse, render, teamApis, ParseError } from '@lib/teamtopo';

const src =
	'teamTopology\n  stream app "Product Team"\n  platform infra "Platform"\n  infra --> app\n';

describe('@lib/teamtopo alias', () => {
	it('resolves the library and renders SVG', () => {
		const model = parse(src);
		expect(model.teams.map((t) => t.id)).toEqual(['app', 'infra']);
		expect(render(model)).toMatch(/^<svg/);
		expect(teamApis(model).map((t) => t.id)).toEqual(['app', 'infra']);
	});

	it('exposes ParseError with a line number', () => {
		expect(() => parse('teamTopology\n  bogus')).toThrow(ParseError);
		try {
			parse('teamTopology\n  bogus');
		} catch (e) {
			expect((e as ParseError).line).toBe(2);
		}
	});
});
