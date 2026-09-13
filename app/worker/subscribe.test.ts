/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env as rawEnv, SELF } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from './index';

// `cloudflare:test`'s `env` types as `Cloudflare.Env`, which is only populated by the
// gitignored, machine-generated `worker-configuration.d.ts` (see `npm run types`). Cast to
// this project's own `Env` (worker/index.ts) so the test suite typechecks without depending
// on that generated, untracked file being present or wired into tsconfig's `include`.
const env = rawEnv as unknown as Env;

interface SubscriberRow {
	email: string;
	token: string;
	created_at: string;
	confirmed_at: string | null;
	unsubscribed_at: string | null;
}

beforeAll(async () => {
	await env.DB.exec(
		'CREATE TABLE IF NOT EXISTS subscribers (email TEXT PRIMARY KEY, token TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, confirmed_at TEXT, unsubscribed_at TEXT)'
	);
});

// `SELF` invokes the Worker with this same `env` object, so replacing `EMAIL` here is what
// worker/subscribe.ts sees. A spy stands in for the binding: no mail leaves the test run
// (vitest.config.ts also sets `remoteBindings: false` so the real binding is never wired)
// and each test can assert exactly what would have been sent.
const sendSpy = vi.fn<(message: unknown) => Promise<void>>(async () => {});

beforeEach(() => {
	sendSpy.mockClear();
	env.EMAIL = { send: sendSpy } as unknown as NonNullable<Env['EMAIL']>;
});

async function subscribe(email: unknown) {
	return SELF.fetch('https://example.com/api/subscribe', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ email })
	});
}

async function getRow(email: string): Promise<SubscriberRow | null> {
	return env.DB.prepare('SELECT * FROM subscribers WHERE email = ?')
		.bind(email)
		.first<SubscriberRow>();
}

describe('subscribe API', () => {
	it('accepts a valid signup with 202 and inserts an unconfirmed row', async () => {
		const res = await subscribe('new@example.com');
		expect(res.status).toBe(202);
		expect(await res.json()).toEqual({ ok: true });

		const row = await getRow('new@example.com');
		expect(row).not.toBeNull();
		expect(row?.confirmed_at).toBeNull();
		expect(row?.unsubscribed_at).toBeNull();
		expect(row?.token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
	});

	it('sends one confirmation mail to the signup address via the EMAIL binding', async () => {
		const email = 'mail@example.com';
		const res = await subscribe(email);
		expect(res.status).toBe(202);

		// The send runs in ctx.waitUntil, so it may land just after the response.
		await vi.waitFor(() => expect(sendSpy).toHaveBeenCalledTimes(1));
		const message = sendSpy.mock.calls[0][0] as {
			from: { email: string; name: string };
			to: string;
			subject: string;
			text: string;
		};
		expect(message.to).toBe(email);
		expect(message.subject).toBe('Confirm your teamtopo subscription');
		expect(message.from).toEqual({ email: env.EMAIL_FROM, name: 'teamtopo' });
		const row = await getRow(email);
		expect(message.text).toContain(
			`https://example.com/api/subscribe/confirm?t=${encodeURIComponent(row?.token as string)}`
		);
	});

	it('does not send mail when an already-confirmed address signs up again', async () => {
		const email = 'already@example.com';
		await subscribe(email);
		await vi.waitFor(() => expect(sendSpy).toHaveBeenCalledTimes(1));
		const token = (await getRow(email))?.token as string;
		await SELF.fetch(`https://example.com/api/subscribe/confirm?t=${encodeURIComponent(token)}`, {
			redirect: 'manual'
		});
		expect((await getRow(email))?.confirmed_at).not.toBeNull();
		sendSpy.mockClear();

		const res = await subscribe(email);
		expect(res.status).toBe(202);
		expect(await res.json()).toEqual({ ok: true });
		// Give a stray waitUntil send time to surface before asserting silence.
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(sendSpy).not.toHaveBeenCalled();
		expect((await getRow(email))?.token).toBe(token);
	});

	it('rejects an invalid email with 400', async () => {
		const res = await subscribe('not-an-email');
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: string };
		expect(body.error).toBe('bad_request');
	});

	it('gives identical 202 responses for a new address and an existing one', async () => {
		const email = 'repeat@example.com';
		const first = await subscribe(email);
		const second = await subscribe(email);
		expect(first.status).toBe(second.status);
		expect(await first.json()).toEqual(await second.json());
	});

	it('confirms a token within the 7 day window and redirects', async () => {
		const email = 'confirm@example.com';
		await subscribe(email);
		const row = await getRow(email);
		const token = row?.token as string;

		const res = await SELF.fetch(
			`https://example.com/api/subscribe/confirm?t=${encodeURIComponent(token)}`,
			{ redirect: 'manual' }
		);
		expect(res.status).toBe(303);
		expect(res.headers.get('location')).toBe('https://example.com/?subscribed=1');

		const confirmed = await getRow(email);
		expect(confirmed?.confirmed_at).not.toBeNull();
	});

	it('redirects to expired for an unknown or old token', async () => {
		const res = await SELF.fetch('https://example.com/api/subscribe/confirm?t=nonexistent', {
			redirect: 'manual'
		});
		expect(res.status).toBe(303);
		expect(res.headers.get('location')).toBe('https://example.com/?subscribe=expired');
	});

	it('redirects to expired for a token older than 7 days', async () => {
		const email = 'stale@example.com';
		await subscribe(email);
		const row = await getRow(email);
		const token = row?.token as string;
		const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
		await env.DB.prepare('UPDATE subscribers SET created_at = ? WHERE email = ?')
			.bind(eightDaysAgo, email)
			.run();

		const res = await SELF.fetch(
			`https://example.com/api/subscribe/confirm?t=${encodeURIComponent(token)}`,
			{ redirect: 'manual' }
		);
		expect(res.status).toBe(303);
		expect(res.headers.get('location')).toBe('https://example.com/?subscribe=expired');
	});

	it('unsubscribes on a known token and redirects', async () => {
		const email = 'unsub@example.com';
		await subscribe(email);
		const row = await getRow(email);
		const token = row?.token as string;

		const res = await SELF.fetch(
			`https://example.com/api/subscribe/unsubscribe?t=${encodeURIComponent(token)}`,
			{ redirect: 'manual' }
		);
		expect(res.status).toBe(303);
		expect(res.headers.get('location')).toBe('https://example.com/?unsubscribed=1');

		const unsubscribed = await getRow(email);
		expect(unsubscribed?.unsubscribed_at).not.toBeNull();
	});

	it('redirects the same for an unknown unsubscribe token (no enumeration)', async () => {
		const res = await SELF.fetch('https://example.com/api/subscribe/unsubscribe?t=nonexistent', {
			redirect: 'manual'
		});
		expect(res.status).toBe(303);
		expect(res.headers.get('location')).toBe('https://example.com/?unsubscribed=1');
	});

	it('clears unsubscribed_at and issues a new token on re-signup', async () => {
		const email = 'resub@example.com';
		await subscribe(email);
		const before = await getRow(email);
		const oldToken = before?.token as string;

		await SELF.fetch(
			`https://example.com/api/subscribe/unsubscribe?t=${encodeURIComponent(oldToken)}`,
			{ redirect: 'manual' }
		);
		const unsubscribed = await getRow(email);
		expect(unsubscribed?.unsubscribed_at).not.toBeNull();

		const res = await subscribe(email);
		expect(res.status).toBe(202);

		const after = await getRow(email);
		expect(after?.unsubscribed_at).toBeNull();
		expect(after?.token).not.toBe(oldToken);
	});
});
