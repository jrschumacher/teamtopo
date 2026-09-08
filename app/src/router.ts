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

/**
 * Start a history-API router. In-app link clicks keep the current fragment
 * (`#s=` / `#k=` carry the keys and must survive navigation) unless the link sets its own.
 */
export function startRouter(root: HTMLElement, render: Render): void {
	const go = () => render(matchRoute(location.pathname), root);

	document.addEventListener('click', (ev) => {
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
		navigate(url.pathname + url.search + (url.hash || location.hash));
	});

	window.addEventListener('popstate', go);
	go();
}

export function navigate(to: string): void {
	history.pushState(null, '', to);
	dispatchEvent(new PopStateEvent('popstate'));
}
