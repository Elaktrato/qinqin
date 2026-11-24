import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, searchForWorkspaceRoot } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	server: {
		fs: { allow: [searchForWorkspaceRoot('.')] },
		// The Go API on :8080 is the development backend.
		proxy: {
			'/api': 'http://127.0.0.1:8080',
			// Stroke data is a package the server serves (item 5), not a static file.
			'/hanzi': 'http://127.0.0.1:8080',
			// Font pack slices (#97) are served by the server from <data>/fonts.
			'/fonts/': 'http://127.0.0.1:8080'
		}
	},
	build: {
		rollupOptions: {
			output: {
				// ASCII-only, hash-only asset names: go:embed rejects some
				// non-Latin file names, so no asset name may carry source text.
				assetFileNames: 'assets/[hash][extname]'
			}
		}
	}
});
