import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFS, loadPrefs, saveFurigana, saveVariant } from './prefs';

function memoryStorage(initial: Record<string, string> = {}) {
	const data = new Map(Object.entries(initial));
	return {
		getItem: (key: string) => data.get(key) ?? null,
		setItem: (key: string, value: string) => void data.set(key, value),
		data
	};
}

const throwing = {
	getItem: (): string | null => {
		throw new Error('blocked');
	},
	setItem: (): void => {
		throw new Error('blocked');
	}
};

describe('reader prefs', () => {
	it('defaults to furigana shown and the original script', () => {
		expect(DEFAULT_PREFS).toEqual({ furigana: true, variant: 'original' });
		expect(loadPrefs(memoryStorage())).toEqual(DEFAULT_PREFS);
	});

	it('saves the script and keeps the legacy furigana value it no longer writes', () => {
		const storage = memoryStorage({ 'qinqin.reader.prefs': '{"furigana":false,"variant":"original"}' });
		saveVariant(storage, 'traditional');
		expect(loadPrefs(storage)).toEqual({ furigana: false, variant: 'traditional' });
		const fresh = memoryStorage();
		saveVariant(fresh, 'simplified');
		expect(JSON.parse(fresh.data.get('qinqin.reader.prefs')!)).toEqual({ variant: 'simplified' });
		expect(loadPrefs(fresh)).toEqual({ furigana: true, variant: 'simplified' });
	});

	it('saveVariant starts over from corrupt stored data', () => {
		const storage = memoryStorage({ 'qinqin.reader.prefs': '{nope' });
		saveVariant(storage, 'simplified');
		expect(loadPrefs(storage).variant).toBe('simplified');
	});

	it('ignores malformed or invalid stored values field by field', () => {
		expect(loadPrefs(memoryStorage({ 'qinqin.reader.prefs': '{nope' }))).toEqual(DEFAULT_PREFS);
		expect(
			loadPrefs(memoryStorage({ 'qinqin.reader.prefs': '{"furigana":"no","variant":"simplified"}' }))
		).toEqual({ furigana: true, variant: 'simplified' });
		expect(
			loadPrefs(memoryStorage({ 'qinqin.reader.prefs': '{"furigana":false,"variant":"klingon"}' }))
		).toEqual({ furigana: false, variant: 'original' });
		expect(loadPrefs(memoryStorage({ 'qinqin.reader.prefs': 'null' }))).toEqual(DEFAULT_PREFS);
	});

	it('works without storage or when storage throws', () => {
		expect(loadPrefs(null)).toEqual(DEFAULT_PREFS);
		expect(loadPrefs(throwing)).toEqual(DEFAULT_PREFS);
		expect(() => saveVariant(throwing, 'original')).not.toThrow();
		expect(() => saveVariant(null, 'original')).not.toThrow();
	});

	it('saveFurigana stores the legacy flag and keeps the script', () => {
		const storage = memoryStorage();
		saveVariant(storage, 'traditional');
		saveFurigana(storage, false);
		expect(loadPrefs(storage)).toEqual({ furigana: false, variant: 'traditional' });
		expect(() => saveFurigana(throwing, true)).not.toThrow();
	});
});
