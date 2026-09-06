import {
	parse,
	render as renderDiagram,
	teamApi,
	TEAM_API_FIELDS,
	type Model
} from '@lib/teamtopo';
import type { OpenedDoc } from '../lib/types';
import { escapeHtml, renderMarkdown } from '../lib/markdown';
import { readApiBlock, writeApiBlock } from '../lib/apiblock';

/** Human labels for the TEAM_API_FIELDS form inputs. */
const FIELD_LABELS: Record<string, string> = {
	focus: 'Focus',
	platform: 'Part of a platform',
	service: 'Service we provide',
	sle: 'Service Level Expectations',
	software: 'Software owned',
	versioning: 'Versioning approach',
	wiki: 'Wiki search terms',
	chat: 'Chat channels',
	sync: 'Daily sync time',
	workingon: 'Currently working on',
	waysofworking: 'Ways of working',
	improvements: 'Cross-team improvements'
};

function otherTeams(model: Model, teamId: string) {
	return model.teams.filter((t) => t.type !== 'group' && t.id !== teamId);
}

function teamLink(doc: OpenedDoc, teamId: string): string {
	return `/d/${escapeHtml(doc.id)}/team/${escapeHtml(teamId)}${doc.fragment}`;
}

function sidebarHtml(model: Model, doc: OpenedDoc, teamId: string): string {
	const items = otherTeams(model, teamId)
		.map((t) => `<li><a href="${teamLink(doc, t.id)}">${escapeHtml(t.label)}</a></li>`)
		.join('');
	return `<ul class="team-sidebar">${items || '<li>No other teams.</li>'}</ul>`;
}

function breadcrumbHtml(doc: OpenedDoc): string {
	return `<nav class="breadcrumb"><a href="/d/${escapeHtml(doc.id)}${doc.fragment}">&larr; Back to diagram</a></nav>`;
}

function formHtml(fields: Record<string, string>): string {
	const inputs = TEAM_API_FIELDS.map((f) => {
		const label = FIELD_LABELS[f.key] ?? f.key;
		const value = escapeHtml(fields[f.key] ?? '');
		return `<label class="field">${escapeHtml(label)}<input name="${f.key}" value="${value}"></label>`;
	}).join('');
	return `
		<form id="api-form">
			${inputs}
			<button type="submit">Save</button>
			<span id="save-status" role="status"></span>
		</form>
	`;
}

/** Team API page for one team. Owned by the team-page worker. */
export function renderTeamView(root: HTMLElement, doc: OpenedDoc, teamId: string): void {
	let source = doc.source;
	let model = parse(source);
	const node = model.index[teamId];

	if (!node || node.type === 'group') {
		root.innerHTML = `
			${breadcrumbHtml(doc)}
			<h1>No team &quot;${escapeHtml(teamId)}&quot; in this diagram</h1>
			<p>Pick a team from this diagram:</p>
			${sidebarHtml(model, doc, teamId)}
		`;
		return;
	}

	const canEdit = doc.canEdit && typeof doc.save === 'function';
	const save = doc.save;

	root.innerHTML = `
		${breadcrumbHtml(doc)}
		<div class="team-page">
			<main>
				<div class="diagram" id="team-diagram"></div>
				<div class="api-body" id="api-body">${renderMarkdown(teamApi(model, teamId))}</div>
				<button id="copy-api" type="button">Copy Markdown</button>
				${canEdit ? formHtml(readApiBlock(source, teamId)) : ''}
			</main>
			<aside>
				<h2>Other teams</h2>
				${sidebarHtml(model, doc, teamId)}
			</aside>
		</div>
	`;

	const diagramEl = root.querySelector<HTMLElement>('#team-diagram');
	if (diagramEl) {
		const theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
		diagramEl.innerHTML = renderDiagram(model, { theme });
		const highlight = diagramEl.querySelector(`[data-id="${CSS.escape(teamId)}"]`);
		if (highlight) highlight.classList.add('tt-team-highlight');
	}

	const copyBtn = root.querySelector<HTMLButtonElement>('#copy-api');
	copyBtn?.addEventListener('click', () => {
		void copyMarkdown(teamApi(model, teamId));
	});

	if (canEdit && save) {
		const form = root.querySelector<HTMLFormElement>('#api-form');
		form?.addEventListener('submit', (ev) => {
			ev.preventDefault();
			void handleSave();
		});

		const handleSave = async () => {
			const status = root.querySelector('#save-status');
			const fields: Record<string, string> = {};
			for (const f of TEAM_API_FIELDS) {
				const input = form?.elements.namedItem(f.key);
				fields[f.key] = input instanceof HTMLInputElement ? input.value : '';
			}
			if (status) status.textContent = 'Saving…';
			try {
				const newSource = writeApiBlock(source, teamId, fields);
				await save(newSource);
				source = newSource;
				model = parse(source);
				const apiBody = root.querySelector('#api-body');
				if (apiBody) apiBody.innerHTML = renderMarkdown(teamApi(model, teamId));
				if (status) status.textContent = 'Saved';
			} catch (err) {
				if (status)
					status.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
			}
		};
	}
}

async function copyMarkdown(markdown: string): Promise<void> {
	try {
		if (!navigator.clipboard?.writeText) throw new Error('no clipboard api');
		await navigator.clipboard.writeText(markdown);
		return;
	} catch {
		// fall back to a hidden, selected textarea
	}
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
