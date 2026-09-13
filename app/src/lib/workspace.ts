/**
 * Workspace state for the editor's IDE chrome: the pane split (ratio + mode) and the
 * renderer viewport (zoom + fit). Everything here is pure and DOM-light so the editor
 * view only has to wire events to it — see `views/editor.ts`.
 *
 * Zoom is applied by scaling the SVG element's `width`/`height` attributes while its
 * `viewBox` stays put, so the diagram is re-rasterised by the browser at every scale and
 * never loses sharpness. Panning is the canvas' own scroll position, for the same reason.
 */

export type PaneMode = 'split' | 'editor' | 'renderer';

export interface WorkspaceState {
	/** Which panes are visible. */
	mode: PaneMode;
	/** Fraction of the workspace given to the source pane, 0–1. */
	ratio: number;
	/** Renderer scale, 1 = 100%. */
	zoom: number;
	/** Whether zoom follows the viewport (recomputed on every resize). */
	fit: boolean;
}

export const WORKSPACE_KEY = 'teamtopo.workspace';

/** Deterministic initial split: source pane gets 40% of the workspace. */
export const DEFAULT_RATIO = 0.4;
/** Ratio bounds used when a pixel extent is unknown or too small for the pixel minimums. */
export const MIN_RATIO = 0.15;
export const MAX_RATIO = 0.85;
/** Minimum pane size along the split axis: side-by-side, then stacked (narrow widths). */
export const MIN_PANE_PX = 260;
export const MIN_PANE_STACKED_PX = 120;

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4;
/** The zoom ladder the +/− controls step through, so button zoom is deterministic. */
export const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4] as const;

const EPSILON = 1e-4;

export const DEFAULT_WORKSPACE: WorkspaceState = {
	mode: 'split',
	ratio: DEFAULT_RATIO,
	zoom: 1,
	fit: true
};

function isPaneMode(v: unknown): v is PaneMode {
	return v === 'split' || v === 'editor' || v === 'renderer';
}

function finite(v: unknown): number | null {
	return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Clamp a split ratio into range. With a known pixel `extent` for the whole workspace both
 * panes also keep `minPx`; when the workspace is too small to honour that for both panes
 * (very narrow windows) only the percentage bounds apply, so the divider never jumps.
 */
export function clampRatio(ratio: number, extent?: number, minPx = MIN_PANE_PX): number {
	const r = finite(ratio) ?? DEFAULT_RATIO;
	let lo = MIN_RATIO;
	let hi = MAX_RATIO;
	const px = finite(extent);
	if (px !== null && px > 0 && px > 2 * minPx) {
		lo = Math.max(lo, minPx / px);
		hi = Math.min(hi, 1 - minPx / px);
	}
	return Math.min(hi, Math.max(lo, r));
}

export function clampZoom(zoom: number): number {
	const z = finite(zoom) ?? 1;
	return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

/** Next rung of the zoom ladder above `zoom` (the maximum once past the top rung). */
export function nextZoom(zoom: number): number {
	const z = clampZoom(zoom);
	return ZOOM_STEPS.find((step) => step > z + EPSILON) ?? MAX_ZOOM;
}

/** Previous rung of the zoom ladder below `zoom` (the minimum once past the bottom rung). */
export function prevZoom(zoom: number): number {
	const z = clampZoom(zoom);
	for (let i = ZOOM_STEPS.length - 1; i >= 0; i--) {
		if (ZOOM_STEPS[i] < z - EPSILON) return ZOOM_STEPS[i];
	}
	return MIN_ZOOM;
}

export function formatZoom(zoom: number): string {
	return `${Math.round(clampZoom(zoom) * 100)}%`;
}

export interface Size {
	w: number;
	h: number;
}

/**
 * Scale that fits `content` inside `viewport`, clamped to the zoom bounds. `null` when
 * either box has no usable size — a hidden or not-yet-laid-out pane must not clobber the
 * current zoom with a garbage value.
 */
export function fitZoom(content: Size | null, viewport: Size | null): number | null {
	if (!content || !viewport) return null;
	const { w: cw, h: ch } = content;
	const { w: vw, h: vh } = viewport;
	for (const n of [cw, ch, vw, vh]) {
		if (finite(n) === null || n <= 0) return null;
	}
	return clampZoom(Math.min(vw / cw, vh / ch));
}

/** Unscaled diagram size, from the `viewBox` the library always emits (or the attributes). */
export function naturalSize(svg: Element | null | undefined): Size | null {
	if (!svg) return null;
	const box = svg.getAttribute('viewBox');
	if (box) {
		const parts = box
			.trim()
			.split(/[\s,]+/)
			.map(Number);
		if (
			parts.length === 4 &&
			parts.every((n) => Number.isFinite(n)) &&
			parts[2] > 0 &&
			parts[3] > 0
		)
			return { w: parts[2], h: parts[3] };
	}
	const w = Number(svg.getAttribute('width'));
	const h = Number(svg.getAttribute('height'));
	return Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? { w, h } : null;
}

/** Stored workspace, merged over the defaults. Never throws, never returns junk. */
export function readWorkspace(): WorkspaceState {
	let raw: string | null = null;
	try {
		raw = localStorage.getItem(WORKSPACE_KEY);
	} catch {
		return { ...DEFAULT_WORKSPACE };
	}
	if (!raw) return { ...DEFAULT_WORKSPACE };
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return { ...DEFAULT_WORKSPACE };
	}
	if (typeof parsed !== 'object' || parsed === null) return { ...DEFAULT_WORKSPACE };
	const v = parsed as Partial<Record<keyof WorkspaceState, unknown>>;
	return {
		mode: isPaneMode(v.mode) ? v.mode : DEFAULT_WORKSPACE.mode,
		ratio: clampRatio(finite(v.ratio) ?? DEFAULT_WORKSPACE.ratio),
		zoom: clampZoom(finite(v.zoom) ?? DEFAULT_WORKSPACE.zoom),
		fit: typeof v.fit === 'boolean' ? v.fit : DEFAULT_WORKSPACE.fit
	};
}

export function writeWorkspace(state: WorkspaceState): void {
	try {
		localStorage.setItem(WORKSPACE_KEY, JSON.stringify(state));
	} catch {
		// storage unavailable: the layout is a convenience only
	}
}
