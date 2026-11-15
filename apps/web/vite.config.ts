import { sveltekit } from '@sveltejs/kit/vite';
import { searchForWorkspaceRoot } from 'vite';
import { svelteTesting } from '@testing-library/svelte/vite';
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
		// Two projects: the pure-logic tests run in plain node, untouched;
		// component tests (`*.dom.test.ts`) get jsdom plus the browser resolve
		// condition and auto-cleanup from svelteTesting (which would break the
		// node tests if applied globally: esm-env's BROWSER flips to true).
		projects: [
			{
				extends: true,
				test: {
					name: 'unit',
					include: ['src/**/*.test.ts'],
					exclude: ['src/**/*.dom.test.ts', '**/node_modules/**']
				}
			},
			{
				extends: true,
				plugins: [svelteTesting()],
				test: {
					name: 'dom',
					environment: 'jsdom',
					include: ['src/**/*.dom.test.ts']
				}
			}
		]
	}
});
