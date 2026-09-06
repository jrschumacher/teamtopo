/** Email signup widget (double opt-in). Owned by the subscribe worker. */

const PRIVACY_NOTE =
	'Only used to announce new features. Double opt-in, one-click unsubscribe, never linked to your diagrams.';

function escapeHtml(value: string): string {
	return value.replace(
		/[&<>"']/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string
	);
}

function renderMessage(root: HTMLElement, text: string): void {
	root.innerHTML = `<p class="signup-status">${escapeHtml(text)}</p>`;
}

export function renderSignup(root: HTMLElement): void {
	const params = new URLSearchParams(location.search);

	if (params.get('subscribed') === '1') {
		renderMessage(root, "You're subscribed. Thanks for joining!");
		return;
	}
	if (params.get('unsubscribed') === '1') {
		renderMessage(root, "You've been unsubscribed.");
		return;
	}
	if (params.get('subscribe') === 'expired') {
		renderMessage(root, 'That confirmation link expired. Please sign up again.');
		return;
	}

	root.innerHTML = `
		<form id="signup-form">
			<input id="signup-email" type="email" name="email" placeholder="you@example.com" required />
			<button type="submit" id="signup-submit">Notify me</button>
			<p class="signup-privacy">${escapeHtml(PRIVACY_NOTE)}</p>
			<p class="signup-message" id="signup-message" hidden></p>
		</form>
	`;

	const form = root.querySelector<HTMLFormElement>('#signup-form');
	const input = root.querySelector<HTMLInputElement>('#signup-email');
	const button = root.querySelector<HTMLButtonElement>('#signup-submit');
	const messageEl = root.querySelector<HTMLElement>('#signup-message');
	if (!form || !input || !button || !messageEl) return;

	const setMessage = (state: 'sending' | 'success' | 'error', text: string): void => {
		messageEl.hidden = false;
		messageEl.textContent = text;
		messageEl.className = `signup-message signup-message--${state}`;
	};

	async function submit(): Promise<void> {
		if (!input || !button) return;
		button.disabled = true;
		input.disabled = true;
		setMessage('sending', 'Sending…');

		try {
			const res = await fetch('/api/subscribe', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email: input.value })
			});
			if (!res.ok) throw new Error(`subscribe failed with ${res.status}`);
			if (form) form.hidden = true;
			setMessage('success', 'Check your inbox to confirm your subscription.');
		} catch {
			setMessage('error', 'Something went wrong. Please try again.');
			button.disabled = false;
			input.disabled = false;
		}
	}

	form.addEventListener('submit', (ev) => {
		ev.preventDefault();
		void submit();
	});
}
