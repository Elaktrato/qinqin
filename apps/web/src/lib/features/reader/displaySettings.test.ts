import { describe, expect, it } from 'vitest';
import settingsFixture from '../../../../../../docs/contracts/settings/workspace-settings.json';
import fixture from '../../../../../../docs/contracts/reader/display-settings.json';
import { hanziStack, installedFaces } from '$lib/fonts/hanzi';
import { fontStack } from './fonts';
import { DEFAULT_DISPLAY, displayPatch, parseDisplay, RUBY_SCALES } from './displaySettings';

describe('parseDisplay (contract)', () => {
	expect(fixture.version).toBe(1);
	for (const c of fixture.cases) {
		it(c.name, () => {
			expect(parseDisplay(c.settings as Record<string, unknown> | null, c.localFurigana)).toEqual(c.expect);
		});
	}
	it('defaults match the fixture', () => {
		expect(DEFAULT_DISPLAY).toEqual(fixture.defaults);
		expect(RUBY_SCALES).toEqual([0.45, 0.55, 0.65, 0.75]);
	});
});

describe('displayPatch', () => {
	it('sends the changed fields with the version', () => {
		expect(displayPatch({ readings: 'smart' }, null)).toEqual({ reader: { version: 1, readings: 'smart' } });
	});
	it('keeps unknown keys of the stored reader object', () => {
		const patch = displayPatch({ font: 'serif' }, { reader: { future: { a: 1 }, readings: 'always' } });
		expect(patch).toEqual({ reader: { future: { a: 1 }, readings: 'always', version: 1, font: 'serif' } });
	});
	it('writes highlightWords and keeps unknown keys', () => {
		const patch = displayPatch({ highlightWords: true }, { reader: { future: 1 } });
		expect(patch).toEqual({ reader: { future: 1, version: 1, highlightWords: true } });
		expect(displayPatch({ highlightWords: false }, null).reader.highlightWords).toBe(false);
	});
	it('sanitizes the change like parseDisplay', () => {
		const patch = displayPatch({ smartThreshold: 500, rubyScale: 0.6 }, null);
		expect(patch.reader.smartThreshold).toBe(100);
		expect(RUBY_SCALES).toContain(patch.reader.rubyScale);
	});
});

describe('fontStack', () => {
	// var(--font-hanzi): the app-wide hanzi font (#97); inherit: the app's own stack
	const generic = ['serif', 'sans-serif', 'system-ui', 'inherit', 'var(--font-hanzi)'];
	for (const lang of fixture.fontStacks.langs) {
		for (const font of fixture.fontStacks.fonts) {
			it(`${lang} ${font}`, () => {
				const parts = fontStack(font as never, lang)
					.split(',')
					.map((p) => p.trim());
				expect(parts.length).toBeGreaterThan(0);
				expect(generic).toContain(parts[parts.length - 1]);
				expect(fontStack(font as never, lang)).not.toMatch(/url\(|@font-face|https?:/);
			});
		}
	}
	it('default is the app-wide hanzi font; the others are the shared hanzi stacks of the full study lang', () => {
		expect(fontStack('default', 'zh')).toBe('var(--font-hanzi)');
		expect(fontStack('default', 'ja')).toBe('var(--font-hanzi)');
		expect(fontStack('default', 'ko')).toBe('inherit');
		expect(fontStack('kai', 'ja')).toBe(hanziStack('kai', 'ja', installedFaces([])));
		expect(fontStack('serif', 'zh-Hant')).toBe(hanziStack('serif', 'zh-Hant', installedFaces([])));
	});
	it('an installed pack face comes first', () => {
		expect(fontStack('kai', 'zh-Hans', installedFaces([{ face: 'kai', script: 'Hans' }]))).toMatch(/^"qq-kai-Hans", /);
	});
	it('an unknown language gets the generic stacks', () => {
		expect(fontStack('serif', 'en')).toMatch(/serif$/);
	});
});

describe('docs/contracts/settings/workspace-settings.json: the reader key', () => {
	it('points to reader/display-settings.json and is the key displayPatch writes', () => {
		const keys = (settingsFixture as unknown as { keys: { key: string; default: unknown }[] }).keys;
		const reader = keys.find((k) => k.key === 'reader');
		expect(reader?.default).toBe('see reader/display-settings.json');
		expect(Object.keys(displayPatch({}, null))).toEqual(['reader']);
	});
});
