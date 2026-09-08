/**
 * In-memory document cache keyed by id. Holds the last `OpenedDoc` opened for that id
 * (decrypted source, version, versions list, fragment) so editor/viewer/team routes for
 * the same id can render synchronously instead of re-fetching + re-decrypting.
 *
 * A doc is cached against the fragment (the `#s=`/`#k=` key) it was opened with. A lookup
 * with a different fragment for the same id is treated as a different key on the same
 * document: the stale entry is dropped and the lookup misses.
 */

import type { OpenedDoc } from './types';

interface Entry {
	doc: OpenedDoc;
	fragment: string;
}

const store = new Map<string, Entry>();

/** Cached doc for `id`, or `undefined` on a miss. A fragment mismatch clears the entry. */
export function getCached(id: string, fragment: string): OpenedDoc | undefined {
	const entry = store.get(id);
	if (!entry) return undefined;
	if (entry.fragment !== fragment) {
		store.delete(id);
		return undefined;
	}
	return entry.doc;
}

export function setCached(doc: OpenedDoc): void {
	store.set(doc.id, { doc, fragment: doc.fragment });
}

export function isCached(id: string): boolean {
	return store.has(id);
}

export function clearCached(id: string): void {
	store.delete(id);
}

export function clearAllCached(): void {
	store.clear();
}

/**
 * Fetch the current doc in the background and compare its version id against what's
 * cached. Updates the cache and returns the fresh doc when it changed (or nothing was
 * cached yet); returns `undefined` when the version is unchanged, so the caller knows
 * not to re-render.
 */
export async function revalidate(
	id: string,
	fetchFresh: () => Promise<OpenedDoc>
): Promise<OpenedDoc | undefined> {
	const cached = store.get(id);
	const fresh = await fetchFresh();
	if (cached && cached.doc.version?.id === fresh.version?.id) {
		return undefined;
	}
	setCached(fresh);
	return fresh;
}
