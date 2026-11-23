// The suite's own rules (record 0007): no fixed sleeps in a test and no
// retries anywhere. Reads files only; starts no server and no browser.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const e2e = join(here, '..');
const repo = join(e2e, '..', '..', '..');

/** Calls that wait a fixed time instead of for a condition. */
const SLEEPS = /\bwaitForTimeout\s*\(|\bsetTimeout\s*\(|\bsleep\s*\(/;
/** A retry setting: `retries: n` in a config or `test.describe.configure`, or the CLI flag. */
const RETRIES = /\bretries\s*:|--retries\b/;

function tsFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
		e.isDirectory() ? (['test-results', 'playwright-report', 'fixtures'].includes(e.name) ? [] : tsFiles(join(dir, e.name))) : e.name.endsWith('.ts') ? [join(dir, e.name)] : []
	);
}

/** Lines of the files matching `pattern`, as "file:line: text". */
function offenders(files: string[], pattern: RegExp, allowed: (line: string) => boolean = () => false): string[] {
	return files.flatMap((file) =>
		readFileSync(file, 'utf8')
			.split('\n')
			.map((line, i) => ({ where: `${relative(repo, file)}:${i + 1}`, line }))
			.filter(({ line }) => pattern.test(line) && !allowed(line))
			.map(({ where, line }) => `${where}: ${line.trim()}`)
	);
}

const self = fileURLToPath(import.meta.url);

test('no spec waits a fixed time', () => {
	const specs = tsFiles(here).filter((f) => f.endsWith('.spec.ts') && f !== self);
	expect(offenders(specs, SLEEPS)).toEqual([]);
});

test('nothing retries a failed test: config, specs, support code and the CI command', () => {
	const config = join(e2e, 'playwright.config.ts');
	expect(readFileSync(config, 'utf8')).toMatch(/^\s*retries: 0,$/m);
	const code = tsFiles(e2e).filter((f) => f !== self);
	expect(offenders(code, RETRIES, (line) => /^\s*retries: 0,$/.test(line))).toEqual([]);
	const workflow = join(repo, '.github', 'workflows', 'build.yml');
	expect(offenders([workflow], /--retries\b/)).toEqual([]);
	expect(readFileSync(workflow, 'utf8')).toContain('run: npm run e2e');
});

test('the rules catch what they are for', () => {
	expect(SLEEPS.test('await page.waitForTimeout(500);')).toBe(true);
	expect(SLEEPS.test('await new Promise((r) => setTimeout(r, 100));')).toBe(true);
	expect(RETRIES.test("test.describe.configure({ retries: 2 });")).toBe(true);
	expect(RETRIES.test('run: npm run e2e -- --retries 3')).toBe(true);
	expect(RETRIES.test('retries: 0,')).toBe(true);
	expect(SLEEPS.test('await expect.poll(() => f()).toBe(1);')).toBe(false);
});
