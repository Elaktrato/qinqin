// The hidden-romanisation guard (#284): every component that prints a reading asks the one rule. A source scan
// (lib/languages/romanisationGuard.ts): the markup of every shipped .svelte file under src/ is searched for the
// known reading fields (READING_FIELDS); a file that prints one must be in RENDERERS and use useRomanisation(),
// ReadingText or ReadingTable, or be in EXEMPT with the reason it may show a reading whatever the setting.
// A new screen that shows readings (a drill, a course lesson, a sentence card) renders through the helper and is
// added to RENDERERS; a new reading field (a new API member that holds a reading) is added to READING_FIELDS.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readingFields, romanisationFindings, usesHelper } from './romanisationGuard';

const SRC = fileURLToPath(new URL('../..', import.meta.url));

/** The components that render romanisation (relative to src/); each asks the rule. */
const RENDERERS: readonly string[] = [
	'lib/components/ReadingText.svelte',
	'lib/entry/EntryView.svelte',
	'lib/entry/Readings.svelte',
	'lib/entry/Sentences.svelte',
	'lib/entry/examples/AiExamples.svelte',
	'lib/features/flashcards/cards/ClozeCard.svelte',
	'lib/features/flashcards/cards/ReadingTable.svelte',
	'lib/features/flashcards/cards/SentenceCard.svelte',
	'lib/features/flashcards/cards/ToneCard.svelte',
	'lib/features/flashcards/cards/VocabCard.svelte',
	'lib/features/flashcards/decks/DeckDetail.svelte',
	'lib/features/flashcards/decks/StarterDeckDetail.svelte',
	'lib/features/flashcards/decks/SystemDeckDetail.svelte',
	'lib/features/flashcards/face/HintShown.svelte',
	'lib/features/courses/GrammarStep.svelte',
	'lib/features/courses/ReadingStep.svelte',
	'lib/features/courses/TestReview.svelte',
	'lib/features/grammar/LessonView.svelte',
	'lib/features/grammar/PracticeRun.svelte',
	'lib/features/grammar/review/ReviewExercise.svelte',
	'lib/features/practice/conjugation/ConjugationQuestion.svelte',
	'lib/features/practice/counters/ReadingQuestion.svelte',
	'lib/features/reader/ChapterText.svelte',
	'lib/features/reader/EntryCard.svelte',
	'lib/features/reader/SourceBrowser.svelte',
	'lib/features/reader/WordsPanel.svelte',
	'lib/features/scripts/ScriptsOverview.svelte',
	'lib/features/scripts/ScriptsPracticeRun.svelte',
	'lib/stats/map/CellTip.svelte',
	'routes/lookups/+page.svelte',
	'routes/search/ResultRow.svelte'
];

/** file -> why it may print a reading whatever the setting. */
const EXEMPT: Readonly<Record<string, string>> = {
	'lib/settings/VisualAidsSettings.svelte': 'the tone colour and contour previews draw a fixed sample (mā má mǎ mà ma), not a reading of the learner'
};

function svelteFiles(dir: string, out: string[] = []): string[] {
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) {
			if (name !== 'testing') svelteFiles(path, out);
		} else if (name.endsWith('.svelte') && !name.endsWith('.test.svelte')) out.push(path);
	}
	return out;
}

describe('hidden romanisation guard (#284)', () => {
	it('every component that prints a reading asks the rule', () => {
		const files = svelteFiles(SRC).map((path) => ({ path: relative(SRC, path), source: readFileSync(path, 'utf8') }));
		expect(romanisationFindings(files, RENDERERS, EXEMPT)).toEqual([]);
	});

	it('finds a planted component that prints a reading without the helper', () => {
		const bypass = '<script lang="ts">let { s } = $props();</script>\n<p class="pinyin">{s.pinyin}</p>';
		const viaHelper =
			"<script lang=\"ts\">import { useRomanisation } from '$lib/languages/useRomanisation';\nconst roman = useRomanisation();</script>\n<p>{roman.text(s.pinyin, 'zh')}</p>";
		expect(romanisationFindings([{ path: 'lib/new/Drill.svelte', source: bypass }], [], {})[0].problem).toMatch(/not in RENDERERS/);
		expect(romanisationFindings([{ path: 'lib/new/Drill.svelte', source: bypass }], ['lib/new/Drill.svelte'], {})[0].problem).toMatch(
			/without asking/
		);
		expect(romanisationFindings([{ path: 'lib/new/Drill.svelte', source: viaHelper }], ['lib/new/Drill.svelte'], {})).toEqual([]);
	});

	it('reads markup only: message keys, comments and the script do not count', () => {
		expect(readingFields("<script>const x = s.pinyin;</script>\n<p>{t('entry.reading.pinyin')}</p><!-- row.reading -->")).toEqual([]);
		expect(readingFields('<span>{w.reading}</span>')).toHaveLength(1);
		expect(readingFields('<ToneText value={v} />')).toHaveLength(1);
		expect(usesHelper('// useRomanisation\n<p>{x}</p>')).toBe(false);
	});

	it('flags a listed file that prints no reading any more', () => {
		expect(romanisationFindings([{ path: 'lib/a/Old.svelte', source: '<p>{x}</p>' }], ['lib/a/Old.svelte'], {})[0].problem).toMatch(/listed but/);
	});
});
