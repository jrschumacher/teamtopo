import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderSignup } from './subscribe';

let root: HTMLElement;

function setSearch(search: string): void {
	history.pushState({}, '', `/${search}`);
}

function stubFetch(response: {
	ok: boolean;
	status?: number;
	body?: unknown;
}): ReturnType<typeof vi.fn> {
	const fetchMock = vi.fn(() =>
		Promise.resolve({
			ok: response.ok,
			status: response.status ?? (response.ok ? 202 : 400),
			json: () => Promise.resolve(response.body ?? {})
		})
	);
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

beforeEach(() => {
	setSearch('');
	root = document.createElement('div');
	document.body.appendChild(root);
});

afterEach(() => {
	vi.unstubAllGlobals();
	root.remove();
});

describe('renderSignup', () => {
	it('shows the idle form with the privacy note', () => {
		renderSignup(root);
		expect(root.querySelector('#signup-email')).not.toBeNull();
		expect(root.querySelector('#signup-submit')).not.toBeNull();
		expect(root.textContent).toContain(
			'Only used to announce new features. Double opt-in, one-click unsubscribe, never linked to your diagrams.'
		);
	});

	it('shows a sending state while the request is in flight, then check-your-inbox on success', async () => {
		let resolveFetch!: (v: { ok: boolean; status: number; json: () => Promise<unknown> }) => void;
		vi.stubGlobal(
			'fetch',
			vi.fn(
				() =>
					new Promise((resolve) => {
						resolveFetch = resolve;
					})
			)
		);
		renderSignup(root);
		const input = root.querySelector<HTMLInputElement>('#signup-email')!;
		input.value = 'me@example.com';
		root
			.querySelector<HTMLFormElement>('#signup-form')!
			.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
		await Promise.resolve();

		expect(root.querySelector<HTMLButtonElement>('#signup-submit')!.disabled).toBe(true);
		expect(root.textContent?.toLowerCase()).toContain('sending');

		resolveFetch({ ok: true, status: 202, json: () => Promise.resolve({ ok: true }) });
		await vi.waitFor(() => expect(root.textContent).toContain('inbox'));
	});

	it('shows an error state when the request fails', async () => {
		stubFetch({ ok: false, status: 400 });
		renderSignup(root);
		const input = root.querySelector<HTMLInputElement>('#signup-email')!;
		input.value = 'bad';
		root
			.querySelector<HTMLFormElement>('#signup-form')!
			.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

		await vi.waitFor(() =>
			expect(root.textContent?.toLowerCase()).toMatch(/wrong|error|try again/)
		);
		expect(root.querySelector<HTMLButtonElement>('#signup-submit')!.disabled).toBe(false);
	});

	it('shows the subscribed message instead of the form when location.search has subscribed=1', () => {
		setSearch('?subscribed=1');
		renderSignup(root);
		expect(root.querySelector('#signup-form')).toBeNull();
		expect(root.textContent?.toLowerCase()).toContain('subscribed');
	});

	it('shows the unsubscribed message instead of the form when location.search has unsubscribed=1', () => {
		setSearch('?unsubscribed=1');
		renderSignup(root);
		expect(root.querySelector('#signup-form')).toBeNull();
		expect(root.textContent?.toLowerCase()).toContain('unsubscribed');
	});

	it('shows the expired message instead of the form when location.search has subscribe=expired', () => {
		setSearch('?subscribe=expired');
		renderSignup(root);
		expect(root.querySelector('#signup-form')).toBeNull();
		expect(root.textContent?.toLowerCase()).toContain('expired');
	});
});
