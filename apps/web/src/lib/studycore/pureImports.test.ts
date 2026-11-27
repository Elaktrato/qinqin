import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The planners are pure modules Android ports (#175, #193): they take their
// constants from studycore/types.ts and limits.ts (paths under lib/), never from the study data layer (the
// cache, its reads and the commands, #193) or the session setup (heavy modules
// with storage and network).
const PURE = [
	'studycore/reviewOrder.ts',
	'features/flashcards/session/sessionQueue.ts',
	'studycore/limits.ts',
	'features/flashcards/session/levelQueue.ts',
	'features/flashcards/session/cardFlow.ts',
	'features/flashcards/session/sessionOrder.ts',
	'features/flashcards/session/grade.ts',
	'features/flashcards/face/hints.ts',
	'features/flashcards/face/hintKey.ts',
	'starter/starter.ts',
	'exercises/tones.ts',
	'exercises/writing.ts',
	'studycore/readModel.ts',
	'studycore/canonical.ts',
	'studycore/rows.ts'
];
const HEAVY = /(^|\/)(store|session|data|cache|history|studyData)$|(^|\/)commands\/|(^|\/)api\/client$/;

function imports(file: string): string[] {
	const text = readFileSync(resolve(__dirname, '..', file), 'utf8');
	return [...text.matchAll(/^import[^;]*?from\s+'([^']+)'/gms)].map((m) => m[1]);
}

describe('pure study planners', () => {
	it.each(PURE)('%s imports neither the study data layer nor the session setup', (file) => {
		const bad = imports(file).filter((path) => HEAVY.test(path));
		expect(bad).toEqual([]);
	});
});

describe('no import cycle through the scheduler', () => {
	// The queue (flashcards' session/queue.ts) imports the scheduler, the builder and limits.ts; they must not import
	// the scheduler back (#175 review).
	it.each(['studycore/reviewOrder.ts', 'features/flashcards/session/sessionQueue.ts', 'studycore/limits.ts'])('%s does not import the scheduler', (file) => {
		expect(imports(file).filter((path) => /(^|\/)scheduler$/.test(path))).toEqual([]);
	});
});
