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
