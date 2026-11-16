import { describe, expect, it } from 'vitest';

// One storage (docs/contracts/study/): cards, decks, deck settings, limits
// and FSRS sets are written only through the typed push. The plugin-data
// routes are left to the keyed rows of the study namespace (goals, known
// marks, vacations), and only store.ts talks to them.
const sources = {
	...import.meta.glob(['./**/*.ts', '!./**/*.test.ts', '!./testing/**'], {
		query: '?raw',
		import: 'default',
		eager: true
	}),
	...import.meta.glob(['../features/flashcards/**/*.{ts,svelte}', '!../features/flashcards/**/*.test.ts'], {
		query: '?raw',
		import: 'default',
		eager: true
	}),
	...import.meta.glob(['../features/reader/**/*.{ts,svelte}', '!../features/reader/**/*.test.ts'], {
		query: '?raw',
		import: 'default',
		eager: true
	})
} as Record<string, string>;

describe('study writes use one storage', () => {
	it('finds the sources it checks', () => {
		expect(Object.keys(sources)).toContain('./store.ts');
		expect(Object.keys(sources).length).toBeGreaterThan(50);
	});

	it('no study source but store.ts names a plugin-data route', () => {
		const offenders = Object.entries(sources)
			.filter(
				([path, text]) => path !== './store.ts' && /\/api\/plugins\/\$\{FLASHCARDS_PLUGIN_ID\}|\/api\/plugins\/qinqin-flashcards/.test(text)
			)
			.map(([path]) => path);
		expect(offenders).toEqual([]);
	});

	it('store.ts uses the plugin-data routes only for the keyed rows, behind assertKeyedRow', () => {
		const store = sources['./store.ts'];
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
