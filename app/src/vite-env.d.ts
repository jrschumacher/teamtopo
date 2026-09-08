/// <reference types="vite/client" />

interface ImportMetaEnv {
	/** Cloudflare Web Analytics site token, baked in at build time. Unset = no beacon.
	 * Where to set it: docs/analytics.md. */
	readonly VITE_CF_WEB_ANALYTICS_TOKEN?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
