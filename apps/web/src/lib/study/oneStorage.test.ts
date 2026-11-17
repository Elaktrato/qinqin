import { describe, expect, it } from 'vitest';

// One storage (docs/contracts/study/): cards, decks, deck settings, limits
// and FSRS sets are written only through the typed push. The plugin-data
// routes of the study namespace are left to its keyed rows (goals, known
// marks, vacations), and in all of src/ only store.ts talks to them.
const sources = import.meta.glob(
	['../../**/*.{ts,svelte}', '!../../**/*.test.ts', '!../../**/*.test.svelte', '!../../**/testing/**'],
	{ query: '?raw', import: 'default', eager: true }
) as Record<string, string>;

const STORE = Object.keys(sources).find((path) => path.endsWith('lib/study/store.ts') || path === './store.ts')!;

describe('study writes use one storage', () => {
	it('finds the sources it checks: all of src/', () => {
		expect(STORE).toBeDefined();
		expect(Object.keys(sources).some((path) => path.startsWith('../../routes/'))).toBe(true);
		expect(Object.keys(sources).some((path) => path.includes('/pwa/'))).toBe(true);
		expect(Object.keys(sources).length).toBeGreaterThan(400);
	});

	it("no source in src/ but store.ts names the study namespace's plugin-data routes", () => {
		const offenders = Object.entries(sources)
			.filter(
				([path, text]) =>
					path !== STORE && /\/api\/plugins\/\$\{FLASHCARDS_PLUGIN_ID\}|\/api\/plugins\/qinqin-flashcards/.test(text)
			)
			.map(([path]) => path);
		expect(offenders).toEqual([]);
	});

	it('store.ts uses the plugin-data routes only for the keyed rows, behind assertKeyedRow', () => {
		const store = sources[STORE];
		const lines = store.split('\n').filter((line) => line.includes('/api/plugins/'));
		// dataPath (goals, known marks) and the two vacation writers.
		expect(lines).toHaveLength(3);
		expect(lines.filter((line) => line.includes('VACATION_PREFIX'))).toHaveLength(2);
		expect(store).toMatch(/function putData[\s\S]*?assertKeyedRow\(key\);/);
		expect(store).toMatch(/async function deleteData[\s\S]*?assertKeyedRow\(key\);/);
		expect(store).toMatch(/async function pushKeyedRows[\s\S]*?assertKeyedRow\(row\.key\)/);
		expect(store).not.toMatch(/export (async )?function pushStudyRows/);
	});
});
