import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	CARD_TYPES,
	DEFAULT_CONFIG,
	SESSION_CONFIG_KEY,
	SESSION_SEED_KEY,
	loadConfig,
	sessionSeedOf,
	saveConfig,
	sessionNewOrder,
	sessionTypeOrder,
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
		mode: 'decks',
		schemeId: null,
		levelName: null,
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
			mode: 'decks',
			schemeId: null,
			levelName: null,
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

	it('keeps grammar review on only when it is true (#181)', () => {
		const base = { mode: 'decks', schemeId: null, levelName: null, deckIds: ['general'], newLimit: 20, reviewLimit: 100, cardTypes: ['vocab'] };
		sessionStorage.setItem(SESSION_CONFIG_KEY, JSON.stringify({ ...base, grammar: true }));
		expect(loadConfig().grammar).toBe(true);
		sessionStorage.setItem(SESSION_CONFIG_KEY, JSON.stringify({ ...base, grammar: 'yes' }));
		expect(loadConfig().grammar).toBeUndefined();
	});

	it('keeps the page a session was started from only when it is a path of this app (review)', () => {
		const base = { mode: 'decks', schemeId: null, levelName: null, deckIds: ['general'], newLimit: 20, reviewLimit: 100, cardTypes: ['vocab'] };
		sessionStorage.setItem(SESSION_CONFIG_KEY, JSON.stringify({ ...base, from: '/flashcards?x=1' }));
		expect(loadConfig().from).toBe('/flashcards?x=1');
		for (const from of ['/\t/evil.example', '/\n/evil.example', '//evil.example', '/\\evil.example', 'javascript:alert(1)']) {
			sessionStorage.setItem(SESSION_CONFIG_KEY, JSON.stringify({ ...base, from }));
			expect(loadConfig().from, from).toBeUndefined();
		}
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

	it('round-trips a levels config', () => {
		const saved = config({
			mode: 'levels',
			schemeId: 7,
			levelName: 'N5',
			deckIds: []
		});
		saveConfig(saved);

		expect(loadConfig()).toEqual(saved);
	});

	it('parses a Round 1 config without a mode as a decks session', () => {
		sessionStorage.setItem(
			SESSION_CONFIG_KEY,
			JSON.stringify({
				deckIds: ['general'],
				newLimit: 20,
				reviewLimit: 100,
				cardTypes: ['vocab']
			})
		);

		expect(loadConfig()).toEqual({
			mode: 'decks',
			schemeId: null,
			levelName: null,
			deckIds: ['general'],
			newLimit: 20,
			reviewLimit: 100,
			cardTypes: ['vocab']
		});
	});

	it('returns defaults when a stored levels config is incomplete', () => {
		sessionStorage.setItem(
			SESSION_CONFIG_KEY,
			JSON.stringify(config({ mode: 'levels', schemeId: null, levelName: 'N5' }))
		);
		expect(loadConfig()).toEqual(DEFAULT_CONFIG);
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

	it('requires at least one deck in decks mode', () => {
		expect(validateConfig(config({ deckIds: [] }))).not.toEqual([]);
	});

	it('study all ignores the session limits', () => {
		expect(validateConfig(config({ studyAll: true, newLimit: 0, reviewLimit: 0 }))).toEqual([]);
		expect(validateConfig(config({ studyAll: true, newLimit: 5000, reviewLimit: 5000 }))).toEqual([]);
	});

	it('ignores scheme and level in decks mode', () => {
		expect(validateConfig(config({ schemeId: 0, levelName: '   ' }))).toEqual([]);
		expect(validateConfig(config({ schemeId: null, levelName: null }))).toEqual([]);
	});

	it('accepts a levels config without decks', () => {
		expect(
			validateConfig(
				config({ mode: 'levels', schemeId: 1, levelName: 'N5', deckIds: [] })
			)
		).toEqual([]);
	});

	it('requires a scheme and a level in levels mode', () => {
		expect(
			validateConfig(config({ mode: 'levels', schemeId: null, levelName: 'N5' }))
		).not.toEqual([]);
		expect(
			validateConfig(config({ mode: 'levels', schemeId: 0, levelName: 'N5' }))
		).not.toEqual([]);
		expect(
			validateConfig(config({ mode: 'levels', schemeId: 1.5, levelName: 'N5' }))
		).not.toEqual([]);
		expect(
			validateConfig(config({ mode: 'levels', schemeId: 1, levelName: null }))
		).not.toEqual([]);
		expect(
			validateConfig(config({ mode: 'levels', schemeId: 1, levelName: '' }))
		).not.toEqual([]);
		expect(
			validateConfig(config({ mode: 'levels', schemeId: 1, levelName: '  ' }))
		).not.toEqual([]);
	});

	it('rejects an unknown mode', () => {
		expect(
			validateConfig(config({ mode: 'quiz' as StudySessionConfig['mode'] }))
		).not.toEqual([]);
	});

	it('does not require decks in levels mode', () => {
		expect(
			validateConfig(config({ mode: 'levels', schemeId: 3, levelName: 'A1', deckIds: [] }))
		).toEqual([]);
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

	it('requires at least one known card type, not vocab specifically', () => {
		expect(validateConfig(config({ cardTypes: [] }))).not.toEqual([]);
		expect(validateConfig(config({ cardTypes: ['bogus'] }))).not.toEqual([]);
		expect(validateConfig(config({ cardTypes: ['tone'] }))).toEqual([]);
		expect(validateConfig(config({ cardTypes: ['vocab', 'bogus'] }))).not.toEqual([]);
		expect(validateConfig(config({ cardTypes: ['vocab', 'sentence'] }))).toEqual([]);
	});

	it('offers all four card types', () => {
		expect(CARD_TYPES.map((type) => type.id)).toEqual([
			'vocab',
			'sentence',
			'writing',
			'tone',
			'reverse',
			'cloze'
		]);
		expect(CARD_TYPES.every((type) => type.available)).toBe(true);
	});

	it('names the field that failed', () => {
		expect(validateConfig(config({ deckIds: [] })).join(' ')).toMatch(/deck/i);
		expect(validateConfig(config({ newLimit: 0 })).join(' ')).toMatch(/new/i);
		expect(validateConfig(config({ reviewLimit: 0 })).join(' ')).toMatch(/review/i);
		expect(validateConfig(config({ cardTypes: [] })).join(' ')).toMatch(/card type/i);
		expect(
			validateConfig(config({ mode: 'levels', schemeId: null, levelName: 'N5' })).join(' ')
		).toMatch(/scheme/i);
		expect(
			validateConfig(config({ mode: 'levels', schemeId: 1, levelName: null })).join(' ')
		).toMatch(/level/i);
	});
});

describe('newOrder in the setup (#75)', () => {
	beforeEach(() => {
		vi.stubGlobal('sessionStorage', fakeStorage());
	});
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('defaults to random', () => {
		expect(sessionNewOrder(DEFAULT_CONFIG)).toBe('random');
		expect(sessionNewOrder(config())).toBe('random');
	});

	it('round-trips an explicit order', () => {
		for (const newOrder of [
			'deck',
			'random',
			{ by: 'frequency' },
			{ by: 'added' },
			{ by: 'level', packId: 'hsk-words' }
		] as const) {
			saveConfig(config({ newOrder }));
			expect(loadConfig()).toEqual(config({ newOrder }));
			expect(sessionNewOrder(loadConfig())).toEqual(newOrder);
		}
	});

	it("an old setup without the field still loads, as random", () => {
		sessionStorage.setItem(SESSION_CONFIG_KEY, JSON.stringify(config()));
		expect(loadConfig()).toEqual(config());
		expect(sessionNewOrder(loadConfig())).toBe('random');
	});

	it('keeps the seed that fixes the shuffle of a started session', () => {
		saveConfig(config({ seed: 123456 }));
		expect(loadConfig().seed).toBe(123456);
		sessionStorage.setItem(SESSION_CONFIG_KEY, JSON.stringify({ ...config(), seed: 'x' }));
		expect(loadConfig().seed).toBeUndefined();
	});

	it("a malformed order loads as random and keeps the setup", () => {
		for (const newOrder of [{ by: 'level' }, 'frequency', 7]) {
			sessionStorage.setItem(SESSION_CONFIG_KEY, JSON.stringify({ ...config({ newLimit: 7 }), newOrder }));
			const loaded = loadConfig();
			expect(loaded.newLimit).toBe(7);
			expect(sessionNewOrder(loaded)).toBe('random');
		}
	});
});

describe('typeOrder in the setup (#132)', () => {
	beforeEach(() => {
		vi.stubGlobal('sessionStorage', fakeStorage());
	});
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('defaults to mixed', () => {
		expect(sessionTypeOrder(DEFAULT_CONFIG)).toBe('mixed');
		expect(sessionTypeOrder(config())).toBe('mixed');
	});

	it('round-trips grouped and mixed', () => {
		for (const typeOrder of ['grouped', 'mixed'] as const) {
			saveConfig(config({ typeOrder }));
			expect(loadConfig()).toEqual(config({ typeOrder }));
			expect(sessionTypeOrder(loadConfig())).toBe(typeOrder);
		}
	});

	it('an unknown value loads as mixed and keeps the setup', () => {
		for (const typeOrder of ['random', 7, null, { by: 'kind' }]) {
			sessionStorage.setItem(SESSION_CONFIG_KEY, JSON.stringify({ ...config({ newLimit: 9 }), typeOrder }));
			const loaded = loadConfig();
			expect(loaded.newLimit).toBe(9);
			expect(loaded.typeOrder).toBeUndefined();
			expect(sessionTypeOrder(loaded)).toBe('mixed');
		}
	});
});

describe('sessionSeedOf (#132 review)', () => {
	beforeEach(() => {
		vi.stubGlobal('sessionStorage', fakeStorage());
	});
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('uses the setup seed', () => {
		expect(sessionSeedOf(config({ seed: 42 }))).toBe(42);
	});

	it('without one draws a seed once and keeps it for the reloads of this tab', () => {
		const first = sessionSeedOf(config());
		expect(Number.isInteger(first)).toBe(true);
		expect(sessionSeedOf(config())).toBe(first);
		expect(sessionStorage.getItem(SESSION_SEED_KEY)).toBe(String(first));
	});

	it('still gives a seed when storage is unavailable', () => {
		vi.stubGlobal('sessionStorage', undefined);
		expect(Number.isInteger(sessionSeedOf(config()))).toBe(true);
	});
});
