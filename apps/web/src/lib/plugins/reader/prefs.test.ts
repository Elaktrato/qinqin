import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFS, loadPrefs, savePrefs } from './prefs';

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

	it('round-trips saved prefs', () => {
		const storage = memoryStorage();
		savePrefs(storage, { furigana: false, variant: 'traditional' });
		expect(loadPrefs(storage)).toEqual({ furigana: false, variant: 'traditional' });
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
		expect(() => savePrefs(throwing, DEFAULT_PREFS)).not.toThrow();
		expect(() => savePrefs(null, DEFAULT_PREFS)).not.toThrow();
	});
});
