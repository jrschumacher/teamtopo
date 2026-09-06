import { describe, expect, it } from 'vitest';
import {
	CryptoError,
	decrypt,
	deriveKeys,
	encrypt,
	fromBase64url,
	importViewKey,
	newSecret,
	toBase64url
} from './crypto';

const B64URL = /^[A-Za-z0-9_-]+$/;

describe('base64url', () => {
	it('round-trips bytes without padding', () => {
		const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
		const s = toBase64url(bytes);
		expect(s).toMatch(B64URL);
		expect(s).not.toContain('=');
		expect(fromBase64url(s)).toEqual(bytes);
	});

	it('rejects non-base64url input', () => {
		expect(() => fromBase64url('a+b/c=')).toThrow(CryptoError);
	});
});

describe('newSecret / deriveKeys', () => {
	it('makes a 32-byte base64url secret', () => {
		const secret = newSecret();
		expect(secret).toMatch(B64URL);
		expect(secret).toHaveLength(43);
		expect(fromBase64url(secret)).toHaveLength(32);
	});

	it('derives a 43-char base64url writeToken and viewKey', async () => {
		const { viewKey, writeToken } = await deriveKeys(newSecret());
		expect(writeToken).toMatch(B64URL);
		expect(writeToken).toHaveLength(43);
		expect(viewKey).toMatch(B64URL);
		expect(viewKey).toHaveLength(43);
		expect(viewKey).not.toBe(writeToken);
	});

	it('is deterministic for the same secret and different for different secrets', async () => {
		const secret = newSecret();
		const a = await deriveKeys(secret);
		const b = await deriveKeys(secret);
		const c = await deriveKeys(newSecret());
		expect(a.viewKey).toBe(b.viewKey);
		expect(a.writeToken).toBe(b.writeToken);
		expect(a.viewKey).not.toBe(c.viewKey);
		expect(a.writeToken).not.toBe(c.writeToken);
	});

	it('rejects a secret of the wrong length', async () => {
		await expect(deriveKeys('short')).rejects.toBeInstanceOf(CryptoError);
	});
});

describe('encrypt / decrypt', () => {
	const source = 'teamTopology\n  stream app "Prodüct ✓"\n';

	it('round-trips through the payload JSON format', async () => {
		const { encKey } = await deriveKeys(newSecret());
		const payload = await encrypt(encKey, source);
		const parsed = JSON.parse(payload) as { v: number; iv: string; ct: string };
		expect(parsed.v).toBe(1);
		expect(fromBase64url(parsed.iv)).toHaveLength(12);
		expect(parsed.ct).toMatch(B64URL);
		expect(await decrypt(encKey, payload)).toBe(source);
	});

	it('uses a fresh iv per encryption', async () => {
		const { encKey } = await deriveKeys(newSecret());
		const a = JSON.parse(await encrypt(encKey, source)) as { iv: string };
		const b = JSON.parse(await encrypt(encKey, source)) as { iv: string };
		expect(a.iv).not.toBe(b.iv);
	});

	it('importViewKey decrypts what deriveKeys(secret).encKey encrypted', async () => {
		const { encKey, viewKey } = await deriveKeys(newSecret());
		const payload = await encrypt(encKey, source);
		const viewer = await importViewKey(viewKey);
		expect(await decrypt(viewer, payload)).toBe(source);
	});

	it('rejects a tampered ciphertext', async () => {
		const { encKey } = await deriveKeys(newSecret());
		const parsed = JSON.parse(await encrypt(encKey, source)) as {
			v: number;
			iv: string;
			ct: string;
		};
		const ct = fromBase64url(parsed.ct);
		ct[0] ^= 0xff;
		const tampered = JSON.stringify({ ...parsed, ct: toBase64url(ct) });
		await expect(decrypt(encKey, tampered)).rejects.toBeInstanceOf(CryptoError);
	});

	it('rejects the wrong key', async () => {
		const { encKey } = await deriveKeys(newSecret());
		const other = await deriveKeys(newSecret());
		const payload = await encrypt(encKey, source);
		await expect(decrypt(other.encKey, payload)).rejects.toBeInstanceOf(CryptoError);
	});

	it('rejects malformed payloads', async () => {
		const { encKey } = await deriveKeys(newSecret());
		await expect(decrypt(encKey, 'not json')).rejects.toBeInstanceOf(CryptoError);
		await expect(decrypt(encKey, '{"v":2,"iv":"a","ct":"b"}')).rejects.toBeInstanceOf(CryptoError);
		await expect(decrypt(encKey, '{"v":1}')).rejects.toBeInstanceOf(CryptoError);
	});
});
