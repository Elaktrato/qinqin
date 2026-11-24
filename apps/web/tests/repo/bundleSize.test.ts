// Stroke-order data is a package served by the server (/hanzi/...), not part of
// the web bundle (v0.4.0 prep, item 5). These checks keep it out.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const web = join(__dirname, '..', '..');
const pkg = JSON.parse(readFileSync(join(web, 'package.json'), 'utf8')) as {
	scripts: Record<string, string>;
	dependencies: Record<string, string>;
	devDependencies: Record<string, string>;
};

describe('stroke data is not bundled', () => {
	it('static/hanzi does not exist and no script writes it', () => {
		expect(existsSync(join(web, 'static', 'hanzi'))).toBe(false);
		expect(existsSync(join(web, 'scripts', 'prepare-hanzi-data.mjs'))).toBe(false);
		for (const [name, cmd] of Object.entries(pkg.scripts)) expect(cmd, name).not.toMatch(/hanzi/);
		expect(pkg.scripts.predev).toBeUndefined();
		expect(pkg.scripts.prebuild).toBeUndefined();
	});
	it('hanzi-writer-data is a dev dependency only (the stroke index test reads it)', () => {
		expect(pkg.dependencies['hanzi-writer-data']).toBeUndefined();
		expect(pkg.devDependencies['hanzi-writer-data']).toBeDefined();
	});
	it('the vite and svelte configs know no per-character assets', () => {
		for (const f of ['vite.config.ts', 'svelte.config.js']) {
			expect(readFileSync(join(web, f), 'utf8'), f).not.toMatch(/hanzi\//);
		}
		expect(readFileSync(join(web, 'vite.config.ts'), 'utf8')).toContain("'/hanzi': 'http://127.0.0.1:8080'");
	});
	// Runs over the output of `npm run build` (skipped when there is none).
	const build = join(web, 'build');
	it.skipIf(!existsSync(build))('the build output has no hanzi directory and stays small', () => {
		expect(existsSync(join(build, 'hanzi'))).toBe(false);
		const size = (dir: string): number =>
			readdirSync(dir, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? size(join(dir, e.name)) : statSync(join(dir, e.name)).size), 0);
		expect(size(build)).toBeLessThan(20 * 1024 * 1024);
	});
});
