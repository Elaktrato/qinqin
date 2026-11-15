import adapter from '@sveltejs/adapter-static';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		// The built-in plugin manifests are the server's embedded JSON files:
		// one copy of the contract, read by Go and by this build.
		alias: { $builtin: '../../server/internal/plugins/builtin' },
		// SPA: one index.html plus hashed assets. The Go binary serves the
		// files and falls back to index.html for client-side routes.
		adapter: adapter({
			pages: 'build',
			assets: 'build',
			fallback: 'index.html',
			strict: false
		})
	}
};

export default config;
