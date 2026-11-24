import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Doc check: docs/contracts/README.md has a row for every contract folder,
// and the Android entry point (overview.md) exists and is linked.
const root = resolve(__dirname, '../../../../docs/contracts');
const readme = readFileSync(resolve(root, 'README.md'), 'utf8');
const folders = readdirSync(root, { withFileTypes: true })
	.filter((e) => e.isDirectory())
	.map((e) => e.name)
	.sort();

describe('docs/contracts/README.md', () => {
	it('finds the contract folders', () => {
		expect(folders.length).toBeGreaterThan(0);
	});

	it.each(folders)('has a table row for %s/', (name) => {
		const row = readme.split('\n').find((l) => l.startsWith(`| [\`${name}/\`](${name}/README.md)`));
		expect(row, `no row for docs/contracts/${name}/ in README.md`).toBeDefined();
		expect(existsSync(resolve(root, name, 'README.md')), `${name}/README.md missing`).toBe(true);
	});

	it('links the overview and the file exists', () => {
		expect(readme).toContain('(overview.md)');
		expect(existsSync(resolve(root, 'overview.md'))).toBe(true);
	});
});

// Coverage guard (spec Q13): every fixture is named by a test that decodes it,
// and every folder is in the overview's read order.
const repo = resolve(root, '../..');

function walk(dir: string, keep: (name: string) => boolean, skip: (path: string) => boolean = () => false): string[] {
	const out: string[] = [];
	for (const e of readdirSync(dir, { withFileTypes: true })) {
		const path = resolve(dir, e.name);
		if (skip(path)) continue;
		if (e.isDirectory()) out.push(...walk(path, keep, skip));
		else if (keep(e.name)) out.push(path);
	}
	return out;
}

/** Fixtures no test needs to name: generator input, and the sample archive (decoded as a whole). */
const NOT_DECODED_BY_NAME = ['scheduler/optimizer-steps.inside.json', 'backup/sample-v2/'];

describe('docs/contracts coverage', () => {
	const fixtures = walk(root, (n) => n.endsWith('.json'))
		.map((p) => p.slice(root.length + 1))
		.filter((rel) => !NOT_DECODED_BY_NAME.some((x) => rel === x || rel.startsWith(x)))
		.sort();
	const skipDeps = (p: string) => p.includes('node_modules') || p.includes('/.svelte-kit');
	// One text per web test file, and one per Go package (its test files share constants such as a fixture dir).
	const goPackages = new Map<string, string>();
	for (const p of walk(resolve(repo, 'server'), (n) => n.endsWith('_test.go'), skipDeps)) {
		const dir = p.slice(0, p.lastIndexOf('/'));
		goPackages.set(dir, `${goPackages.get(dir) ?? ''}\n${readFileSync(p, 'utf8')}`);
	}
	const tests = [
		...walk(resolve(repo, 'apps/web/src'), (n) => n.endsWith('.test.ts'), skipDeps).map((p) => readFileSync(p, 'utf8')),
		...goPackages.values()
	];
	// A test names a fixture by its path under docs/contracts (`study/rows.json`), or by its bare file name
	// in quotes in a test file (web) or Go package that names the folder (`contracts/auth` + "me.json").
	const named = (rel: string): boolean => {
		const slash = rel.lastIndexOf('/');
		const folder = rel.slice(0, slash);
		const file = rel.slice(slash + 1);
		return tests.some(
			(t) => t.includes(rel) || (t.includes(`contracts/${folder}`) && (t.includes(`"${file}"`) || t.includes(`'${file}'`)))
		);
	};

	it('finds the fixtures and the tests', () => {
		expect(fixtures.length).toBeGreaterThan(50);
		expect(tests.length).toBeGreaterThan(50);
	});
	it.each(fixtures)('%s is named by a Go or web test', (rel) => {
		expect(named(rel), `no *.test.ts under apps/web/src or *_test.go under server/ names ${rel}`).toBe(true);
	});
	it('the allowlisted files exist and are decoded otherwise', () => {
		expect(existsSync(resolve(root, 'scheduler/optimizer-steps.inside.json'))).toBe(true);
		expect(readFileSync(resolve(repo, 'scripts/contracts/gen-scheduler-fixtures.mjs'), 'utf8')).toContain('optimizer-steps.inside.json');
		expect(tests.some((t) => t.includes('backup/sample-v2'))).toBe(true);
	});

	const overview = readFileSync(resolve(root, 'overview.md'), 'utf8');
	const readOrder = overview.slice(overview.indexOf('## Read order'), overview.indexOf('\n## ', overview.indexOf('## Read order') + 1));
	it.each(folders)("%s/ is in the overview's read order", (name) => {
		expect(readOrder).toContain(`\`${name}/\``);
	});
});

describe('interface language (#73)', () => {
	const overview = readFileSync(resolve(root, 'overview.md'), 'utf8');
	const i18n = readFileSync(resolve(root, 'i18n/README.md'), 'utf8');

	it('overview.md has an Interface language section and an Android line for it', () => {
		expect(overview).toMatch(/^## Interface language/m);
		expect(overview).toContain('i18n/README.md');
		expect(overview).toMatch(/interfaceLanguage/);
		expect(overview).toMatch(/Android[^\n]*(strings\.xml|catalogue)/);
	});

	it('i18n/README.md covers every spec section and carries the Rulings', () => {
		for (const heading of [
			'## Catalogue files',
			'## Keys',
			'## Message syntax',
			'## Android conversion',
			'## Interface language',
			'## `lang` and `dir` attributes',
			'## Locale formatting',
			'## API errors',
			'## Plugin manifests',
			'## Rulings',
			'## Fixtures'
		])
			expect(i18n, heading).toContain(heading);
		expect(i18n).toContain('en-GB');
		expect(i18n).toMatch(/studyLang/);
	});
});
