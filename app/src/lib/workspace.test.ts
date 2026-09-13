import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	clampRatio,
	clampZoom,
	DEFAULT_RATIO,
	DEFAULT_WORKSPACE,
	fitZoom,
	formatZoom,
	MAX_RATIO,
	MAX_ZOOM,
	MIN_RATIO,
	MIN_ZOOM,
	naturalSize,
	nextZoom,
	prevZoom,
	readWorkspace,
	WORKSPACE_KEY,
	writeWorkspace
} from './workspace';

/** happy-dom under vitest exposes no usable localStorage; a Map-backed stand-in is enough. */
function fakeStorage(): Storage {
	const m = new Map<string, string>();
	return {
		get length() {
			return m.size;
		},
		clear: () => m.clear(),
		getItem: (k: string) => m.get(k) ?? null,
		key: (i: number) => [...m.keys()][i] ?? null,
		removeItem: (k: string) => void m.delete(k),
		setItem: (k: string, v: string) => void m.set(k, v)
	};
}

function svgWith(attrs: Record<string, string>): Element {
	const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
	return el;
}

describe('clampRatio', () => {
	it('keeps the ratio inside the percentage bounds when no extent is known', () => {
		expect(clampRatio(0.5)).toBe(0.5);
		expect(clampRatio(0)).toBe(MIN_RATIO);
		expect(clampRatio(1)).toBe(MAX_RATIO);
		expect(clampRatio(Number.NaN)).toBe(DEFAULT_RATIO);
	});

	it('enforces a pixel minimum on both panes when the extent is known', () => {
		// 1000px wide, 260px minimum → 26%…74%.
		expect(clampRatio(0.5, 1000)).toBe(0.5);
		expect(clampRatio(0.05, 1000)).toBeCloseTo(0.26, 5);
		expect(clampRatio(0.99, 1000)).toBeCloseTo(0.74, 5);
	});

	it('honours a smaller minimum for the stacked (narrow) workspace', () => {
		expect(clampRatio(0.05, 1000, 120)).toBeCloseTo(0.15, 5);
		expect(clampRatio(0.05, 400, 120)).toBeCloseTo(0.3, 5);
	});

	it('falls back to the percentage bounds when both minimums cannot fit', () => {
		expect(clampRatio(0.05, 400)).toBe(MIN_RATIO);
		expect(clampRatio(0.99, 400)).toBe(MAX_RATIO);
	});
});

describe('zoom steps', () => {
	it('steps up and down a fixed ladder, deterministically from any value', () => {
		expect(nextZoom(1)).toBe(1.25);
		expect(prevZoom(1)).toBe(0.75);
		expect(nextZoom(0.58)).toBe(0.67);
		expect(prevZoom(0.58)).toBe(0.5);
		expect(nextZoom(1.0000001)).toBe(1.25);
	});

	it('stops at the bounds', () => {
		expect(nextZoom(MAX_ZOOM)).toBe(MAX_ZOOM);
		expect(nextZoom(99)).toBe(MAX_ZOOM);
		expect(prevZoom(MIN_ZOOM)).toBe(MIN_ZOOM);
		expect(prevZoom(0.01)).toBe(MIN_ZOOM);
	});

	it('clamps and formats', () => {
		expect(clampZoom(10)).toBe(MAX_ZOOM);
		expect(clampZoom(0)).toBe(MIN_ZOOM);
		expect(clampZoom(Number.NaN)).toBe(1);
		expect(formatZoom(1)).toBe('100%');
		expect(formatZoom(0.5867)).toBe('59%');
	});
});

describe('fitZoom', () => {
	it('fits the more constrained axis', () => {
		expect(fitZoom({ w: 600, h: 400 }, { w: 300, h: 400 })).toBe(0.5);
		expect(fitZoom({ w: 600, h: 400 }, { w: 600, h: 200 })).toBe(0.5);
	});

	it('clamps to the zoom bounds', () => {
		expect(fitZoom({ w: 10, h: 10 }, { w: 1000, h: 1000 })).toBe(MAX_ZOOM);
		expect(fitZoom({ w: 10000, h: 10000 }, { w: 100, h: 100 })).toBe(MIN_ZOOM);
	});

	it('refuses to guess without a usable box', () => {
		expect(fitZoom(null, { w: 100, h: 100 })).toBeNull();
		expect(fitZoom({ w: 100, h: 100 }, null)).toBeNull();
		expect(fitZoom({ w: 100, h: 100 }, { w: 0, h: 100 })).toBeNull();
		expect(fitZoom({ w: 0, h: 0 }, { w: 100, h: 100 })).toBeNull();
	});
});

describe('naturalSize', () => {
	it('reads the viewBox the library emits', () => {
		expect(naturalSize(svgWith({ viewBox: '0 0 640 480', width: '320' }))).toEqual({
			w: 640,
			h: 480
		});
	});

	it('falls back to the width/height attributes', () => {
		expect(naturalSize(svgWith({ width: '640', height: '480' }))).toEqual({ w: 640, h: 480 });
	});

	it('returns null for a missing or unusable element', () => {
		expect(naturalSize(null)).toBeNull();
		expect(naturalSize(svgWith({ viewBox: 'nonsense' }))).toBeNull();
		expect(naturalSize(svgWith({ width: '0', height: '0' }))).toBeNull();
	});
});

describe('workspace persistence', () => {
	beforeEach(() => vi.stubGlobal('localStorage', fakeStorage()));
	afterEach(() => vi.unstubAllGlobals());

	it('round-trips a workspace', () => {
		const state = { mode: 'renderer', ratio: 0.62, zoom: 1.5, fit: false } as const;
		writeWorkspace({ ...state });
		expect(readWorkspace()).toEqual(state);
	});

	it('returns the defaults when nothing is stored', () => {
		expect(readWorkspace()).toEqual(DEFAULT_WORKSPACE);
	});

	it('ignores stored junk, field by field', () => {
		localStorage.setItem(WORKSPACE_KEY, 'not json at all');
		expect(readWorkspace()).toEqual(DEFAULT_WORKSPACE);

		localStorage.setItem(WORKSPACE_KEY, '"a string"');
		expect(readWorkspace()).toEqual(DEFAULT_WORKSPACE);

		localStorage.setItem(
			WORKSPACE_KEY,
			JSON.stringify({ mode: 'sideways', ratio: 'wide', zoom: 999, fit: 'yes' })
		);
		expect(readWorkspace()).toEqual({ ...DEFAULT_WORKSPACE, zoom: MAX_ZOOM });
	});

	it('survives storage that throws on read and on write', () => {
		vi.stubGlobal('localStorage', {
			getItem: () => {
				throw new Error('blocked');
			},
			setItem: () => {
				throw new Error('blocked');
			}
		});
		expect(readWorkspace()).toEqual(DEFAULT_WORKSPACE);
		expect(() => writeWorkspace(DEFAULT_WORKSPACE)).not.toThrow();
	});
});
