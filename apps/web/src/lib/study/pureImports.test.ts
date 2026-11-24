import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The planners are pure modules Android ports (#175, #193): they take their
// constants from types.ts and limits.ts, never from the study data layer (the
// cache, its reads and the commands, #193) or the session setup (heavy modules
// with storage and network).
const PURE = [
	'reviewOrder.ts',
	'sessionQueue.ts',
	'limits.ts',
	'levelQueue.ts',
	'cardFlow.ts',
	'sessionOrder.ts',
	'grade.ts',
	'tones.ts',
	'writing.ts',
	'readModel.ts',
	'canonical.ts',
	'rows.ts'
];
const HEAVY = /(^|\/)(store|session|data|cache|history|studyData)$|(^|\/)commands\/|(^|\/)api\/client$/;

function imports(file: string): string[] {
	const text = readFileSync(resolve(__dirname, file), 'utf8');
	return [...text.matchAll(/^import[^;]*?from\s+'([^']+)'/gms)].map((m) => m[1]);
}

describe('pure study planners', () => {
	it.each(PURE)('%s imports neither the study data layer nor the session setup', (file) => {
		const bad = imports(file).filter((path) => HEAVY.test(path));
		expect(bad).toEqual([]);
	});
});

describe('no import cycle through the scheduler', () => {
	// scheduler.ts imports the builder and limits.ts; they must not import it back (#175 review).
	it.each(['reviewOrder.ts', 'sessionQueue.ts', 'limits.ts'])('%s does not import ./scheduler', (file) => {
		expect(imports(file).filter((path) => /(^|\/)scheduler$/.test(path))).toEqual([]);
	});
});
