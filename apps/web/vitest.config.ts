import { svelteTesting } from '@testing-library/svelte/vite';
import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

// Test-only settings live here so the production build (vite.config.ts) does
// not import dev-only packages (vitest, jsdom, testing-library).
//
// Three projects: pure-logic tests run in plain node, untouched; component
// tests (`*.dom.test.ts`) get jsdom plus the browser resolve condition and
// auto-cleanup from svelteTesting (applied globally it would flip esm-env's
// BROWSER and break the node tests); the gallery (`*.gallery.test.ts`) is the
// dom setup with real CSS.
export default mergeConfig(
	viteConfig,
	defineConfig({
		test: {
			projects: [
				{
					extends: true,
					test: {
						name: 'unit',
						// tests/: the checks of the repository itself (docs, README, wiki, licence
						// texts, bundle size, folder rules), plain node like the unit tests.
						include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
						exclude: ['src/**/*.dom.test.ts', 'src/**/*.gallery.test.ts', '**/node_modules/**']
					}
				},
				{
					extends: true,
					plugins: [svelteTesting()],
					test: {
						name: 'dom',
						environment: 'jsdom',
						setupFiles: ['./src/lib/testing/domSetup.ts'],
						include: ['src/**/*.dom.test.ts']
					}
				},
				{
					// The component gallery (#98): jsdom with the components' real
					// CSS, so the rendered gallery can be written out as a static
					// page for screenshots (lib/ui/gallery.gallery.test.ts).
					extends: true,
					plugins: [svelteTesting()],
					test: {
						name: 'gallery',
						environment: 'jsdom',
						setupFiles: ['./src/lib/testing/domSetup.ts'],
						include: ['src/**/*.gallery.test.ts'],
						css: { include: [/.+/] }
					}
				}
			]
		}
	})
);
