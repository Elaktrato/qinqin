import { describe, expect, it } from 'vitest';

// One storage (docs/contracts/study/): cards, decks, deck settings, limits
// and FSRS sets are written only through the typed push. The keyed row
// routes are left to keyed rows (the study's goals, known marks, vacations
// and milestones; the core rows), and in all of src/ only lib/sync/keyed.ts
// builds them (#193, #199); the service worker's classifier only matches them.
const sources = import.meta.glob(
	['../../**/*.{ts,svelte}', '!../../**/*.test.ts', '!../../**/*.test.svelte', '!../../**/testing/**'],
	{ query: '?raw', import: 'default', eager: true }
) as Record<string, string>;

const KEYED = Object.keys(sources).find((path) => path.endsWith('/sync/keyed.ts'))!;
const CLASSIFY = Object.keys(sources).find((path) => path.endsWith('/pwa/sw/classify.ts'))!;

describe('study writes use one storage', () => {
	it('finds the sources it checks: all of src/', () => {
		expect(KEYED).toBeDefined();
		expect(CLASSIFY).toBeDefined();
		expect(Object.keys(sources).some((path) => path.startsWith('../../routes/'))).toBe(true);
		expect(Object.keys(sources).some((path) => path.includes('/pwa/'))).toBe(true);
		expect(Object.keys(sources).length).toBeGreaterThan(400);
	});

	it('no source in src/ but lib/sync/keyed.ts builds a keyed row route', () => {
		const offenders = Object.entries(sources)
			.filter(([path, text]) => path !== KEYED && path !== CLASSIFY && /['"`]\/api\/rows\b/.test(text))
			.map(([path]) => path);
		expect(offenders).toEqual([]);
	});

	it('keyed.ts builds them in one place and has no typed-row writer', () => {
		const keyed = sources[KEYED];
		expect(keyed.split('\n').filter((line) => line.includes("'/api/rows'"))).toHaveLength(1);
		expect(keyed).not.toMatch(/export (async )?function pushStudyRows/);
	});
});
