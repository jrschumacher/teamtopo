export type Route =
	| { name: 'home'; params: Record<string, never> }
	| { name: 'new'; params: Record<string, never> }
	| { name: 'privacy'; params: Record<string, never> }
	| { name: 'terms'; params: Record<string, never> }
	| { name: 'doc'; params: { id: string } }
	| { name: 'version'; params: { id: string; vid: string } }
	| { name: 'team'; params: { id: string; teamId: string } };

const SEG = '([^/]+)';
const TABLE: { name: Route['name']; re: RegExp; keys: string[] }[] = [
	{ name: 'home', re: /^\/$/, keys: [] },
	{ name: 'new', re: /^\/new$/, keys: [] },
	{ name: 'privacy', re: /^\/privacy$/, keys: [] },
	{ name: 'terms', re: /^\/terms$/, keys: [] },
	{ name: 'doc', re: new RegExp(`^/d/${SEG}$`), keys: ['id'] },
	{ name: 'version', re: new RegExp(`^/d/${SEG}/v/${SEG}$`), keys: ['id', 'vid'] },
	{ name: 'team', re: new RegExp(`^/d/${SEG}/team/${SEG}$`), keys: ['id', 'teamId'] }
];

export function matchRoute(pathname: string): Route | null {
	const path = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
	for (const { name, re, keys } of TABLE) {
		const m = re.exec(path);
		if (!m) continue;
		const params: Record<string, string> = {};
		keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
		return { name, params } as Route;
	}
	return null;
}

export type Render = (route: Route | null, root: HTMLElement) => void;

/** A fragment that carries a document key (`#s=` / `#k=`) rather than naming an in-page anchor. */
export function isKeyFragment(hash: string): boolean {
	return /^#[sk]=/.test(hash);
}

/** Scroll the element an in-page anchor names into view. No-op for an empty hash, a key
 * fragment, or a target that is not (yet) in the document. */
function scrollToAnchor(hash: string): void {
	if (!hash || isKeyFragment(hash)) return;
	const el = document.getElementById(decodeURIComponent(hash.slice(1)));
	if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView();
}

/**
 * Start a history-API router; returns a function that stops it. In-app link clicks keep
 * the current fragment (`#s=` / `#k=` carry the keys and must survive navigation) unless
 * the link sets its own. A link that only changes the fragment of the current page
 * (`#features`, or `/#features` while on `/`) is an in-page anchor: it moves the hash and
 * scrolls, and never re-renders the view.
 */
export function startRouter(root: HTMLElement, render: Render): () => void {
	// Path + query of the view currently rendered. A popstate that lands on the same value
	// (back/forward between in-page anchors) keeps the view; the browser restores scroll.
	let current = '';

	const go = () => {
		current = location.pathname + location.search;
		render(matchRoute(location.pathname), root);
		scrollToAnchor(location.hash);
	};

	const onClick = (ev: MouseEvent) => {
		if (
			ev.defaultPrevented ||
			ev.button !== 0 ||
			ev.metaKey ||
			ev.ctrlKey ||
			ev.shiftKey ||
			ev.altKey
		)
			return;
		const a = (ev.target as Element | null)?.closest('a');
		if (!a || a.target || a.hasAttribute('download')) return;
		const url = new URL(a.href, location.href);
		if (url.origin !== location.origin) return;
		ev.preventDefault();

		const samePage = url.pathname === location.pathname && url.search === location.search;
		if (samePage && url.hash && !isKeyFragment(url.hash)) {
			if (url.hash !== location.hash) history.pushState(null, '', url.hash);
			scrollToAnchor(url.hash);
			return;
		}
		if (samePage && !url.hash && !isKeyFragment(location.hash)) {
			// Same page, no anchor (the brand link while on `/#features`): drop the hash and go
			// back to the top without re-rendering.
			if (location.hash) history.pushState(null, '', url.pathname + url.search);
			window.scrollTo(0, 0);
			return;
		}
		navigate(url.pathname + url.search + (url.hash || location.hash));
	};

	const onPopState = () => {
		if (location.pathname + location.search === current && !isKeyFragment(location.hash)) return;
		go();
	};

	document.addEventListener('click', onClick);
	window.addEventListener('popstate', onPopState);
	go();
	return () => {
		document.removeEventListener('click', onClick);
		window.removeEventListener('popstate', onPopState);
	};
}

export function navigate(to: string): void {
	history.pushState(null, '', to);
	dispatchEvent(new PopStateEvent('popstate'));
}
