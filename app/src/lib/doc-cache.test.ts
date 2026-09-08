import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	clearAllCached,
	clearCached,
	getCached,
	isCached,
	revalidate,
	setCached
} from './doc-cache';
import type { OpenedDoc, Version } from './types';

const V1: Version = { id: 'v1', at: '2024-01-01T00:00:00.000Z', size: 10 };
const V2: Version = { id: 'v2', at: '2024-01-02T00:00:00.000Z', size: 12 };

function makeDoc(overrides: Partial<OpenedDoc> = {}): OpenedDoc {
	return {
		id: 'doc1',
		source: 'teamTopology\n  stream app "Product"\n',
		version: V1,
		versions: [V1],
		canEdit: false,
		links: { view: '/d/doc1#k=abc' },
		fragment: '#k=abc',
		...overrides
	};
}

describe('doc-cache', () => {
	beforeEach(() => {
		clearAllCached();
	});

	it('cache hit: returns the doc when the id and fragment (key) match', () => {
		const doc = makeDoc();
		setCached(doc);
		expect(getCached('doc1', '#k=abc')).toBe(doc);
		expect(isCached('doc1')).toBe(true);
	});

	it('cache miss: returns undefined for an id never cached', () => {
		expect(getCached('doc1', '#k=abc')).toBeUndefined();
		expect(isCached('doc1')).toBe(false);
	});

	it('invalidation on key mismatch: a different fragment clears the entry and misses', () => {
		const doc = makeDoc({ fragment: '#k=abc' });
		setCached(doc);
		expect(getCached('doc1', '#k=different')).toBeUndefined();
		// the mismatch cleared the stale entry entirely
		expect(isCached('doc1')).toBe(false);
		expect(getCached('doc1', '#k=abc')).toBeUndefined();
	});

	it('clearCached removes a single id without touching others', () => {
		setCached(makeDoc({ id: 'doc1' }));
		setCached(makeDoc({ id: 'doc2' }));
		clearCached('doc1');
		expect(isCached('doc1')).toBe(false);
		expect(isCached('doc2')).toBe(true);
	});

	it('revalidate: fetches fresh, updates the cache and returns it when the version id changed', async () => {
		const stale = makeDoc({ version: V1, versions: [V1] });
		setCached(stale);
		const fresh = makeDoc({ version: V2, versions: [V2, V1] });
		const fetchFresh = vi.fn<() => Promise<OpenedDoc>>().mockResolvedValue(fresh);

		const result = await revalidate('doc1', fetchFresh);

		expect(fetchFresh).toHaveBeenCalledOnce();
		expect(result).toBe(fresh);
		expect(getCached('doc1', '#k=abc')).toBe(fresh);
	});

	it('revalidate: returns undefined and leaves the cache untouched when the version id is unchanged', async () => {
		const cached = makeDoc({ version: V1, versions: [V1] });
		setCached(cached);
		const sameVersion = makeDoc({ version: V1, versions: [V1] });
		const fetchFresh = vi.fn<() => Promise<OpenedDoc>>().mockResolvedValue(sameVersion);

		const result = await revalidate('doc1', fetchFresh);

		expect(result).toBeUndefined();
		expect(getCached('doc1', '#k=abc')).toBe(cached);
	});

	it('revalidate: caches the fresh doc even when nothing was cached before', async () => {
		const fresh = makeDoc({ version: V1, versions: [V1] });
		const fetchFresh = vi.fn<() => Promise<OpenedDoc>>().mockResolvedValue(fresh);

		const result = await revalidate('doc1', fetchFresh);

		expect(result).toBe(fresh);
		expect(getCached('doc1', '#k=abc')).toBe(fresh);
	});
});
