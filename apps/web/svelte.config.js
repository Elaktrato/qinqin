import { execSync } from 'node:child_process';
import adapter from '@sveltejs/adapter-static';

/**
 * The build id keys the worker's precache. QINQIN_BUILD_ID wins (a release
 * pipeline); otherwise the git short hash plus the build time, so two builds
 * of different content can never share a version (an identical rebuild shows
 * the update banner once, which is harmless; a missed update would not be).
 *
 * SvelteKit evaluates this file several times in one `vite build` (per vite
 * environment, then for the postbuild analysis and the fallback page). The
 * id is minted once and written back to process.env, so every later
 * evaluation, and any child process, reuses it; otherwise index.html and the
 * chunks name different `__sveltekit_<hash>` globals and the app is blank.
 */
function buildId() {
	if (process.env.QINQIN_BUILD_ID) return process.env.QINQIN_BUILD_ID;
	let hash = 'nogit';
	try {
		hash = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || hash;
	} catch {
		// Built outside a git checkout (a Docker context without .git).
	}
	process.env.QINQIN_BUILD_ID = `${hash}.${Date.now().toString(36)}`;
	return process.env.QINQIN_BUILD_ID;
}

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		// SPA: one index.html plus hashed assets. The Go binary serves the
		// files and falls back to index.html for client-side routes.
		// Hand-written worker (src/service-worker.ts); registration is the
		// page's decision (lib/pwa/register.ts: secure contexts only).
		serviceWorker: {
			register: false,
			// Licence texts are not part of the precached shell. (Stroke data is
			// a package the server serves, not a build file.)
			files: (filename) => !/\.TXT$/i.test(filename) && !filename.endsWith('.DS_Store')
		},
		version: { name: buildId() },
		adapter: adapter({
			pages: 'build',
			assets: 'build',
			fallback: 'index.html',
			strict: false
		})
	}
};

export default config;
