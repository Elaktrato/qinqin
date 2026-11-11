import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	DEFAULT_CONFIG,
	SESSION_CONFIG_KEY,
	loadConfig,
	saveConfig,
	validateConfig,
	type StudySessionConfig
} from './session';

function fakeStorage(): Storage {
	const data = new Map<string, string>();
	return {
		getItem: (key: string) => data.get(key) ?? null,
		setItem: (key: string, value: string) => void data.set(key, value),
		removeItem: (key: string) => void data.delete(key),
		clear: () => data.clear(),
		key: (index: number) => [...data.keys()][index] ?? null,
		get length() {
			return data.size;
		}
	} as Storage;
}

function config(overrides: Partial<StudySessionConfig> = {}): StudySessionConfig {
	return {
		deckIds: ['general'],
		newLimit: 20,
		reviewLimit: 100,
		cardTypes: ['vocab'],
		...overrides
	};
}

describe('DEFAULT_CONFIG', () => {
	it('starts on the general deck with the documented limits', () => {
		expect(DEFAULT_CONFIG).toEqual({
			deckIds: ['general'],
			newLimit: 20,
			reviewLimit: 100,
			cardTypes: ['vocab']
		});
	});
});

describe('loadConfig', () => {
	beforeEach(() => {
		vi.stubGlobal('sessionStorage', fakeStorage());
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('returns defaults when storage is empty', () => {
		expect(loadConfig()).toEqual(DEFAULT_CONFIG);
	});

	it('returns defaults when storage holds malformed JSON', () => {
		sessionStorage.setItem(SESSION_CONFIG_KEY, '{not json');
		expect(loadConfig()).toEqual(DEFAULT_CONFIG);
	});

	it('returns defaults when the shape is wrong', () => {
		for (const raw of ['null', '42', '"x"', '[]', '{}', '{"deckIds":"general"}']) {
			sessionStorage.setItem(SESSION_CONFIG_KEY, raw);
			expect(loadConfig()).toEqual(DEFAULT_CONFIG);
		}
	});

	it('returns defaults when the stored config is invalid', () => {
		sessionStorage.setItem(
			SESSION_CONFIG_KEY,
			JSON.stringify(config({ deckIds: [], newLimit: 0 }))
		);
		expect(loadConfig()).toEqual(DEFAULT_CONFIG);
	});

	it('round-trips a saved config', () => {
		const saved = config({
			deckIds: ['general', 'deck-1'],
			newLimit: 5,
			reviewLimit: 40,
			cardTypes: ['vocab', 'sentence']
		});
		saveConfig(saved);

		expect(loadConfig()).toEqual(saved);
	});

	it('preserves card types the UI does not offer yet', () => {
		const saved = config({ cardTypes: ['vocab', 'writing', 'tone'] });
		saveConfig(saved);

		expect(loadConfig().cardTypes).toEqual(['vocab', 'writing', 'tone']);
	});

	it('returns defaults when storage is unavailable', () => {
		vi.stubGlobal('sessionStorage', {
			getItem: () => {
				throw new Error('denied');
			},
			setItem: () => {
				throw new Error('denied');
			}
		});

		expect(loadConfig()).toEqual(DEFAULT_CONFIG);
		expect(() => saveConfig(config())).not.toThrow();
	});
});

describe('validateConfig', () => {
	it('accepts the default config', () => {
		expect(validateConfig(DEFAULT_CONFIG)).toEqual([]);
	});

	it('requires at least one deck', () => {
		expect(validateConfig(config({ deckIds: [] }))).not.toEqual([]);
	});

	it('rejects non-positive limits', () => {
		expect(validateConfig(config({ newLimit: 0 }))).not.toEqual([]);
		expect(validateConfig(config({ newLimit: -3 }))).not.toEqual([]);
		expect(validateConfig(config({ reviewLimit: 0 }))).not.toEqual([]);
		expect(validateConfig(config({ reviewLimit: -1 }))).not.toEqual([]);
	});

	it('rejects non-integer limits', () => {
		expect(validateConfig(config({ newLimit: 1.5 }))).not.toEqual([]);
		expect(validateConfig(config({ reviewLimit: Number.NaN }))).not.toEqual([]);
	});

	it('rejects limits above 999', () => {
		expect(validateConfig(config({ newLimit: 1000 }))).not.toEqual([]);
		expect(validateConfig(config({ reviewLimit: 1000 }))).not.toEqual([]);
		expect(validateConfig(config({ newLimit: 999, reviewLimit: 999 }))).toEqual([]);
	});

	it('requires vocab cards', () => {
		expect(validateConfig(config({ cardTypes: [] }))).not.toEqual([]);
		expect(validateConfig(config({ cardTypes: ['sentence'] }))).not.toEqual([]);
		expect(validateConfig(config({ cardTypes: ['vocab', 'sentence'] }))).toEqual([]);
	});

	it('names the field that failed', () => {
		expect(validateConfig(config({ deckIds: [] })).join(' ')).toMatch(/deck/i);
		expect(validateConfig(config({ newLimit: 0 })).join(' ')).toMatch(/new/i);
		expect(validateConfig(config({ reviewLimit: 0 })).join(' ')).toMatch(/review/i);
		expect(validateConfig(config({ cardTypes: [] })).join(' ')).toMatch(/vocab/i);
	});
});
