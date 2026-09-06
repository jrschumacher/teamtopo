/**
 * Open, create and save encrypted documents. Glues links → crypto → api into the
 * `OpenedDoc` contract in ./types.ts that the views consume.
 */

import { createDoc, getDoc, getVersion, saveDoc } from './api';
import { CryptoError, decrypt, deriveKeys, encrypt, importViewKey, newSecret } from './crypto';
import { editLink, parseFragment, viewLink } from './links';
import type { OpenedDoc, Version } from './types';

export type LinkErrorCode = 'missing_key' | 'bad_key';

/** The link lacks a key, or the key does not open this document. */
export class LinkError extends Error {
	code: LinkErrorCode;

	constructor(code: LinkErrorCode, message: string) {
		super(message);
		this.name = 'LinkError';
		this.code = code;
	}
}

interface Opener {
	key: CryptoKey;
	fragment: string;
	secret?: string;
	viewKey: string;
	writeToken?: string;
}

async function openKeys(hash: string): Promise<Opener> {
	const { secret, viewKey } = parseFragment(hash);
	try {
		if (secret) {
			const keys = await deriveKeys(secret);
			return {
				key: keys.encKey,
				fragment: `#s=${secret}`,
				secret,
				viewKey: keys.viewKey,
				writeToken: keys.writeToken
			};
		}
		if (viewKey) {
			return { key: await importViewKey(viewKey), fragment: `#k=${viewKey}`, viewKey };
		}
	} catch (err) {
		if (err instanceof CryptoError)
			throw new LinkError('bad_key', 'This link has a malformed key.');
		throw err;
	}
	throw new LinkError(
		'missing_key',
		'This link is missing its key. Ask for the full link, including the part after "#".'
	);
}

async function decryptOrLinkError(key: CryptoKey, payload: string): Promise<string> {
	try {
		return await decrypt(key, payload);
	} catch (err) {
		if (err instanceof CryptoError) {
			throw new LinkError('bad_key', 'The key in this link does not open this document.');
		}
		throw err;
	}
}

function buildDoc(
	id: string,
	source: string,
	version: Version | null,
	versions: Version[],
	opener: Opener
): OpenedDoc {
	const links: OpenedDoc['links'] = { view: viewLink(id, opener.viewKey) };
	if (opener.secret) links.edit = editLink(id, opener.secret);
	return {
		id,
		source,
		version,
		versions,
		canEdit: Boolean(opener.writeToken),
		links,
		fragment: opener.fragment
	};
}

/**
 * Attach `save`. The base for the PUT is `doc.version.id` at call time, so a UI that
 * wants to "save anyway" after a 409 sets `doc.version = err.latest` and calls again.
 */
function attachSave(doc: OpenedDoc, key: CryptoKey, writeToken: string): OpenedDoc {
	doc.save = async (source: string): Promise<Version> => {
		const payload = await encrypt(key, source);
		const base = doc.version?.id ?? '';
		const { version } = await saveDoc(doc.id, payload, base, writeToken);
		doc.source = source;
		doc.version = version;
		doc.versions = [version, ...doc.versions.filter((v) => v.id !== version.id)];
		return version;
	};
	return doc;
}

export async function openDocument(id: string, hash: string): Promise<OpenedDoc> {
	const opener = await openKeys(hash);
	const res = await getDoc(id);
	const source = await decryptOrLinkError(opener.key, res.payload);
	const doc = buildDoc(id, source, res.version, res.versions, opener);
	return opener.writeToken ? attachSave(doc, opener.key, opener.writeToken) : doc;
}

/** Read-only view of one version. `canEdit` reflects the link; there is no `save`. */
export async function openVersion(id: string, vid: string, hash: string): Promise<OpenedDoc> {
	const opener = await openKeys(hash);
	const [res, latest] = await Promise.all([getVersion(id, vid), getDoc(id)]);
	const source = await decryptOrLinkError(opener.key, res.payload);
	return buildDoc(id, source, res.version, latest.versions, opener);
}

export interface CreatedDoc {
	id: string;
	secret: string;
	editLink: string;
	/** The document as if just opened with the edit link, so the UI need not refetch. */
	doc: OpenedDoc;
}

export async function createDocument(source: string): Promise<CreatedDoc> {
	const secret = newSecret();
	const keys = await deriveKeys(secret);
	const payload = await encrypt(keys.encKey, source);
	const { id, version } = await createDoc(payload, keys.writeToken);
	const opener: Opener = {
		key: keys.encKey,
		fragment: `#s=${secret}`,
		secret,
		viewKey: keys.viewKey,
		writeToken: keys.writeToken
	};
	const doc = attachSave(
		buildDoc(id, source, version, [version], opener),
		keys.encKey,
		keys.writeToken
	);
	return { id, secret, editLink: editLink(id, secret), doc };
}
