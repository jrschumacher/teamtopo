/** Shared contracts between the client modules. See docs/app-intent.md. */

export interface Version {
	id: string;
	at: string; // ISO 8601
	size: number;
}

/** A document opened from a `/d/:id` link. Produced by `openDocument` in lib/doc.ts. */
export interface OpenedDoc {
	id: string;
	source: string;
	version: Version | null; // null for an unsaved `/new` document
	versions: Version[]; // newest first
	canEdit: boolean;
	/** Present only when opened with an edit link. Persists and returns the new version. */
	save?: (source: string) => Promise<Version>;
	links: { view: string; edit?: string };
	/** Fragment to append to in-app links so the key survives navigation, e.g. "#k=..." */
	fragment: string;
}
