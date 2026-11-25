import { describe, expect, it } from 'vitest';
import characterMap from './CharacterMapSummary.svelte?raw';
import flashcards from '../features/flashcards/FlashcardsWidget.svelte?raw';
import readingTime from './ReadingTimeWidget.svelte?raw';
import reviewsPerDay from './ReviewsPerDayWidget.svelte?raw';
import summary from './SummaryWidget.svelte?raw';
import wordStates from './WordStatesWidget.svelte?raw';

const styleOf = (source: string): string => source.slice(source.indexOf('<style>'));

const WIDGETS: [string, string][] = [
	['WordStatesWidget', wordStates],
	['FlashcardsWidget', flashcards],
	['ReadingTimeWidget', readingTime],
	['CharacterMapSummary', characterMap],
	['SummaryWidget', summary],
	['ReviewsPerDayWidget', reviewsPerDay]
];

describe('the Stats overview widgets in the lighter look', () => {
	it.each(WIDGETS)('%s: type weights stay at or below 600 and labels are not all-caps', (_name, source) => {
		const css = styleOf(source);
		const weights = [...css.matchAll(/font-weight:\s*([^;]+);/g)].map((m) => m[1].trim());
		for (const weight of weights) expect(['400', '500', '600', 'var(--weight-medium)', 'var(--weight-strong)']).toContain(weight);
		expect(css).not.toMatch(/font-weight:\s*(bold|[7-9]00)/);
		expect(css).not.toMatch(/text-transform:/);
	});

	it.each(WIDGETS)('%s: no bordered pill links on the widget (secondary actions are plain)', (_name, source) => {
		expect(source).not.toMatch(/class="open"/);
		expect(styleOf(source)).not.toMatch(/\.open\s*\{/);
		expect(styleOf(source)).not.toMatch(/border:\s*1px solid var\(--accent\)/);
	});

	it('WordStatesWidget draws the cards-by-state bar on the accent ramp, with a legend in words', () => {
		const css = styleOf(wordStates);
		for (const token of ['--accent-14', '--accent-32', '--accent-58', '--accent-100']) {
			expect(css).toContain(`var(${token})`);
		}
		expect(wordStates).toMatch(/\{#each WORD_STATES as item/);
	});

	it('FlashcardsWidget: a 4px --accent level line on --raised and Study as the one primary action', () => {
		const css = styleOf(flashcards);
		expect(css).toMatch(/\.bar\s*\{[^}]*height:\s*4px/);
		expect(css).toMatch(/\.bar\s*\{[^}]*background:\s*var\(--raised\)/);
		expect(css).toMatch(/\.bar span\s*\{[^}]*background:\s*var\(--accent\)/);
		expect(flashcards).toMatch(/<Button\s+variant="primary"\s+href="\/study"/);
		expect(flashcards).not.toMatch(/class="study"/);
	});

	it('FlashcardsWidget names the level line with XP into the level and the next level', () => {
		expect(flashcards).toMatch(/key="flashcards\.widget\.level"/);
		expect(flashcards).toMatch(/args=\{\{\s*level,\s*xp:\s*progress\.xpInto,\s*next:\s*progress\.xpForNext\s*\}\}/);
	});

	it('the secondary Reader links are plain base-component links, not bordered pills', () => {
		expect(readingTime).toMatch(/<Button variant="plain" href="\/reader"/);
		expect(characterMap).toMatch(/<Button variant="plain" href="\/stats\/characters"/);
		expect(readingTime).not.toMatch(/class="open"/);
		expect(characterMap).not.toMatch(/class="open"/);
	});
});
