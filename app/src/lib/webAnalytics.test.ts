import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountWebAnalytics, webAnalyticsToken } from './webAnalytics';

afterEach(() => {
	document.head.querySelectorAll('script[data-cf-beacon]').forEach((el) => el.remove());
	vi.unstubAllEnvs();
});

describe('webAnalyticsToken', () => {
	it('returns undefined when the build variable is unset or blank', () => {
		vi.stubEnv('VITE_CF_WEB_ANALYTICS_TOKEN', '');
		expect(webAnalyticsToken()).toBeUndefined();
		vi.stubEnv('VITE_CF_WEB_ANALYTICS_TOKEN', '   ');
		expect(webAnalyticsToken()).toBeUndefined();
	});

	it('returns the trimmed token when set', () => {
		vi.stubEnv('VITE_CF_WEB_ANALYTICS_TOKEN', ' abc123 ');
		expect(webAnalyticsToken()).toBe('abc123');
	});
});

describe('mountWebAnalytics', () => {
	it('does nothing without a token', () => {
		expect(mountWebAnalytics(undefined)).toBe(false);
		expect(document.head.querySelector('script[data-cf-beacon]')).toBeNull();
	});

	it('appends a deferred beacon script with the token and SPA tracking off', () => {
		expect(mountWebAnalytics('abc123')).toBe(true);
		const script = document.head.querySelector<HTMLScriptElement>('script[data-cf-beacon]');
		expect(script).not.toBeNull();
		expect(script?.src).toBe('https://static.cloudflareinsights.com/beacon.min.js');
		expect(script?.defer).toBe(true);
		expect(JSON.parse(script?.getAttribute('data-cf-beacon') ?? '{}')).toEqual({
			token: 'abc123',
			spa: false
		});
	});

	it('mounts only once', () => {
		expect(mountWebAnalytics('abc123')).toBe(true);
		expect(mountWebAnalytics('abc123')).toBe(false);
		expect(document.head.querySelectorAll('script[data-cf-beacon]')).toHaveLength(1);
	});
});
