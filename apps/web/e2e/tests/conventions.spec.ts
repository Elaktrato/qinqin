// The suite's own rules (record 0007): no fixed sleeps in a test and no
// retries. Reads files only; starts no server and no browser.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));

/** Calls that wait a fixed time instead of for a condition. */
const SLEEPS = /\bwaitForTimeout\s*\(|\bsetTimeout\s*\(|\bsleep\s*\(/;

test('no spec waits a fixed time', () => {
	const offenders = readdirSync(here)
		.filter((name) => name.endsWith('.spec.ts') && name !== 'conventions.spec.ts')
		.flatMap((name) =>
			readFileSync(join(here, name), 'utf8')
				.split('\n')
				.map((line, i) => ({ where: `${name}:${i + 1}`, line }))
				.filter(({ line }) => SLEEPS.test(line))
				.map(({ where, line }) => `${where}: ${line.trim()}`)
		);
	expect(offenders).toEqual([]);
});

test('the config never retries a failed test', () => {
	const config = readFileSync(join(here, '..', 'playwright.config.ts'), 'utf8');
	expect(config).toMatch(/^\s*retries: 0,$/m);
});
