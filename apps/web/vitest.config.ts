import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

// Test-only settings live here so the production build (vite.config.ts) does
// not import the dev-only vitest package.
export default mergeConfig(
	viteConfig,
	defineConfig({
		test: {
			include: ['src/**/*.test.ts']
		}
	})
);
