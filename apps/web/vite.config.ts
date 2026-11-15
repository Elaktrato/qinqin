import { sveltekit } from '@sveltejs/kit/vite';
import { searchForWorkspaceRoot } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [sveltekit()],
	server: {
		// The dev server may read the server's built-in manifests ($builtin).
		fs: { allow: [searchForWorkspaceRoot('.'), '../../server/internal/plugins/builtin'] },
		// The Go API on :8080 is the development backend.
		proxy: {
			'/api': 'http://127.0.0.1:8080'
		}
	},
	build: {
		rollupOptions: {
			output: {
				// ASCII-only asset names: the stroke-order data ships a file per
				// character (including non-Latin names like ⺀.json), and go:embed
				// rejects such names — hash-only names keep the Go embed working.
				assetFileNames: 'assets/[hash][extname]'
			}
		}
	},
	test: {
		include: ['src/**/*.test.ts']
	}
});
