import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The planners are pure modules Android ports and #193 reuses (#175): they take
// their constants from types.ts and limits.ts, never from the store or the
// session setup (heavy modules with storage and network).
const PURE = ['limits.ts', 'levelQueue.ts', 'cardFlow.ts', 'sessionOrder.ts', 'grade.ts'];

function imports(file: string): string[] {
	const text = readFileSync(resolve(__dirname, file), 'utf8');
	return [...text.matchAll(/^import[^;]*?from\s+'([^']+)'/gms)].map((m) => m[1]);
}

describe('pure study planners', () => {
	it.each(PURE)('%s imports neither the store nor the session setup', (file) => {
		const bad = imports(file).filter((path) => /(^|\/)(store|session)$/.test(path));
		expect(bad).toEqual([]);
	});
});
