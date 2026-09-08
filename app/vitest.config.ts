import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const lib = fileURLToPath(new URL('../src/teamtopo.js', import.meta.url));

export default defineConfig({
	test: {
		projects: [
			{
				plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' } })],
				test: { name: 'worker', include: ['worker/**/*.test.ts'] }
			},
			{
				resolve: { alias: { '@lib/teamtopo': lib } },
				server: { fs: { allow: [repoRoot] } },
				test: {
					name: 'client',
					environment: 'happy-dom',
					// External <script src> (the Web Analytics beacon) is never fetched in tests;
					// treat the disabled load as success instead of logging a NotSupportedError.
					environmentOptions: {
						happyDOM: { settings: { handleDisabledFileLoadingAsSuccess: true } }
					},
					include: ['src/**/*.test.ts']
				}
			},
			{
				test: { name: 'scripts', environment: 'node', include: ['scripts/**/*.test.ts'] }
			}
		]
	}
});
