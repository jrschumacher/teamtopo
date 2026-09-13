// Type declarations for the plain-JS library at ../../../src/teamtopo.js.
// Vite resolves `@lib/teamtopo` to that file (see vite.config.ts / vitest.config.ts).
declare module '@lib/teamtopo' {
	export type TeamType = 'stream' | 'enabling' | 'subsystem' | 'platform' | 'group';
	export type Mode = 'collaboration' | 'xaas' | 'facilitating';

	export interface Node {
		id: string;
		type: TeamType;
		label: string;
		attrs: Record<string, string>;
		api: Record<string, string> | null;
		/** Ids of the real teams that own this node. Empty when no team claims it. */
		owners: string[];
		children: Node[];
		parent: string | null;
		line: number;
	}

	export interface Interaction {
		mode: Mode;
		/** Provider for xaas, facilitator for facilitating. */
		from: string;
		to: string;
		label: string;
		attrs: Record<string, string>;
		soon: boolean;
		duration: string;
		line: number;
	}

	/** A real team: the thing a Team API belongs to. It owns nodes rather than being one. */
	export interface OrgTeam {
		isTeam: true;
		id: string;
		label: string;
		attrs: Record<string, string>;
		api: Record<string, string> | null;
		owns: string[];
		load: { streams: number; nodes: number };
		ownsLine: number;
		line: number;
	}

	export interface Diagnostic {
		level: 'warning';
		code: string;
		line: number;
		message: string;
	}

	export interface ApiField {
		key: string;
		choices: string[];
		group: number;
	}

	export type Entry = Node | OrgTeam;

	export interface Model {
		title: string;
		flow: string | null;
		legend: boolean;
		nodes: Node[];
		teams: Node[];
		orgTeams: OrgTeam[];
		interactions: Interaction[];
		apiFields: ApiField[];
		diagnostics: Diagnostic[];
		index: Record<string, Entry>;
	}

	export interface Box {
		x: number;
		y: number;
		w: number;
		h: number;
		node: Node;
		kind: 'frame' | 'lane' | 'plat' | 'sub' | 'en';
		lines: string[];
		note: string[];
		fs: number;
		labelZone?: unknown;
		rotate?: boolean;
	}

	export interface Edge {
		inter: Interaction;
		geo: { kind: 'wedge' | 'bridge' | 'patch' | 'band'; [k: string]: unknown };
	}

	export interface Layout {
		width: number;
		height: number;
		boxes: Record<string, Box>;
		edges: Edge[];
		content: unknown;
		title: { x: number; y: number } | null;
		flow: { x: number; y: number; w: number; label: string } | null;
		legend: { x: number; y: number; w: number } | null;
	}

	export interface ThemeColors {
		fill: string;
		stroke: string;
		text: string;
	}

	export interface Theme {
		bg: string;
		text: string;
		muted: string;
		title: string;
		flow: string;
		flowText: string;
		halo: string;
		stream: ThemeColors;
		enabling: ThemeColors;
		subsystem: ThemeColors;
		platform: ThemeColors;
		frame: ThemeColors & { platformFill: string };
		collab: ThemeColors;
		xaas: ThemeColors;
		facil: { dot: string; fill: string; text: string };
	}

	export interface LayoutOptions {
		legend?: boolean;
	}

	export interface RenderOptions extends LayoutOptions {
		theme?: 'light' | 'dark' | Partial<Theme>;
		idPrefix?: string;
		fontFamily?: string;
	}

	export interface TeamApiField {
		key: string;
		aliases: string[];
	}

	export const VERSION: string;
	export const TEAM_TYPES: Record<TeamType, { name: string; rank: number | null }>;
	export const TYPE_KEYWORDS: Record<TeamType, string>;
	export const MODES: Record<Mode, { name: string }>;
	export const THEMES: { light: Theme; dark: Theme };
	export const TEAM_API_FIELDS: TeamApiField[];

	export class ParseError extends Error {
		constructor(detail: string, line: number);
		detail: string;
		line: number;
	}

	export function parse(source: string): Model;
	export function layout(model: Model, opts?: LayoutOptions): Layout;
	export function render(sourceOrModel: string | Model, opts?: RenderOptions): string;
	export function teamApi(model: string | Model, teamId: string, opts?: { date?: string }): string;
	export function teamApis(
		model: string | Model,
		opts?: { date?: string }
	): { id: string; label: string; markdown: string }[];
	export function textWidth(text: string, fontSize: number): number;
	export function wrapText(text: string, maxWidth: number, fontSize: number): string[];
}
