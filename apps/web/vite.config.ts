import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [sveltekit()],
	server: {
		// The Go API on :8080 is the development backend.
		proxy: {
			'/api': 'http://127.0.0.1:8080'
		}
	},
	test: {
		include: ['src/**/*.test.ts']
	}
});
