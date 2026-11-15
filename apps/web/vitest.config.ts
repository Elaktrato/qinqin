import { svelteTesting } from '@testing-library/svelte/vite';
import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

// Test-only settings live here so the production build (vite.config.ts) does
// not import dev-only packages (vitest, jsdom, testing-library).
//
// Two projects: pure-logic tests run in plain node, untouched; component
// tests (`*.dom.test.ts`) get jsdom plus the browser resolve condition and
// auto-cleanup from svelteTesting (applied globally it would flip esm-env's
// BROWSER and break the node tests).
export default mergeConfig(
	viteConfig,
	defineConfig({
		test: {
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
	})
);
