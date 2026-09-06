import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { cloudflare } from '@cloudflare/vite-plugin';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const lib = fileURLToPath(new URL('../src/teamtopo.js', import.meta.url));

export default defineConfig({
	plugins: [cloudflare()],
	resolve: { alias: { '@lib/teamtopo': lib } },
	server: { fs: { allow: [repoRoot] } }
});
