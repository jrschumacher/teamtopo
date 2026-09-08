/**
 * Team API page for one team: hero card, grouped api-field sections (view/edit), the
 * interactions this team is part of (now / soon), and an aside with a highlighted
 * diagram thumbnail and the rest of the teams. Restyled from the shared editor design
 * (docs/editor-design.md); reuses the editor header shell, chip/type-pill vocabulary
 * and popover-free layout.
 */
import {
	MODES,
	parse,
	render as renderDiagram,
	teamApi,
	TEAM_API_FIELDS,
	TEAM_TYPES,
	type Interaction,
	type Model,
	type Node,
	type TeamType
} from '@lib/teamtopo';
import type { OpenedDoc } from '../lib/types';
import { escapeHtml } from '../lib/markdown';
import { readApiBlock, writeApiBlock } from '../lib/apiblock';
import { brandMarkHtml } from '../lib/brand';
import { docPath, teamLink } from '../lib/links';
import './editor.css';
import './team.css';

const COPY_FEEDBACK_MS = 1400;

/** Human labels for the TEAM_API_FIELDS form inputs, matching the Team API template. */
const FIELD_LABELS: Record<string, string> = {
	focus: 'Focus',
	platform: 'Part of a platform',
	service: 'Service we provide',
	sle: 'SLE',
	software: 'Software owned',
	versioning: 'Versioning approach',
	wiki: 'Wiki search terms',
	chat: 'Chat channels',
	sync: 'Daily sync time',
	workingon: 'Currently working on',
	waysofworking: 'Ways of working',
	improvements: 'Cross-team improvements'
};

const FIELD_PLACEHOLDERS: Record<string, string> = {
	focus: 'What this team focuses on',
	platform: 'e.g. part of the checkout platform',
	service: 'What this team provides to other teams',
	sle: 'Response times, uptime, support hours…',
	software: 'Systems and repos this team owns',
	versioning: 'How this team versions its APIs',
	wiki: 'Terms to search the wiki for this team',
	chat: '#channel-name',
	sync: 'e.g. 09:30 UTC',
	workingon: 'What the team is working on right now',
	waysofworking: 'Scrum, Kanban, async…',
	improvements: 'Cross-team initiatives underway'
};

interface FieldGroup {
	title: string;
	keys: string[];
}

/** Design's five groups, mapped to the syntax's canonical TEAM_API_FIELDS keys. */
const GROUPS: FieldGroup[] = [
	{ title: 'Mission', keys: ['focus', 'service', 'platform'] },
	{ title: 'What we own', keys: ['software', 'versioning', 'wiki'] },
	{ title: 'Service level expectations', keys: ['sle'] },
	{ title: 'Working with us', keys: ['chat', 'sync', 'waysofworking'] },
	{ title: 'Right now', keys: ['workingon', 'improvements'] }
];

const TYPE_LABEL: Partial<Record<TeamType, string>> = Object.fromEntries(
	Object.entries(TEAM_TYPES).map(([type, spec]) => [type, spec.name])
);

function otherTeams(model: Model, teamId: string): Node[] {
	return model.teams.filter((t) => t.type !== 'group' && t.id !== teamId);
}

function chipHtml(type: string, size: 'lg' | 'sm'): string {
	return `<span class="tm-chip tm-chip-${size} ${escapeHtml(type)}" aria-hidden="true"></span>`;
}

function breadcrumbHtml(doc: OpenedDoc, docTitle: string, teamLabel: string): string {
	const docHref = `${docPath(doc.id)}${doc.fragment}`;
	return `
		<nav class="breadcrumb" aria-label="Breadcrumb">
			<a href="${docHref}">${escapeHtml(docTitle)}</a>
			<span class="tm-crumb-sep">/</span>
			<span class="tm-crumb-current">${escapeHtml(teamLabel)}</span>
		</nav>
	`;
}

function headerHtml(doc: OpenedDoc, docTitle: string, teamLabel: string): string {
	const docHref = `${docPath(doc.id)}${doc.fragment}`;
	const openEditor =
		doc.canEdit && doc.links.edit
			? `<a class="ed-btn" id="open-editor" href="${escapeHtml(doc.links.edit)}">Open in editor</a>`
			: '';
	return `
		<header class="ed-bar">
			<a class="ed-brand" href="/">${brandMarkHtml()}teamtopo</a>
			<span class="ed-divider"></span>
			${breadcrumbHtml(doc, docTitle, teamLabel)}
			<span class="ed-spacer"></span>
			<span class="ed-state">
				<span class="ed-state-dot" id="save-dot" data-tone="ok"></span>
				<span id="save-status">Saved &middot; encrypted</span>
			</span>
			${openEditor}
		</header>
		<a class="tm-back" href="${docHref}">&larr; Back to diagram</a>
	`;
}

/** Every field a team can set, keyed by canonical name, whichever alias was used. */
function unmappedFields(node: Node): { key: string; label: string; value: string }[] {
	if (!node.api) return [];
	const known = new Set(TEAM_API_FIELDS.flatMap((f) => f.aliases));
	return Object.entries(node.api)
		.filter(([key]) => !known.has(key))
		.map(([key, value]) => ({
			key,
			label: key.charAt(0).toUpperCase() + key.slice(1),
			value
		}));
}

function rowHtml(key: string, label: string, value: string, editing: boolean): string {
	if (editing) {
		const placeholder = escapeHtml(FIELD_PLACEHOLDERS[key] ?? '');
		return `
			<dt>${escapeHtml(label)}</dt>
			<dd><input name="${escapeHtml(key)}" value="${escapeHtml(value)}" placeholder="${placeholder}" aria-label="${escapeHtml(label)}"></dd>
		`;
	}
	const display = value ? escapeHtml(value) : 'not documented yet';
	const cls = value ? '' : ' class="tm-empty-value"';
	return `<dt>${escapeHtml(label)}</dt><dd${cls}>${display}</dd>`;
}

function otherRowHtml(label: string, value: string): string {
	return `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`;
}

function sectionsHtml(node: Node, fields: Record<string, string>, editing: boolean): string {
	const groups = GROUPS.map(
		(g) => `
		<section class="tm-card">
			<h2 class="tm-section-title">${escapeHtml(g.title)}</h2>
			<dl class="tm-dl">
				${g.keys.map((key) => rowHtml(key, FIELD_LABELS[key] ?? key, fields[key] ?? '', editing)).join('')}
			</dl>
		</section>
	`
	).join('');

	const other = unmappedFields(node);
	const otherHtml = other.length
		? `
		<section class="tm-card">
			<h2 class="tm-section-title">Other</h2>
			<dl class="tm-dl">
				${other.map((o) => otherRowHtml(o.label, o.value)).join('')}
			</dl>
		</section>
	`
		: '';

	return groups + otherHtml;
}

function emptyBannerHtml(teamId: string, canEdit: boolean): string {
	const fillBtn = canEdit
		? `<button type="button" class="ed-btn ed-btn-outline" data-action="enter-edit">Fill it in</button>`
		: '';
	return `
		<section class="tm-banner">
			<div class="tm-banner-copy">
				<p class="tm-banner-title">No <span class="tm-mono">api</span> block yet</p>
				<p class="tm-banner-body">Interactions below come from the diagram. Fill in the rest &mdash; it saves as an <span class="tm-mono">api ${escapeHtml(teamId)} { }</span> block in the source text.</p>
			</div>
			${fillBtn}
		</section>
	`;
}

function heroHtml(node: Node, canEdit: boolean, editing: boolean): string {
	const size = node.attrs.size;
	const sizeHtml = size ? `<span class="tm-size">${escapeHtml(size)} people</span>` : '';
	const note = node.attrs.note;
	const blurbHtml = note ? `<p class="tm-blurb">${escapeHtml(note)}</p>` : '';
	const typeLabel = TYPE_LABEL[node.type] ?? node.type;
	const editBtn =
		canEdit && !editing
			? `<button type="button" class="ed-btn ed-btn-primary" data-action="enter-edit">Edit Team API</button>`
			: '';
	return `
		<section class="tm-card tm-hero">
			<div class="tm-hero-row">
				${chipHtml(node.type, 'lg')}
				<h1 class="tm-name">${escapeHtml(node.label)}</h1>
				<span class="tm-id">${escapeHtml(node.id)}</span>
				<span class="tm-type-pill ${escapeHtml(node.type)}">${escapeHtml(typeLabel)}</span>
				${sizeHtml}
				<span class="ed-spacer"></span>
				<div class="tm-hero-actions">
					<button type="button" class="ed-btn" id="copy-api" data-action="copy-markdown">Copy Markdown</button>
					${editBtn}
				</div>
			</div>
			${blurbHtml}
		</section>
	`;
}

function modeLabel(mode: Interaction['mode']): string {
	return MODES[mode]?.name ?? mode;
}

function interactionRowHtml(model: Model, doc: OpenedDoc, teamId: string, it: Interaction): string {
	const otherId = it.from === teamId ? it.to : it.from;
	const other = model.index[otherId];
	if (!other) return '';
	return `
		<div class="tm-inter-row${it.soon ? ' tm-inter-soon' : ''}">
			${chipHtml(other.type, 'sm')}
			<a href="${teamLink(doc.id, other.id, doc.fragment)}" class="tm-inter-name">${escapeHtml(other.label)}</a>
			<span class="tm-mode-pill">${escapeHtml(modeLabel(it.mode))}</span>
			<span class="tm-inter-desc">${escapeHtml(it.label)}</span>
			<span class="ed-spacer"></span>
			<span class="tm-inter-meta">${escapeHtml(it.duration)}</span>
		</div>
	`;
}

function interactionsHtml(model: Model, doc: OpenedDoc, teamId: string): string {
	const mine = model.interactions.filter((it) => it.from === teamId || it.to === teamId);
	const now = mine.filter((it) => !it.soon);
	const soon = mine.filter((it) => it.soon);

	const nowHtml =
		now.length > 0
			? now.map((it) => interactionRowHtml(model, doc, teamId, it)).join('')
			: '<p class="tm-empty-value">No interactions recorded yet.</p>';

	const soonHtml =
		soon.length > 0
			? `
			<h2 class="tm-section-title tm-section-title-spaced">Expected to interact with soon</h2>
			<div class="tm-inter-list">${soon.map((it) => interactionRowHtml(model, doc, teamId, it)).join('')}</div>
		`
			: '';

	return `
		<section class="tm-card">
			<div class="tm-section-head">
				<h2 class="tm-section-title">Teams we currently interact with</h2>
				<span class="tm-section-sub">from the diagram</span>
			</div>
			<div class="tm-inter-list">${nowHtml}</div>
			${soonHtml}
		</section>
	`;
}

function teamRowHtml(doc: OpenedDoc, t: Node, isCurrent: boolean): string {
	const rowInner = `
			${chipHtml(t.type, 'sm')}
			<span class="tm-other-name">${escapeHtml(t.label)}</span>
			<span class="tm-other-id">${escapeHtml(t.id)}</span>
	`;
	if (isCurrent) {
		return `<div class="tm-other-link tm-other-current" aria-current="page">${rowInner}</div>`;
	}
	return `<a class="tm-other-link" href="${teamLink(doc.id, t.id, doc.fragment)}">${rowInner}</a>`;
}

function asideHtml(model: Model, doc: OpenedDoc, teamId: string, teamLabel: string): string {
	const docHref = `${docPath(doc.id)}${doc.fragment}`;
	const teams = model.teams.filter((t) => t.type !== 'group');
	const teamLinksHtml = teams.length
		? teams.map((t) => teamRowHtml(doc, t, t.id === teamId)).join('')
		: '<p class="tm-empty-value">No teams.</p>';

	return `
		<aside class="tm-aside">
			<section class="tm-card">
				<h2 class="tm-section-title">In the diagram</h2>
				<a class="tm-diagram-link" href="${docHref}" title="Open the full diagram">
					<div class="tm-diagram" id="team-diagram"></div>
				</a>
				<p class="tm-diagram-caption">${escapeHtml(teamLabel)} highlighted. Click any team in the live diagram to open its Team API page.</p>
			</section>
			<section class="tm-card">
				<h2 class="tm-section-title">Teams</h2>
				<div class="tm-other-list">${teamLinksHtml}</div>
			</section>
			<p class="tm-attribution">Team API template &middot; <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a></p>
		</aside>
	`;
}

function stickyBarHtml(): string {
	return `
		<div class="tm-sticky-bar">
			<button type="submit" class="ed-btn ed-btn-primary" data-action="save">Save</button>
			<button type="button" class="ed-btn" data-action="cancel-edit">Cancel</button>
			<span role="status" class="tm-sticky-status">Writes back into the api block in the source text</span>
		</div>
	`;
}

function unknownTeamHtml(doc: OpenedDoc, model: Model, teamId: string): string {
	const items = otherTeams(model, teamId)
		.map(
			(t) => `<li><a href="${teamLink(doc.id, t.id, doc.fragment)}">${escapeHtml(t.label)}</a></li>`
		)
		.join('');
	return `
		<div class="team-page">
			${breadcrumbHtml(doc, model.title?.trim() || 'Untitled diagram', teamId)}
			<h1>No team &quot;${escapeHtml(teamId)}&quot; in this diagram</h1>
			<p>Pick a team from this diagram:</p>
			<ul class="team-sidebar">${items || '<li>No other teams.</li>'}</ul>
		</div>
	`;
}

/** Team API page for one team. Owned by the team-page worker. */
export function renderTeamView(root: HTMLElement, doc: OpenedDoc, teamId: string): void {
	let source = doc.source;
	let model = parse(source);
	const node0 = model.index[teamId];

	if (!node0 || node0.type === 'group') {
		root.innerHTML = unknownTeamHtml(doc, model, teamId);
		return;
	}

	const canEdit = doc.canEdit && typeof doc.save === 'function';
	const save = doc.save;
	let editing = false;

	function docTitle(): string {
		return model.title?.trim() || 'Untitled diagram';
	}

	function setSaveState(tone: 'ok' | 'accent' | 'error', text: string): void {
		const dot = root.querySelector<HTMLElement>('#save-dot');
		const status = root.querySelector<HTMLElement>('#save-status');
		if (dot) dot.dataset.tone = tone === 'error' ? '' : tone;
		if (status) status.textContent = text;
	}

	function paint(): void {
		const node = model.index[teamId] as Node;
		const fields = readApiBlock(source, teamId);
		const hasApiFields = Object.keys(fields).length > 0 || unmappedFields(node).length > 0;
		const showEmptyBanner = !hasApiFields && !editing;

		root.innerHTML = `
			<div class="team-page">
				${headerHtml(doc, docTitle(), node.label)}
				<div class="tm-layout">
					<main class="tm-main">
						${heroHtml(node, canEdit, editing)}
						${showEmptyBanner ? emptyBannerHtml(teamId, canEdit) : ''}
						${
							editing
								? `<form id="api-form" novalidate>
							<div id="api-body">${sectionsHtml(node, fields, editing)}</div>
							${stickyBarHtml()}
						</form>`
								: `<div id="api-body">${sectionsHtml(node, fields, editing)}</div>`
						}
						${interactionsHtml(model, doc, teamId)}
					</main>
					${asideHtml(model, doc, teamId, node.label)}
				</div>
			</div>
		`;

		const diagramEl = root.querySelector<HTMLElement>('#team-diagram');
		if (diagramEl) {
			const theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
			diagramEl.innerHTML = renderDiagram(model, { theme });
			const highlight = diagramEl.querySelector(`[data-id="${CSS.escape(teamId)}"]`);
			if (highlight) highlight.classList.add('tt-team-highlight');
		}

		const page = root.querySelector<HTMLElement>('.team-page')!;
		const form = root.querySelector<HTMLFormElement>('#api-form');

		page.addEventListener('click', (e) => {
			const target = (e.target as Element | null)?.closest<HTMLElement>('[data-action]');
			if (!target) return;
			const action = target.dataset.action;
			if (action === 'enter-edit') {
				editing = true;
				paint();
			} else if (action === 'cancel-edit') {
				editing = false;
				paint();
			} else if (action === 'copy-markdown') {
				void copyMarkdown(teamApi(model, teamId), target as HTMLButtonElement);
			}
		});

		page.addEventListener('keydown', (e) => {
			if (e.key === 'Escape' && editing) {
				e.preventDefault();
				editing = false;
				paint();
			}
		});

		if (canEdit && save && form) {
			form.addEventListener('submit', (ev) => {
				ev.preventDefault();
				void handleSave(form);
			});
		}

		async function handleSave(f: HTMLFormElement): Promise<void> {
			if (!save) return;
			const fieldValues: Record<string, string> = {};
			for (const spec of TEAM_API_FIELDS) {
				const input = f.elements.namedItem(spec.key);
				fieldValues[spec.key] = input instanceof HTMLInputElement ? input.value : '';
			}
			setSaveState('accent', 'Saving…');
			try {
				const newSource = writeApiBlock(source, teamId, fieldValues);
				await save(newSource);
				source = newSource;
				model = parse(source);
				editing = false;
				setSaveState('ok', 'Saved · encrypted');
				paint();
			} catch (err) {
				setSaveState('error', err instanceof Error ? err.message : String(err));
			}
		}
	}

	paint();
}

async function copyMarkdown(markdown: string, btn: HTMLButtonElement): Promise<void> {
	try {
		if (!navigator.clipboard?.writeText) throw new Error('no clipboard api');
		await navigator.clipboard.writeText(markdown);
	} catch {
		const textarea = document.createElement('textarea');
		textarea.value = markdown;
		textarea.style.position = 'fixed';
		textarea.style.opacity = '0';
		document.body.appendChild(textarea);
		textarea.focus();
		textarea.select();
		try {
			document.execCommand('copy');
		} catch {
			// nothing more we can do; the text is at least selected for manual copy
		}
		document.body.removeChild(textarea);
	}
	const original = btn.textContent ?? 'Copy Markdown';
	btn.textContent = 'Copied';
	setTimeout(() => {
		btn.textContent = original;
	}, COPY_FEEDBACK_MS);
}
