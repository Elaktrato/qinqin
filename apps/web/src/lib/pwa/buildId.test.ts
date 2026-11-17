// One build, one id. SvelteKit evaluates svelte.config.js several times in a
// single `vite build` (once per vite environment, then again for the
// postbuild analysis and prerender, each import cache-busted with a query).
// When each evaluation minted its own `Date.now()` id, index.html carried a
// different `__sveltekit_<hash>` global than the chunks did and the served
// app was a blank page.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const web = join(__dirname, '..', '..', '..');
const configUrl = pathToFileURL(join(web, 'svelte.config.js')).href;

/** Evaluates the config twice in one fresh node process, as SvelteKit does. */
function twoEvaluations(env: NodeJS.ProcessEnv): [string, string] {
	const script = `
		const url = ${JSON.stringify(configUrl)};
		const a = (await import(url + '?a')).default.kit.version.name;
		const until = Date.now() + 5; while (Date.now() < until);
		const b = (await import(url + '?b')).default.kit.version.name;
		console.log(JSON.stringify([a, b]));
	`;
	const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd: web, env });
	return JSON.parse(out.toString()) as [string, string];
}

function envWithout(...names: string[]): NodeJS.ProcessEnv {
	const env = { ...process.env };
	for (const n of names) delete env[n];
	return env;
}

describe('svelte.config.js build id', () => {
	it('every evaluation in one process gets the same id', () => {
		const [a, b] = twoEvaluations(envWithout('QINQIN_BUILD_ID'));
		expect(a).toMatch(/^[0-9a-z]+\.[0-9a-z]+$/);
		expect(b).toBe(a);
	});
	it('QINQIN_BUILD_ID still wins', () => {
		const [a, b] = twoEvaluations({ ...process.env, QINQIN_BUILD_ID: 'release-1' });
		expect([a, b]).toEqual(['release-1', 'release-1']);
	});
	it('two separate builds still get different ids', () => {
		const [a] = twoEvaluations(envWithout('QINQIN_BUILD_ID'));
		const until = Date.now() + 5;
		while (Date.now() < until);
		const [b] = twoEvaluations(envWithout('QINQIN_BUILD_ID'));
		expect(b).not.toBe(a);
	});
});

// When a build exists (the CI web job builds after the tests, so this mostly
// guards local runs), its index.html must name the same app global as the
// chunks, and version.json must agree with both.
const build = join(web, 'build');
describe.skipIf(!existsSync(join(build, 'index.html')))('build output agrees on one version', () => {
	it('index.html and the immutable chunks share one __sveltekit_ global', () => {
		const tokens = (s: string) => new Set(s.match(/__sveltekit_[0-9a-z]+/g) ?? []);
		const index = tokens(readFileSync(join(build, 'index.html'), 'utf8'));
		expect(index.size).toBe(1);
		const chunks = new Set<string>();
		const walk = (dir: string) => {
			for (const e of readdirSync(dir, { withFileTypes: true })) {
				const p = join(dir, e.name);
				if (e.isDirectory()) walk(p);
				else if (p.endsWith('.js')) for (const t of tokens(readFileSync(p, 'utf8'))) chunks.add(t);
			}
		};
		walk(join(build, '_app', 'immutable'));
		expect([...chunks]).toEqual([...index]);
	});
});
