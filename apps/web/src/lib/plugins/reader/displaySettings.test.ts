import { describe, expect, it } from 'vitest';
import fixture from '../../../../../../docs/contracts/reader/display-settings.json';
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
	const generic = ['serif', 'sans-serif', 'system-ui', 'inherit']; // inherit: the app's own stack
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
	it('default is the app stack and kai in ja is the serif stack', () => {
		expect(fontStack('default', 'zh')).toBe('inherit');
		expect(fontStack('kai', 'ja')).toBe(fontStack('serif', 'ja'));
	});
	it('an unknown language gets the generic stacks', () => {
		expect(fontStack('serif', 'en')).toMatch(/serif$/);
	});
});
