/**
 * Client-side crypto per docs/app-intent.md "Crypto".
 *
 * secret (32 random bytes, base64url) lives only in the edit link. From it:
 *   encKey     = HKDF-SHA256(secret, salt "teamtopo", info "enc")   -> AES-256-GCM
 *   writeToken = HKDF-SHA256(secret, salt "teamtopo", info "write") -> 32 bytes, base64url
 * The raw encKey is the view link's `#k=`.
 */

const SALT = 'teamtopo';
const INFO_ENC = 'enc';
const INFO_WRITE = 'write';
const PAYLOAD_VERSION = 1;

const subtle = globalThis.crypto.subtle;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class CryptoError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'CryptoError';
	}
}

export interface Payload {
	v: number;
	iv: string;
	ct: string;
}

export function toBase64url(bytes: Uint8Array): string {
	let bin = '';
	for (const b of bytes) bin += String.fromCharCode(b);
	return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64url(s: string): Uint8Array<ArrayBuffer> {
	if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new CryptoError('invalid base64url');
	const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
	let bin: string;
	try {
		bin = atob(padded);
	} catch {
		throw new CryptoError('invalid base64url');
	}
	const out = new Uint8Array(new ArrayBuffer(bin.length));
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

export function newSecret(): string {
	return toBase64url(globalThis.crypto.getRandomValues(new Uint8Array(32)));
}

function hkdfParams(info: string): HkdfParams {
	return { name: 'HKDF', hash: 'SHA-256', salt: encoder.encode(SALT), info: encoder.encode(info) };
}

export async function deriveKeys(
	secret: string
): Promise<{ encKey: CryptoKey; viewKey: string; writeToken: string }> {
	const raw = fromBase64url(secret);
	if (raw.length !== 32) throw new CryptoError('secret must be 32 bytes');
	const base = await subtle.importKey('raw', raw, 'HKDF', false, ['deriveKey', 'deriveBits']);
	const encKey = await subtle.deriveKey(
		hkdfParams(INFO_ENC),
		base,
		{ name: 'AES-GCM', length: 256 },
		true,
		['encrypt', 'decrypt']
	);
	const viewKey = toBase64url(new Uint8Array(await subtle.exportKey('raw', encKey)));
	const writeToken = toBase64url(
		new Uint8Array(await subtle.deriveBits(hkdfParams(INFO_WRITE), base, 256))
	);
	return { encKey, viewKey, writeToken };
}

export async function importViewKey(viewKey: string): Promise<CryptoKey> {
	const raw = fromBase64url(viewKey);
	if (raw.length !== 32) throw new CryptoError('view key must be 32 bytes');
	return subtle.importKey('raw', raw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
}

export async function encrypt(key: CryptoKey, source: string): Promise<string> {
	const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
	const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(source));
	const payload: Payload = {
		v: PAYLOAD_VERSION,
		iv: toBase64url(iv),
		ct: toBase64url(new Uint8Array(ct))
	};
	return JSON.stringify(payload);
}

function parsePayload(payload: string): Payload {
	let parsed: unknown;
	try {
		parsed = JSON.parse(payload);
	} catch {
		throw new CryptoError('payload is not JSON');
	}
	if (typeof parsed !== 'object' || parsed === null)
		throw new CryptoError('payload is not an object');
	const p = parsed as Record<string, unknown>;
	if (p.v !== PAYLOAD_VERSION) throw new CryptoError(`unsupported payload version ${String(p.v)}`);
	if (typeof p.iv !== 'string' || typeof p.ct !== 'string') {
		throw new CryptoError('payload is missing iv or ct');
	}
	return { v: PAYLOAD_VERSION, iv: p.iv, ct: p.ct };
}

export async function decrypt(key: CryptoKey, payload: string): Promise<string> {
	const p = parsePayload(payload);
	const iv = fromBase64url(p.iv);
	if (iv.length !== 12) throw new CryptoError('iv must be 12 bytes');
	try {
		const pt = await subtle.decrypt({ name: 'AES-GCM', iv }, key, fromBase64url(p.ct));
		return decoder.decode(pt);
	} catch {
		throw new CryptoError('decryption failed: wrong key or tampered payload');
	}
}
