/**
 * Link building and fragment parsing. Links are origin-relative paths; the fragment
 * carries the key (`#s=` secret for edit, `#k=` view key) and never reaches the server.
 */

export interface Fragment {
	secret?: string;
	viewKey?: string;
}

/** Accepts `#s=…`, `#k=…`, with or without the leading `#`, and tolerates `&`-joined params. */
export function parseFragment(hash: string): Fragment {
	const raw = hash.startsWith('#') ? hash.slice(1) : hash;
	const out: Fragment = {};
	for (const part of raw.split('&')) {
		const eq = part.indexOf('=');
		if (eq < 0) continue;
		const key = part.slice(0, eq);
		const value = part.slice(eq + 1);
		if (!value) continue;
		if (key === 's') out.secret = value;
		else if (key === 'k') out.viewKey = value;
	}
	return out;
}

function seg(s: string): string {
	return encodeURIComponent(s);
}

export function docPath(id: string): string {
	return `/d/${seg(id)}`;
}

export function editLink(id: string, secret: string): string {
	return `${docPath(id)}#s=${secret}`;
}

export function viewLink(id: string, viewKey: string): string {
	return `${docPath(id)}#k=${viewKey}`;
}

export function teamLink(id: string, teamId: string, fragment: string): string {
	return `${docPath(id)}/team/${seg(teamId)}${fragment}`;
}

export function versionLink(id: string, vid: string, fragment: string): string {
	return `${docPath(id)}/v/${seg(vid)}${fragment}`;
}
