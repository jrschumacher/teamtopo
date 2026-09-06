import type { Env } from './index';
import { error, json, redirect } from './http';

const MAX_EMAIL_LENGTH = 254;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONFIRM_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

type Result<T> = { ok: true; value: T } | { ok: false; reason: string };

interface SubscriberRow {
	email: string;
	token: string;
	created_at: string;
	confirmed_at: string | null;
	unsubscribed_at: string | null;
}

function validateEmail(value: unknown): Result<string> {
	if (typeof value !== 'string') return { ok: false, reason: 'email must be a string' };
	const normalized = value.trim().toLowerCase();
	if (normalized.length === 0) return { ok: false, reason: 'email is required' };
	if (normalized.length > MAX_EMAIL_LENGTH) {
		return { ok: false, reason: 'email exceeds 254 characters' };
	}
	if (!EMAIL_RE.test(normalized)) return { ok: false, reason: 'email is not a valid address' };
	return { ok: true, value: normalized };
}

async function parseJsonBody(request: Request): Promise<Result<Record<string, unknown>>> {
	try {
		const value = await request.json();
		if (typeof value !== 'object' || value === null) {
			return { ok: false, reason: 'body must be a JSON object' };
		}
		return { ok: true, value: value as Record<string, unknown> };
	} catch {
		return { ok: false, reason: 'malformed JSON' };
	}
}

function base64url(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function newToken(): string {
	return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

function confirmLink(url: URL, token: string): string {
	return `${url.origin}/api/subscribe/confirm?t=${encodeURIComponent(token)}`;
}

function unsubscribeLink(url: URL, token: string): string {
	return `${url.origin}/api/subscribe/unsubscribe?t=${encodeURIComponent(token)}`;
}

/** Sends plain-text mail via the EMAIL binding; logs the content when the binding is absent
 * (local dev / tests). */
async function sendMail(
	env: Env,
	message: { to: string; subject: string; text: string }
): Promise<void> {
	if (!env.EMAIL) {
		console.log(`[subscribe] ${message.to}: ${message.text}`);
		return;
	}
	await env.EMAIL.send({
		from: { email: env.EMAIL_FROM, name: 'TeamTopo' },
		to: message.to,
		subject: message.subject,
		text: message.text
	});
}

async function sendConfirmationMail(env: Env, url: URL, email: string, token: string) {
	const text = [
		'Confirm your subscription to TeamTopo updates:',
		confirmLink(url, token),
		'',
		'If you did not request this, ignore it.',
		'',
		`Unsubscribe: ${unsubscribeLink(url, token)}`
	].join('\n');
	await sendMail(env, { to: email, subject: 'Confirm your TeamTopo subscription', text });
}

async function handleSignup(
	request: Request,
	env: Env,
	ctx: ExecutionContext,
	url: URL
): Promise<Response> {
	const ip = request.headers.get('CF-Connecting-IP') ?? 'anon';
	const outcome = await env.WRITE_LIMIT.limit({ key: ip });
	if (!outcome.success) return error('rate_limited', 'too many requests, try again later', 429);

	const bodyResult = await parseJsonBody(request);
	if (!bodyResult.ok) return error('bad_request', bodyResult.reason, 400);

	const emailResult = validateEmail(bodyResult.value.email);
	if (!emailResult.ok) return error('bad_request', emailResult.reason, 400);
	const email = emailResult.value;

	const existing = await env.DB.prepare(
		'SELECT confirmed_at, unsubscribed_at FROM subscribers WHERE email = ?'
	)
		.bind(email)
		.first<Pick<SubscriberRow, 'confirmed_at' | 'unsubscribed_at'>>();

	const activelyConfirmed =
		existing !== null && existing.confirmed_at !== null && existing.unsubscribed_at === null;

	if (!activelyConfirmed) {
		const token = newToken();
		const now = new Date().toISOString();
		if (existing) {
			await env.DB.prepare(
				'UPDATE subscribers SET token = ?, created_at = ?, unsubscribed_at = NULL WHERE email = ?'
			)
				.bind(token, now, email)
				.run();
		} else {
			await env.DB.prepare('INSERT INTO subscribers (email, token, created_at) VALUES (?, ?, ?)')
				.bind(email, token, now)
				.run();
		}
		ctx.waitUntil(sendConfirmationMail(env, url, email, token));
	}

	return json({ ok: true }, 202);
}

async function handleConfirm(env: Env, url: URL): Promise<Response> {
	const token = url.searchParams.get('t');
	const expired = redirect(`${url.origin}/?subscribe=expired`);
	if (!token) return expired;

	const row = await env.DB.prepare('SELECT created_at FROM subscribers WHERE token = ?')
		.bind(token)
		.first<Pick<SubscriberRow, 'created_at'>>();
	if (!row) return expired;

	const createdAt = new Date(row.created_at).getTime();
	if (Number.isNaN(createdAt) || Date.now() - createdAt > CONFIRM_WINDOW_MS) return expired;

	await env.DB.prepare('UPDATE subscribers SET confirmed_at = ? WHERE token = ?')
		.bind(new Date().toISOString(), token)
		.run();
	return redirect(`${url.origin}/?subscribed=1`);
}

async function handleUnsubscribe(env: Env, url: URL): Promise<Response> {
	const token = url.searchParams.get('t');
	if (token) {
		await env.DB.prepare('UPDATE subscribers SET unsubscribed_at = ? WHERE token = ?')
			.bind(new Date().toISOString(), token)
			.run();
	}
	return redirect(`${url.origin}/?unsubscribed=1`);
}

export async function handleSubscribe(
	request: Request,
	env: Env,
	ctx: ExecutionContext,
	url: URL
): Promise<Response> {
	const segments = url.pathname.split('/').filter(Boolean).slice(2);

	if (segments.length === 0) {
		if (request.method !== 'POST') return error('method_not_allowed', 'method not allowed', 405);
		return handleSignup(request, env, ctx, url);
	}

	if (segments.length === 1 && segments[0] === 'confirm') {
		if (request.method !== 'GET') return error('method_not_allowed', 'method not allowed', 405);
		return handleConfirm(env, url);
	}

	if (segments.length === 1 && segments[0] === 'unsubscribe') {
		if (request.method !== 'GET') return error('method_not_allowed', 'method not allowed', 405);
		return handleUnsubscribe(env, url);
	}

	return error('not_found', 'no such route', 404);
}
